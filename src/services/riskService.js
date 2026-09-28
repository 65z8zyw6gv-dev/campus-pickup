// 风控服务（契约 5.1 checkBeforePickup / 5.2 checkPickerRisk）
// 取货前风控：取件码匹配 + 送达地点校内 + 帮取人准入
// 帮取人风控：差评率 > 10% 暂停接单 + 保证金复核
import { getOrder, getUser } from '../store/memoryStore.js'
import { isPickerReady } from '../models/User.js'

// 校内地点判定（简化）：非空且不含"校外"字样视为校内
function isOnCampus(location) {
  if (!location) return false
  if (location.includes('校外')) return false
  return true
}

/**
 * 取货前风控校验（契约 5.1）
 * @param {string} orderId
 * @param {string} pickerId
 * @param {object} input { pickupCode, faceVerified }
 * @returns {{ passed, checks:{pickupCodeMatch,inCampus,pickerReady}, blocked:string[] }}
 * 拦截: 取件码与人脸不匹配 → 调用方应抛 E_RISK
 */
export function checkBeforePickup(orderId, pickerId, input = {}) {
  const order = getOrder(orderId)
  const picker = getUser(pickerId)

  const checks = {
    // 订单未设取件码（空字符串）→ 视为无需取件码，直接通过；否则要求严格匹配
    pickupCodeMatch: !order.pickupCode || input.pickupCode === order.pickupCode,
    inCampus: isOnCampus(order.deliveryLocation),
    pickerReady: isPickerReady(pickerId),
  }

  const blocked = []
  if (!checks.pickupCodeMatch) blocked.push('取件码不匹配')
  if (!picker.faceVerified || !input.faceVerified) blocked.push('人脸核验未通过')
  if (!checks.inCampus) blocked.push('送达地点异常（校外）')
  if (!checks.pickerReady) blocked.push('帮取人准入未通过')

  return { passed: blocked.length === 0, checks, blocked }
}

/**
 * 帮取人风控（契约 5.2，接单前）
 * 拦截: 差评率 > 10% → 暂停接单 + 保证金复核
 * @param {string} userId
 * @returns {{ passed, badRate, warnings:string[] }}
 */
export function checkPickerRisk(userId) {
  const picker = getUser(userId)
  const total = picker.totalOrders || 0
  const bad = picker.badCount || 0
  const badRate = total > 0 ? bad / total : 0
  const passed = badRate <= 0.1
  const warnings = []
  if (!passed) {
    warnings.push(`差评率 ${(badRate * 100).toFixed(1)}% > 10%，暂停接单 + 保证金复核`)
  }
  return { passed, badRate, warnings }
}
