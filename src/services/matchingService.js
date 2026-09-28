// 匹配服务（契约 4.4 matchOrder）
// 按信誉分降序返回候选帮取人，仅 M1.isPickerReady=true 的帮取人
import { getOrder, listPickers } from '../store/memoryStore.js'
import { isPickerReady } from '../models/User.js'
import { getTier } from './creditService.js'

// 抛带 code 的错误
const fail = (code, message) => {
  const e = new Error(message)
  e.code = code
  return e
}

/**
 * 候选帮取人列表（已准入，按信誉分降序）
 * @param {string} orderId 订单 id（框架阶段不接 LBS，预留）
 * @returns {object[]} PickerCandidate[]
 */
export function findCandidates(orderId) {
  return listPickers()
    .filter((p) => isPickerReady(p.id))
    .sort((a, b) => b.creditScore - a.creditScore)
    .map((p) => ({
      id: p.id,
      name: p.name,
      college: p.college,
      creditScore: p.creditScore,
      tier: getTier(p.creditScore),
      totalOrders: p.totalOrders || 0,
      goodRate: p.goodRate || 0,
    }))
}

/**
 * 匹配订单（契约 4.4）
 * @param {string} orderId
 * @returns {{ orderId, candidates: PickerCandidate[] }}
 * 抛: E_NOTFOUND(订单不存在)
 */
export function matchOrder(orderId) {
  // 校验订单存在
  getOrder(orderId) // 不存在抛 E_NOTFOUND
  const candidates = findCandidates(orderId)
  return { orderId, candidates }
}
