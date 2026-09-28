// M2 订单模块路由（挂载 /api/orders）
// 契约 2.1-2.4 + HTTP 端点表 11 个
// 统一返回 { ok, data } / { ok:false, error:{code,message} }
import { Router } from 'express'
import { orders, getOrder, getUser, requireUser } from '../store/memoryStore.js'
import { createOrder } from '../models/Order.js'
import { OrderStatus, OrderAction, CreditAction } from '../models/constants.js'
import { transition, getValidActions } from '../stateMachine/orderStateMachine.js'
import { payOrder, splitPayment, refund } from '../services/paymentService.js'
import { addCredit } from '../services/creditService.js'
import { isPickerReady } from '../models/User.js'
import { checkBeforePickup, checkPickerRisk } from '../services/riskService.js'

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

// ===== 契约 2.1 createOrder（POST /）=====
router.post(
  '/',
  wrap((req) => {
    const { type, customerId, pickupLocation, pickupCode, deliveryLocation, expectedTime, note } = req.body || {}
    // createOrder 内部校验 customerId + type（抛 E_VALIDATION）
    // 校验顾客存在
    if (customerId) requireUser(customerId) // 不存在抛 E_NOTFOUND
    const order = createOrder({ type, customerId, pickupLocation, pickupCode, deliveryLocation, expectedTime, note })
    orders.set(order.id, order)
    return {
      id: order.id,
      status: order.status,
      type: order.type,
      customerId: order.customerId,
      pickupLocation: order.pickupLocation,
      pickupCode: order.pickupCode,
      deliveryLocation: order.deliveryLocation,
      expectedTime: order.expectedTime,
      note: order.note,
      amount: order.amount,
      pickerFee: order.pickerFee,
      platformFee: order.platformFee,
      timeline: order.timeline,
      createdAt: order.createdAt,
    }
  })
)

// ===== 契约 3.1 payOrder（POST /:id/pay）=====
router.post(
  '/:id/pay',
  wrap((req) => payOrder(req.params.id))
)

// ===== 契约 2.x cancel（POST /:id/cancel）按状态机 + 分阶段退款 =====
router.post(
  '/:id/cancel',
  wrap((req) => {
    const order = getOrder(req.params.id)
    transition(order, OrderAction.CANCEL)
    const refundResult = refund(order.id)
    return { orderId: order.id, status: order.status, refund: refundResult }
  })
)

// ===== 契约 2.x accept（POST /:id/accept）需 M1.isPickerReady + M5.checkPickerRisk =====
router.post(
  '/:id/accept',
  wrap((req) => {
    const order = getOrder(req.params.id)
    const { pickerId } = req.body || {}
    const picker = getUser(pickerId)
    if (!picker) throw fail('E_NOTFOUND', `帮取人不存在: ${pickerId}`)
    if (!isPickerReady(pickerId)) {
      throw fail('E_ACCESS', '帮取人准入未通过（实名+人脸+保证金）')
    }
    const risk = checkPickerRisk(pickerId)
    if (!risk.passed) throw fail('E_RISK', `帮取人风控拦截：${risk.warnings.join('；')}`)
    order.pickerId = pickerId
    transition(order, OrderAction.ACCEPT, { pickerId })
    return { orderId: order.id, status: order.status, pickerId }
  })
)

// ===== 契约 2.x pickup（POST /:id/pickup）取货凭证 photo+face+pickupCode =====
router.post(
  '/:id/pickup',
  wrap((req) => {
    const order = getOrder(req.params.id)
    const { pickupPhoto, faceVerified, pickupCode } = req.body || {}
    if (!order.pickerId) throw fail('E_STATE', '订单无帮取人')
    // 取货前风控校验
    const risk = checkBeforePickup(order.id, order.pickerId, { pickupPhoto, faceVerified, pickupCode })
    if (!risk.passed) throw fail('E_RISK', `取货校验失败：${risk.blocked.join('；')}`)
    order.pickupPhoto = pickupPhoto || null
    order.faceVerifiedAtPickup = !!faceVerified
    order.pickupCodeVerified = pickupCode === order.pickupCode
    transition(order, OrderAction.PICKUP, { pickupPhoto, faceVerified, pickupCode })
    return { orderId: order.id, status: order.status, checks: risk.checks }
  })
)

// ===== 契约 2.x deliver（POST /:id/deliver）出发送达 =====
router.post(
  '/:id/deliver',
  wrap((req) => {
    const order = getOrder(req.params.id)
    transition(order, OrderAction.DELIVER)
    return { orderId: order.id, status: order.status }
  })
)

// ===== 契约 2.x arrive（POST /:id/arrive）送达照片 → PENDING_CONFIRM =====
router.post(
  '/:id/arrive',
  wrap((req) => {
    const order = getOrder(req.params.id)
    const { deliveryPhoto } = req.body || {}
    order.deliveryPhoto = deliveryPhoto || null
    transition(order, OrderAction.ARRIVE, { deliveryPhoto })
    order.pendingConfirmAt = new Date().toISOString()
    return { orderId: order.id, status: order.status }
  })
)

// ===== 契约 2.x confirm（POST /:id/confirm）→ COMPLETED 触发 M3 分账 + M4 攒分 =====
router.post(
  '/:id/confirm',
  wrap((req) => {
    const order = getOrder(req.params.id)
    transition(order, OrderAction.CONFIRM)
    // 触发分账 ¥1.2 帮取人 + ¥0.3 平台
    const split = splitPayment(order.id)
    // 完成一单 +0.5 信誉分
    let credit = null
    if (order.pickerId) {
      const picker = getUser(order.pickerId)
      picker.totalOrders = (picker.totalOrders || 0) + 1
      credit = addCredit(order.pickerId, CreditAction.COMPLETE, { orderId: order.id })
    }
    return { orderId: order.id, status: order.status, split, credit }
  })
)

// ===== 契约 2.x rate（POST /:id/rate）双向评价 调 M4.addCredit =====
router.post(
  '/:id/rate',
  wrap((req) => {
    const order = getOrder(req.params.id)
    if (order.status !== OrderStatus.COMPLETED) {
      throw fail('E_STATE', '订单未完成，不可评价')
    }
    const { customerToPicker, pickerToCustomer, onTime } = req.body || {}
    order.rating = { customerToPicker, pickerToCustomer }
    const changes = []
    if (order.pickerId) {
      const picker = getUser(order.pickerId)
      // 五星好评 +0.5（每单上限 +0.5）；差评(<=2星) -0.5；准时 +0.1
      if (customerToPicker === 5) {
        picker.goodCount = (picker.goodCount || 0) + 1
        changes.push(addCredit(order.pickerId, CreditAction.GOOD_RATE, { orderId: order.id }))
      } else if (customerToPicker <= 2) {
        changes.push(addCredit(order.pickerId, CreditAction.BAD_RATE, { orderId: order.id }))
      } else {
        picker.goodCount = (picker.goodCount || 0) + 1
      }
      if (onTime) changes.push(addCredit(order.pickerId, CreditAction.ON_TIME, { orderId: order.id }))
      // 更新好评率
      picker.goodRate = picker.totalOrders > 0 ? picker.goodCount / picker.totalOrders : 0
    }
    return { orderId: order.id, rating: order.rating, creditChanges: changes }
  })
)

// ===== 契约 2.x GET /:id 订单详情（含 validActions 驱动前端按钮）=====
router.get(
  '/:id',
  wrap((req) => {
    const order = getOrder(req.params.id)
    return { ...order, validActions: getValidActions(order.status) }
  })
)

// ===== 契约 2.x GET / 订单列表（?status= 过滤）=====
router.get(
  '/',
  wrap((req) => {
    const { status } = req.query
    let list = Array.from(orders.values())
    if (status) list = list.filter((o) => o.status === status)
    return { total: list.length, list }
  })
)

export default router
