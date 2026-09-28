// 支付/分账 mock：¥1.5 = 帮取人¥1.2 + 平台¥0.3，分阶段退款
// 全部为 mock，仅 console.log 打印，不接真实支付通道。
// 契约 3.1/3.2/3.3：抛 E_PAYMENT/E_STATE，返回结构含 paid/total/splitAt/ledger 等
import { OrderStatus } from '../models/constants.js'
import { getOrder, getUser, ledger, deposits, listPickers } from '../store/memoryStore.js'
import { transition } from '../stateMachine/orderStateMachine.js'
import { OrderAction } from '../models/constants.js'

// 抛带 code 的错误
const fail = (code, message) => {
  const e = new Error(message)
  e.code = code
  return e
}

/**
 * 顾客支付订单（mock）
 * 契约 3.1：返回 { orderId, paid:true, amount:1.5, paidAt }
 */
export function payOrder(orderId) {
  const order = getOrder(orderId)
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw fail('E_STATE', `订单 ${orderId} 当前状态 ${order.status}，无需支付`)
  }
  // mock：假装收到顾客 ¥1.5（真实接入后调支付通道，失败抛 E_PAYMENT）
  console.log(`[支付 mock] 顾客 ${order.customerId} 支付订单 ${orderId} 金额 ¥1.5`)
  transition(order, OrderAction.PAY, { amount: 1.5 })
  order.paidAt = new Date().toISOString()
  ledger.push({ type: 'pay', orderId, amount: 1.5, detail: '顾客支付', at: order.paidAt })
  return { orderId, paid: true, amount: 1.5, paidAt: order.paidAt }
}

/**
 * 完成时自动分账：¥1.2 → 帮取人，¥0.3 → 平台
 * 契约 3.2：返回 { orderId, pickerFee, platformFee, total, splitAt, ledger }
 */
export function splitPayment(orderId) {
  const order = getOrder(orderId)
  if (order.status !== OrderStatus.COMPLETED) {
    throw fail('E_STATE', `订单 ${orderId} 状态 ${order.status}，未完成不可分账`)
  }
  const splitAt = new Date().toISOString()
  console.log(
    `[分账 mock] 订单 ${orderId} 分账：帮取人 ${order.pickerId} 到账 ¥${order.pickerFee}，平台到账 ¥${order.platformFee}`
  )
  const splitLedger = [
    { to: 'picker', amount: order.pickerFee, payeeId: order.pickerId },
    { to: 'platform', amount: order.platformFee },
  ]
  ledger.push({
    type: 'split',
    orderId,
    amount: order.amount,
    detail: { pickerId: order.pickerId, pickerFee: order.pickerFee, platformFee: order.platformFee },
    at: splitAt,
  })
  return {
    orderId,
    pickerFee: order.pickerFee,
    platformFee: order.platformFee,
    total: order.amount,
    splitAt,
    ledger: splitLedger,
  }
}

/**
 * 按订单阶段退款
 * 契约 3.3：返回 { orderId, refundAmount, reason, refundedAt }
 * - PENDING_PAYMENT 未支付：无需退款
 * - PENDING_MATCH 未接单 / 超时：全额 ¥1.5
 * - MATCHED 未取货：扣 ¥0.3 手续费，退 ¥1.2
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

  let refundAmount, reason
  if (stage === OrderStatus.PENDING_PAYMENT) {
    console.log(`[退款 mock] 订单 ${orderId} 未支付，无需退款`)
    refundAmount = 0
    reason = '未支付'
  } else if (stage === OrderStatus.PENDING_MATCH) {
    // 待接单未接单 / 超时：全额 ¥1.5
    refundAmount = 1.5
    reason = '待接单阶段取消，全额退款'
    console.log(`[退款 mock] 订单 ${orderId} ${reason} ¥1.5`)
  } else if (stage === OrderStatus.MATCHED) {
    // 已接单未取货：扣 ¥0.3 手续费，退 ¥1.2
    refundAmount = 1.2
    reason = '已接单未取货，扣 ¥0.3 手续费，退 ¥1.2'
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
    detail: { stage, refund: refundAmount, fee: 1.5 - refundAmount },
    at: refundedAt,
  })

  // 若订单已取消，转 REFUNDED
  if (order.status === OrderStatus.CANCELLED) {
    transition(order, OrderAction.REFUND, { refund: refundAmount })
  }
  return { orderId, refundAmount, reason, refundedAt }
}

/**
 * 保证金池总额（契约 3.4）
 * 供 M5/admin 查询。deductions 累计扣罚、refunds 累计退还，均从 ledger 统计。
 * → { total, count, perHead:50, deductions, refunds }
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
  return { total, count, perHead: 50, deductions, refunds }
}
