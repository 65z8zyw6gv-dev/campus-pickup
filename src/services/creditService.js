// 信誉分服务：完成单+0.5、好评+0.5、准时+0.1、差评-0.5、投诉-1.0、满分10封顶、四档等级
// 契约 4.1：未知动作抛 E_CREDIT（getUser 已抛 E_NOTFOUND）
import { CreditAction, CreditTier } from '../models/constants.js'
import { getUser, persistUser } from '../store/memoryStore.js'

// 抛带 code 的错误
const fail = (code, message) => {
  const e = new Error(message)
  e.code = code
  return e
}

// 动作 → 分值
const DELTA = {
  [CreditAction.COMPLETE]: 0.5, // 完成一单 +0.5
  [CreditAction.GOOD_RATE]: 0.5, // 五星好评 +0.5（每单上限 +0.5）
  [CreditAction.ON_TIME]: 0.1, // 准时送达 +0.1
  [CreditAction.BAD_RATE]: -0.5, // 差评 -0.5
  [CreditAction.COMPLAINT]: -1.0, // 投诉成立 -1.0
}

// 同一单好评加分去重（每单上限 +0.5）：检查该单是否已加过好评
function alreadyRatedThisOrder(user, orderId) {
  if (!user.creditLogs) user.creditLogs = []
  return user.creditLogs.some(
    (l) => l.action === CreditAction.GOOD_RATE && l.orderId === orderId
  )
}

/**
 * 给用户加/扣信誉分
 * @param {string} userId
 * @param {string} action CreditAction
 * @param {object} ctx { orderId } 可选，用于好评去重
 * @returns {object} { before, delta, after, tier }
 */
export function addCredit(userId, action, ctx = {}) {
  const user = getUser(userId)
  if (!user.creditLogs) user.creditLogs = []
  const delta = DELTA[action]
  if (delta === undefined) throw fail('E_CREDIT', `未知信誉动作: ${action}`)

  // 好评每单上限 +0.5：同一单重复好评不累加
  if (action === CreditAction.GOOD_RATE && ctx.orderId && alreadyRatedThisOrder(user, ctx.orderId)) {
    return { before: user.creditScore, delta: 0, after: user.creditScore, tier: getTier(user.creditScore), skipped: true }
  }

  const before = user.creditScore
  // 满分 10 封顶，扣分不破 0
  let after = before + delta
  if (after > 10) after = 10
  if (after < 0) after = 0
  user.creditScore = after

  // 维护统计：差评/投诉计数
  if (action === CreditAction.BAD_RATE) user.badCount = (user.badCount || 0) + 1
  if (action === CreditAction.COMPLAINT) user.complaintCount = (user.complaintCount || 0) + 1

  user.creditLogs.push({
    at: new Date().toISOString(),
    action,
    delta,
    before,
    after,
    orderId: ctx.orderId || null,
  })
  persistUser(user)
  return { before, delta, after, tier: getTier(after) }
}

/**
 * 获取用户当前信誉分
 */
export function getCredit(userId) {
  const user = getUser(userId)
  return user.creditScore
}

/**
 * 四档等级
 * 青铜 0-2.5 普通匹配
 * 银牌 2.5-6.0 优先匹配
 * 金牌 6.0-9.0 佣金+¥0.1/单
 * 王者 9.0-10 佣金+¥0.2/单 + 保证金减半¥25
 */
export function getTier(score) {
  if (score >= 9.0) return { tier: CreditTier.KING, name: '王者', bonusFee: 0.2, depositDiscount: 25, match: '王者优先' }
  if (score >= 6.0) return { tier: CreditTier.GOLD, name: '金牌', bonusFee: 0.1, depositDiscount: 0, match: '金牌优先' }
  if (score >= 2.5) return { tier: CreditTier.SILVER, name: '银牌', bonusFee: 0, depositDiscount: 0, match: '优先匹配' }
  return { tier: CreditTier.BRONZE, name: '青铜', bonusFee: 0, depositDiscount: 0, match: '普通匹配' }
}

/**
 * 信誉分明细
 */
export function getCreditDetail(userId) {
  const user = getUser(userId)
  return {
    userId,
    name: user.name,
    creditScore: user.creditScore,
    tier: getTier(user.creditScore),
    totalOrders: user.totalOrders || 0,
    goodRate: user.goodRate || 0,
    badCount: user.badCount || 0,
    complaintCount: user.complaintCount || 0,
    logs: user.creditLogs || [],
  }
}
