// M5 治理模块路由（挂载 /api/admin）
// 契约 5.3 arbitrate / 5.4 getStats + /deposits + /pickers
// 统一返回 { ok, data } / { ok:false, error:{code,message} }
import { Router } from 'express'
import { orders, users, deposits, ledger, listPickers, getOrder, getUser, persistUser, persistLedger } from '../store/memoryStore.js'
import { OrderStatus, OrderAction, CreditAction } from '../models/constants.js'
import { getTier, addCredit } from '../services/creditService.js'
import { refund, splitPayment, getDepositPool } from '../services/paymentService.js'
import { transition } from '../stateMachine/orderStateMachine.js'

const router = Router()

// 统一返回 { ok, data } / { ok:false, error:{code,message} }
const wrap = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res)
    if (res.headersSent) return
    res.json({ ok: true, data })
  } catch (e) {
    const code = e.code || 'E_VALIDATION'
    res.status(400).json({ ok: false, error: { code, message: e.message } })
  }
}

// 抛带 code 的错误
const fail = (code, message) => {
  const e = new Error(message)
  e.code = code
  return e
}

// 今天的日期前缀 YYYY-MM-DD（用于按天统计）
const todayPrefix = () => new Date().toISOString().slice(0, 10)

// ===== 契约 5.4 getStats（GET /stats）=====
router.get(
  '/stats',
  wrap(() => {
    const today = todayPrefix()
    const orderList = Array.from(orders.values())
    const pickerList = listPickers()

    // 今天支付总额
    const todayRevenue = ledger
      .filter((l) => l.type === 'pay' && l.at.startsWith(today))
      .reduce((s, l) => s + l.amount, 0)
    // 今天平台抽成（分账记录的 detail.platformFee）
    const todayPlatformFee = ledger
      .filter((l) => l.type === 'split' && l.at.startsWith(today))
      .reduce((s, l) => s + (l.detail?.platformFee || 0), 0)
    // 今天订单数
    const todayOrders = orderList.filter((o) => o.createdAt.startsWith(today)).length
    // 今天投诉成立数（从 creditLogs 找 COMPLAINT 今天的）
    const todayComplaints = pickerList.reduce((s, p) => {
      const logs = p.creditLogs || []
      return s + logs.filter((l) => l.action === CreditAction.COMPLAINT && l.at.startsWith(today)).length
    }, 0)
    // 保证金池总额
    const totalDeposits = getDepositPool().total
    // 帮取人平均信誉分
    const avgCredit = pickerList.length > 0
      ? pickerList.reduce((s, p) => s + (p.creditScore || 0), 0) / pickerList.length
      : 0

    return {
      todayOrders,
      todayRevenue,
      todayPlatformFee,
      todayComplaints,
      totalDeposits,
      pickerCount: pickerList.length,
      avgCredit: Number(avgCredit.toFixed(2)),
    }
  })
)

// ===== 契约 3.4 保证金池（GET /deposits）=====
router.get(
  '/deposits',
  wrap(() => getDepositPool())
)

// ===== 帮取人列表（GET /pickers，信誉分降序）=====
router.get(
  '/pickers',
  wrap(() => {
    const list = listPickers()
      .sort((a, b) => b.creditScore - a.creditScore)
      .map((p) => ({
        id: p.id,
        name: p.name,
        college: p.college,
        creditScore: p.creditScore,
        tier: getTier(p.creditScore),
        totalOrders: p.totalOrders || 0,
        goodRate: p.goodRate || 0,
        badCount: p.badCount || 0,
        complaintCount: p.complaintCount || 0,
        status: p.status,
        depositPaid: p.depositPaid,
        faceVerified: p.faceVerified,
      }))
    return { total: list.length, list }
  })
)

// ===== 契约 5.3 arbitrate（POST /arbitrate/:orderId）=====
router.post(
  '/arbitrate/:orderId',
  wrap((req) => {
    const order = getOrder(req.params.orderId)
    const { decision, deduction = 0, complaintEstablished = false } = req.body || {}
    const validDecisions = ['refund_customer', 'reject', 'split']
    if (!validDecisions.includes(decision)) {
      throw fail('E_ARBITRATION', `decision 非法，须为 ${validDecisions.join('/')}`)
    }
    const arbitratedAt = new Date().toISOString()
    let refundAmount
    let creditDelta = 0

    // 投诉成立 → 调 M4.addCredit(COMPLAINT)，-1.0
    if (complaintEstablished && order.pickerId) {
      const r = addCredit(order.pickerId, CreditAction.COMPLAINT, { orderId: order.id })
      creditDelta = r.delta
    }

    // 扣保证金 → 更新 M3 保证金池 deductions（写 ledger）
    if (deduction > 0 && order.pickerId) {
      const picker = getUser(order.pickerId)
      const before = picker.depositAmount
      picker.depositAmount = Math.max(0, picker.depositAmount - Number(deduction))
      console.log(`[仲裁 mock] 帮取人 ${picker.id} 扣保证金 ¥${deduction}（${before} → ${picker.depositAmount}）`)
      persistUser(picker)
      persistLedger({
        type: 'deposit_deduct',
        orderId: order.id,
        amount: Number(deduction),
        detail: { pickerId: picker.id, before, after: picker.depositAmount },
        at: arbitratedAt,
      })
    }

    // 退款给顾客：仲裁是终局裁决，不走状态机，直接退订单总额
    // （COMPLETED 已分账的订单也支持仲裁退款，钱从已分账资金退回）
    if (decision === 'refund_customer') {
      refundAmount = order.amount
      console.log(`[仲裁 mock] 订单 ${order.id} 仲裁退款顾客 ¥${refundAmount}`)
      persistLedger({
        type: 'refund',
        orderId: order.id,
        amount: refundAmount,
        detail: { reason: '仲裁退款', stage: order.status },
        at: arbitratedAt,
      })
    }

    return {
      orderId: order.id,
      decision,
      deduction: Number(deduction),
      refundAmount,
      creditDelta,
      arbitratedAt,
    }
  })
)

export default router
