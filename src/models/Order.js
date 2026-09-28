// 订单模型
// 契约 2.1 createOrder：type 非法抛 E_VALIDATION，初始 PENDING_PAYMENT
import { OrderStatus, PickupType } from './constants.js'
import { genOrderId } from '../utils/id.js'

// 合法 type 值
const VALID_TYPES = new Set(Object.values(PickupType))

/**
 * 创建订单（顾客发单，初始 PENDING_PAYMENT）
 * @param {object} p { type, customerId, pickupLocation, pickupCode, deliveryLocation, expectedTime, note }
 */
export function createOrder(p) {
  if (!p.customerId) {
    const e = new Error('缺少 customerId')
    e.code = 'E_VALIDATION'
    throw e
  }
  if (!VALID_TYPES.has(p.type)) {
    const e = new Error(`type 非法，须为 ${Object.values(PickupType).join('/')}`)
    e.code = 'E_VALIDATION'
    throw e
  }
  const now = new Date().toISOString()
  const order = {
    id: genOrderId(),
    type: p.type,
    customerId: p.customerId,
    pickerId: null, // 接单后填入
    pickupLocation: p.pickupLocation || '',
    pickupCode: p.pickupCode || '',
    deliveryLocation: p.deliveryLocation || '',
    expectedTime: p.expectedTime || '',
    note: p.note || '',
    status: OrderStatus.PENDING_PAYMENT,
    amount: 1.5, // 顾客支付总额
    pickerFee: 1.2, // 帮取人到账
    platformFee: 0.3, // 平台抽成
    pickupPhoto: null, // 取货照片
    deliveryPhoto: null, // 送达照片
    faceVerifiedAtPickup: false, // 取货时人脸核验
    pickupCodeVerified: false, // 取件码核销
    refundAmount: 0, // 退款金额
    complaint: null, // { raisedBy, reason, description, evidence, raisedAt } 投诉信息
    arbitration: null, // { decision, deduction, complaintEstablished, arbitratedAt } 仲裁结果
    rating: null, // { customerToPicker, pickerToCustomer }
    timeline: [
      { at: now, action: 'CREATE', from: null, to: OrderStatus.PENDING_PAYMENT },
    ],
    createdAt: now,
    paidAt: null, // 支付时间（用于 10min 超时计算）
    pendingConfirmAt: null, // 进入待确认时间（用于 24h 超时计算）
  }
  return order
}

/**
 * 追加时间线
 */
export function appendTimeline(order, action, from, to, extra = {}) {
  order.timeline.push({ at: new Date().toISOString(), action, from, to, ...extra })
}
