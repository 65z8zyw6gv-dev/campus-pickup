// 订单状态机：合法转换表 + 转换函数 + 合法动作 + 超时推进框架
// 契约 2.2 transition：非法转换抛 E_STATE，动作未知抛 E_VALIDATION
import { OrderStatus, OrderAction } from '../models/constants.js'
import { appendTimeline } from '../models/Order.js'

// 抛带 code 的错误（路由 wrap 自动映射 HTTP 400）
const fail = (code, message) => {
  const e = new Error(message)
  e.code = code
  return e
}

// 合法状态转换表：from -> [to...]
const transitions = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PENDING_MATCH, OrderStatus.CANCELLED],
  [OrderStatus.PENDING_MATCH]: [OrderStatus.MATCHED, OrderStatus.CANCELLED],
  [OrderStatus.MATCHED]: [OrderStatus.PICKED_UP, OrderStatus.CANCELLED],
  [OrderStatus.PICKED_UP]: [OrderStatus.DELIVERING], // 取货后不可取消
  [OrderStatus.DELIVERING]: [OrderStatus.PENDING_CONFIRM],
  [OrderStatus.PENDING_CONFIRM]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.DISPUTED],
  [OrderStatus.DISPUTED]: [OrderStatus.COMPLETED, OrderStatus.REFUNDED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
}

// 动作 → (from -> to) 映射，用于 getValidActions
const actionMap = {
  [OrderAction.PAY]: { from: OrderStatus.PENDING_PAYMENT, to: OrderStatus.PENDING_MATCH },
  [OrderAction.CANCEL]: { from: [OrderStatus.PENDING_PAYMENT, OrderStatus.PENDING_MATCH, OrderStatus.MATCHED, OrderStatus.PENDING_CONFIRM], to: OrderStatus.CANCELLED },
  [OrderAction.ACCEPT]: { from: OrderStatus.PENDING_MATCH, to: OrderStatus.MATCHED },
  [OrderAction.PICKUP]: { from: OrderStatus.MATCHED, to: OrderStatus.PICKED_UP },
  [OrderAction.DELIVER]: { from: OrderStatus.PICKED_UP, to: OrderStatus.DELIVERING },
  [OrderAction.ARRIVE]: { from: OrderStatus.DELIVERING, to: OrderStatus.PENDING_CONFIRM },
  [OrderAction.CONFIRM]: { from: OrderStatus.PENDING_CONFIRM, to: OrderStatus.COMPLETED },
  [OrderAction.AUTO_CANCEL]: { from: OrderStatus.PENDING_MATCH, to: OrderStatus.CANCELLED },
  [OrderAction.AUTO_CONFIRM]: { from: OrderStatus.PENDING_CONFIRM, to: OrderStatus.COMPLETED },
  [OrderAction.COMPLAINT]: { from: [OrderStatus.PENDING_CONFIRM, OrderStatus.MATCHED, OrderStatus.PICKED_UP, OrderStatus.DELIVERING], to: OrderStatus.DISPUTED },
  [OrderAction.ARBITRATE]: { from: OrderStatus.DISPUTED, to: OrderStatus.COMPLETED }, // 仲裁默认完成，退款走 REFUND 路径
  [OrderAction.REFUND]: { from: [OrderStatus.CANCELLED, OrderStatus.DISPUTED], to: OrderStatus.REFUNDED },
}

/**
 * 校验 from -> to 是否合法
 */
export function canTransition(from, to) {
  const allowed = transitions[from] || []
  return allowed.includes(to)
}

/**
 * 执行状态转换；非法则抛错
 * @param {object} order 订单
 * @param {string} action 动作名（OrderAction）
 * @param {object} payload 附加数据（如 photo/face 等）
 */
export function transition(order, action, payload = {}) {
  const mapping = actionMap[action]
  if (!mapping) throw fail('E_VALIDATION', `未知动作: ${action}`)
  const fromList = Array.isArray(mapping.from) ? mapping.from : [mapping.from]
  if (!fromList.includes(order.status)) {
    throw fail('E_STATE', `当前状态 ${order.status} 不支持动作 ${action}`)
  }
  const to = mapping.to
  if (!canTransition(order.status, to)) {
    throw fail('E_STATE', `非法状态转换: ${order.status} -> ${to}`)
  }
  const prev = order.status
  order.status = to
  appendTimeline(order, action, prev, to, payload)
  return order
}

/**
 * 返回某状态下可执行的动作列表
 */
export function getValidActions(status) {
  const result = []
  for (const [action, mapping] of Object.entries(actionMap)) {
    const fromList = Array.isArray(mapping.from) ? mapping.from : [mapping.from]
    if (fromList.includes(status)) result.push(action)
  }
  return result
}

// ===== 超时自动推进框架 =====
// PENDING_MATCH 10min 无人接单 → AUTO_CANCEL 全额退款
// PENDING_CONFIRM 24h 未确认 → AUTO_CONFIRM 自动确认触发分账
const PENDING_MATCH_TIMEOUT = 10 * 60 * 1000
const PENDING_CONFIRM_TIMEOUT = 24 * 60 * 60 * 1000

/**
 * 检查并推进超时订单（可被定时器或手动触发）
 * 返回发生超时推进的订单数组
 */
export function advanceTimeoutOrders(orders, onAutoCancel, onAutoConfirm) {
  const now = Date.now()
  const advanced = []
  for (const order of orders.values()) {
    if (
      order.status === OrderStatus.PENDING_MATCH &&
      order.paidAt &&
      now - new Date(order.paidAt).getTime() > PENDING_MATCH_TIMEOUT
    ) {
      transition(order, OrderAction.AUTO_CANCEL)
      advanced.push(order)
      onAutoCancel?.(order)
    } else if (
      order.status === OrderStatus.PENDING_CONFIRM &&
      order.pendingConfirmAt &&
      now - new Date(order.pendingConfirmAt).getTime() > PENDING_CONFIRM_TIMEOUT
    ) {
      transition(order, OrderAction.AUTO_CONFIRM)
      advanced.push(order)
      onAutoConfirm?.(order)
    }
  }
  return advanced
}

// 框架：每分钟扫描一次超时订单（简化为定时器，进程退出即停止）
// 真实场景应使用持久化 + 任务队列，此处仅作演示。
export function startTimeoutSweeper(orders, onAutoCancel, onAutoConfirm) {
  const timer = setInterval(() => {
    try {
      advanceTimeoutOrders(orders, onAutoCancel, onAutoConfirm)
    } catch (e) {
      console.error('[超时扫描] 异常:', e.message)
    }
  }, 60 * 1000)
  return timer
}
