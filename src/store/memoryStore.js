// 内存存储层（v2.1.1 改造：双写 SQLite 持久化）
// 解决缺陷 #1（进程重启数据丢）#25（ledger 顺序）
//
// 设计：内存 Map 保留对象引用（业务层仍直接修改属性，零侵入），
//      save 函数在写完内存后同步写 SQLite，启动时从 SQLite 全量恢复到内存。
import {
  db,
  saveUserRow,
  saveOrderRow,
  saveDepositRow,
  appendLedgerRow,
  loadAllFromDB,
} from './sqliteStore.js'

export const users = new Map() // userId -> User
export const orders = new Map() // orderId -> Order
export const deposits = new Map() // depositId -> { id, userId, amount, status, createdAt }

// 平台流水（分账/退款记录，仅供管理后台统计）
// 注意：appendLedger 会同步写库，数组与库保持一致
export const ledger = [] // { type, orderId, amount, detail, at }

/**
 * 启动时从 SQLite 全量加载到内存
 * 由 server.js 在启动早期调用一次
 */
export function initFromDB() {
  const data = loadAllFromDB()
  for (const u of data.users) users.set(u.id, u)
  for (const o of data.orders) orders.set(o.id, o)
  for (const d of data.deposits) deposits.set(d.id, d)
  for (const l of data.ledger) ledger.push(l)
  // eslint-disable-next-line no-console
  console.log(
    `[持久化] 从 SQLite 恢复 users=${data.users.length} orders=${data.orders.length} deposits=${data.deposits.length} ledger=${data.ledger.length}`
  )
}

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
 * 查重：校园邮箱或手机号是否已注册（契约 1.1 校验用）
 */
export function findByCampusEmailOrPhone(campusEmail, phone) {
  for (const u of users.values()) {
    if (campusEmail && u.campusEmail === campusEmail) return u
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

/**
 * 持久化辅助：业务层在创建/修改后调一次
 */
export function persistUser(user) {
  users.set(user.id, user)
  saveUserRow(user)
}

export function persistOrder(order) {
  orders.set(order.id, order)
  saveOrderRow(order)
}

export function persistDeposit(deposit) {
  deposits.set(deposit.id, deposit)
  saveDepositRow(deposit)
}

export function persistLedger(entry) {
  ledger.push(entry)
  appendLedgerRow(entry)
}
