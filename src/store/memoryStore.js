// 内存存储：users / orders / deposits（框架阶段，不接数据库）
// 进程重启数据清空。

export const users = new Map() // userId -> User
export const orders = new Map() // orderId -> Order
export const deposits = new Map() // depositId -> { id, userId, amount, status, createdAt }

// 平台流水（分账/退款记录，仅供管理后台统计）
export const ledger = [] // { type:'split'|'refund'|'deposit', orderId, amount, detail, at }

/**
 * 按 id 获取用户，不存在返回 null（契约 1.x 导出签名）
 */
export function getUser(id) {
  return users.get(id) || null
}

/**
 * 按 id 获取用户，不存在抛错（路由层用，自动转 E_NOTFOUND）
 */
export function requireUser(id) {
  const u = users.get(id)
  if (!u) {
    const e = new Error(`用户不存在: ${id}`)
    e.code = 'E_NOTFOUND'
    throw e
  }
  return u
}

/**
 * 按 id 获取订单，不存在抛错
 */
export function getOrder(id) {
  const o = orders.get(id)
  if (!o) {
    const e = new Error(`订单不存在: ${id}`)
    e.code = 'E_NOTFOUND'
    throw e
  }
  return o
}

/**
 * 查重：学号或手机号是否已注册（契约 1.1 校验用）
 */
export function findByStudentIdOrPhone(studentId, phone) {
  for (const u of users.values()) {
    if (studentId && u.studentId === studentId) return u
    if (phone && u.phone === phone) return u
  }
  return null
}

/**
 * 列出所有帮取人（role=picker）
 */
export function listPickers() {
  return Array.from(users.values()).filter((u) => u.role === 'picker')
}
