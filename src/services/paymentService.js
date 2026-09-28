// 支付/分账 mock：避开"二清"合规风险
// 改造（合规绕法 v2.1）：
//   - 顾客分两次扫码付款：第一次扫帮取人收款码付 ¥1.2（钱不进平台账户），
//     第二次扫平台收款码付 ¥0.3（只收平台服务费，不构成二清）
//   - 不再做"平台代收 ¥1.5 再分账"的二清动作
//   - 取消时只退已付给平台的 ¥0.3，¥1.2 由顾客直接找帮取人协商
// 全部为 mock，仅 console.log 打印，不接真实支付通道。
// 契约 3.1/3.2/3.3：抛 E_PAYMENT/E_STATE，返回结构含 paid/total/splitAt/ledger 等
import { OrderStatus } from '../models/constants.js'
import { getOrder, getUser, ledger, deposits, listPickers } from '../store/memoryStore.js'
import { transition } from '../stateMachine/orderStateMachine.js'
import { OrderAction } from '../models/constants.js'

// 平台服务费 ¥0.3（从 env 读，与 .env.example 对齐）
const PLATFORM_FEE = Number(process.env.PLATFORM_FEE ?? 0.3)
// 帮取人到账金额 ¥1.2（从 env 读，与 .env.example 对齐）
const PICKER_FEE = Number(process.env.PICKER_FEE ?? 1.2)

// 抛带 code 的错误
const fail = (code, message) => {
  const e = new Error(message)
  e.code = code
  return e
}

/**
 * 顾客支付订单（mock，分两次扫码避二清）
 * 契约 3.1：返回 { orderId, paid:true, amount, pickerFee, platformFee, paidAt, paymentMode }
 *   - paymentMode = 'split_scan'：顾客扫两次码，平台不代收
 */
export function payOrder(orderId) {
  const order = getOrder(orderId)
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw fail('E_STATE', `订单 ${orderId} 当前状态 ${order.status}，无需支付`)
  }
  const now = new Date().toISOString()
  // mock：假装顾客完成两次扫码付款
  // 1. 扫帮取人码付 ¥1.2（钱直接进帮取人账户，不经过平台）
  console.log(`[支付 mock] 顾客 ${order.customerId} 扫码付帮取人 ${order.pickerId ?? '(待接单)'} ¥${PICKER_FEE}`)
  // 2. 扫平台码付 ¥0.3（平台服务费）
  console.log(`[支付 mock] 顾客 ${order.customerId} 扫码付平台 ¥${PLATFORM_FEE}`)
  // 注：帮取人此时可能还未接单（pickerId 可能为 null），¥1.2 暂挂账到订单，
  // 待 accept 后由帮取人凭取货码核销。生产实现需绑定具体帮取人收款码。
  transition(order, OrderAction.PAY, { amount: PICKER_FEE + PLATFORM_FEE })
  order.paidAt = now
  order.paymentMode = 'split_scan'
  ledger.push({
    type: 'pay',
    orderId,
    amount: PICKER_FEE + PLATFORM_FEE,
    detail: { mode: 'split_scan', pickerFee: PICKER_FEE, platformFee: PLATFORM_FEE },
    at: now,
  })
  return {
    orderId,
    paid: true,
    amount: PICKER_FEE + PLATFORM_FEE,
    pickerFee: PICKER_FEE,
    platformFee: PLATFORM_FEE,
    paidAt: now,
    paymentMode: 'split_scan',
  }
}

/**
 * 完成时结算确认（不再做"代收代付"分账，仅记录应结算金额）
 * 契约 3.2：返回 { orderId, pickerFee, platformFee, total, splitAt, ledger, mode }
 *   - mode = 'split_scan'：钱已在各自账户，此处仅打记录
 */
export function splitPayment(orderId) {
  const order = getOrder(orderId)
  if (order.status !== OrderStatus.COMPLETED) {
    throw fail('E_STATE', `订单 ${orderId} 状态 ${order.status}，未完成不可结算`)
  }
  const splitAt = new Date().toISOString()
  console.log(
    `[结算 mock] 订单 ${orderId} 确认应结算金额：帮取人 ${order.pickerId} ¥${PICKER_FEE}，平台 ¥${PLATFORM_FEE}（已分别收款，无需代付）`
  )
  const splitLedger = [
    { to: 'picker', amount: PICKER_FEE, payeeId: order.pickerId, mode: 'direct_scan' },
    { to: 'platform', amount: PLATFORM_FEE, mode: 'direct_scan' },
  ]
  ledger.push({
    type: 'split',
    orderId,
    amount: PICKER_FEE + PLATFORM_FEE,
    detail: { pickerId: order.pickerId, pickerFee: PICKER_FEE, platformFee: PLATFORM_FEE, mode: 'split_scan' },
    at: splitAt,
  })
  return {
    orderId,
    pickerFee: PICKER_FEE,
    platformFee: PLATFORM_FEE,
    total: PICKER_FEE + PLATFORM_FEE,
    splitAt,
    ledger: splitLedger,
    mode: 'split_scan',
  }
}

/**
 * 按订单阶段退款（避二清版）
 * 契约 3.3：返回 { orderId, refundAmount, reason, refundedAt, manualRefundNote }
 *   - 平台只退自己收的 ¥0.3，¥1.2 由顾客直接找帮取人协商
 * - PENDING_PAYMENT 未支付：无需退款
 * - PENDING_MATCH 未接单 / 超时：平台退 ¥0.3，¥1.2 顾客需直接找帮取人协商（如未接单则 ¥1.2 由平台挂账原路退回）
 * - MATCHED 未取货：扣 ¥0.3 手续费不退，¥1.2 顾客找帮取人协商
 * - PICKED_UP 之后：不支持退款（走投诉）
 * 阶段通过 timeline 中取消动作的 from 字段判断
 */
export function refund(orderId) {
  const order = getOrder(orderId)
  // 找取消动作，确定取消前阶段
  const cancelEntry = [...order.timeline]
    .reverse()
    .find((t) => t.action === OrderAction.CANCEL || t.action === OrderAction.AUTO_CANCEL)
  const stage = cancelEntry ? cancelEntry.from : order.status

  let refundAmount, reason, manualRefundNote
  if (stage === OrderStatus.PENDING_PAYMENT) {
    console.log(`[退款 mock] 订单 ${orderId} 未支付，无需退款`)
    refundAmount = 0
    reason = '未支付'
    manualRefundNote = null
  } else if (stage === OrderStatus.PENDING_MATCH) {
    // 待接单未接单 / 超时：¥1.2 帮取人未收款，平台挂账原路退；¥0.3 平台退
    refundAmount = PICKER_FEE + PLATFORM_FEE
    reason = '待接单阶段取消，平台原路退 ¥' + (PICKER_FEE + PLATFORM_FEE) + '（¥1.2 帮取人未收款，平台挂账原路退回）'
    manualRefundNote = null
    console.log(`[退款 mock] 订单 ${orderId} ${reason}`)
  } else if (stage === OrderStatus.MATCHED) {
    // 已接单未取货：¥0.3 平台手续费不退，¥1.2 顾客找帮取人协商
    refundAmount = 0
    reason = '已接单未取货，平台服务费 ¥' + PLATFORM_FEE + ' 不退，¥' + PICKER_FEE + ' 顾客直接找帮取人协商'
    manualRefundNote = `顾客需联系帮取人 ${order.pickerId} 协商退还 ¥${PICKER_FEE}，平台无法代扣`
    console.log(`[退款 mock] 订单 ${orderId} ${reason}`)
  } else {
    // PICKED_UP 及之后不支持退款
    throw fail('E_PAYMENT', `订单 ${orderId} 阶段 ${stage} 不支持退款，请走投诉仲裁`)
  }

  order.refundAmount = refundAmount
  const refundedAt = new Date().toISOString()
  ledger.push({
    type: 'refund',
    orderId,
    amount: refundAmount,
    detail: { stage, refund: refundAmount, fee: PICKER_FEE + PLATFORM_FEE - refundAmount, manualRefundNote },
    at: refundedAt,
  })

  // 若订单已取消，转 REFUNDED
  if (order.status === OrderStatus.CANCELLED) {
    transition(order, OrderAction.REFUND, { refund: refundAmount })
  }
  return { orderId, refundAmount, reason, refundedAt, manualRefundNote }
}

/**
 * 保证金池总额（契约 3.4）
 * 供 M5/admin 查询。deductions 累计扣罚、refunds 累计退还，均从 ledger 统计。
 * → { total, count, perHead, deductions, refunds }
 */
export function getDepositPool() {
  const pickerList = listPickers()
  const total = pickerList.reduce((s, p) => s + (p.depositAmount || 0), 0)
  const count = pickerList.length
  const deductions = ledger
    .filter((l) => l.type === 'deposit_deduct')
    .reduce((s, l) => s + l.amount, 0)
  const refunds = ledger
    .filter((l) => l.type === 'deposit_refund')
    .reduce((s, l) => s + l.amount, 0)
  const perHead = Number(process.env.DEPOSIT_AMOUNT ?? 20)
  return { total, count, perHead, deductions, refunds }
}
