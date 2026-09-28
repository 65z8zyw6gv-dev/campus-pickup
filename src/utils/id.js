// ID 生成工具：订单号 / 用户 ID

let userSeq = 0
let orderSeq = 0
let depositSeq = 0

/**
 * 生成订单号：CS + yyyyMMddHHmmss + 4 位流水号
 */
export function genOrderId() {
  orderSeq = (orderSeq + 1) % 10000
  const d = new Date()
  const pad = (n, l = 2) => String(n).padStart(l, '0')
  const ts =
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  return `CS${ts}${String(orderSeq).padStart(4, '0')}`
}

/**
 * 生成用户 ID：U + 6 位流水号
 */
export function genUserId() {
  userSeq += 1
  return `U${String(userSeq).padStart(6, '0')}`
}

/**
 * 生成保证金记录 ID：D + 6 位流水号
 */
export function genDepositId() {
  depositSeq += 1
  return `D${String(depositSeq).padStart(6, '0')}`
}
