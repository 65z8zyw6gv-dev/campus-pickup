// 业务枚举常量：订单状态、角色、代取类型、信誉等级

// 订单状态机
export const OrderStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT', // 待支付
  PENDING_MATCH: 'PENDING_MATCH', // 待接单
  MATCHED: 'MATCHED', // 已接单
  PICKED_UP: 'PICKED_UP', // 已取货
  DELIVERING: 'DELIVERING', // 送达中
  PENDING_CONFIRM: 'PENDING_CONFIRM', // 待确认收货
  DISPUTED: 'DISPUTED', // 争议中（已发起投诉，待仲裁）
  COMPLETED: 'COMPLETED', // 已完成
  CANCELLED: 'CANCELLED', // 已取消
  REFUNDED: 'REFUNDED', // 已退款
}

// 用户角色
export const Role = {
  CUSTOMER: 'customer', // 顾客
  PICKER: 'picker', // 帮取人
}

// 代取类型
export const PickupType = {
  FOOD: 'food', // 外卖
  PARCEL: 'parcel', // 快递包裹
  OTHER: 'other', // 其他
}

// 信誉等级
export const CreditTier = {
  BRONZE: 'BRONZE', // 青铜
  SILVER: 'SILVER', // 银牌
  GOLD: 'GOLD', // 金牌
  KING: 'KING', // 王者
}

// 用户状态
export const UserStatus = {
  ACTIVE: 'active', // 正常
  FROZEN: 'frozen', // 冻结
}

// 信誉分变动动作（与 creditService 对应）
export const CreditAction = {
  COMPLETE: 'COMPLETE', // 完成一单 +0.5
  GOOD_RATE: 'GOOD_RATE', // 五星好评 +0.5
  ON_TIME: 'ON_TIME', // 准时送达 +0.1
  BAD_RATE: 'BAD_RATE', // 差评 -0.5
  COMPLAINT: 'COMPLAINT', // 投诉成立 -1.0
}

// 状态机动作 → 状态转换映射（用于 getValidActions）
export const OrderAction = {
  PAY: 'PAY', // 支付
  CANCEL: 'CANCEL', // 取消
  ACCEPT: 'ACCEPT', // 接单
  PICKUP: 'PICKUP', // 取货
  DELIVER: 'DELIVER', // 出发送达
  ARRIVE: 'ARRIVE', // 到达上传送达照片
  CONFIRM: 'CONFIRM', // 确认收货
  AUTO_CANCEL: 'AUTO_CANCEL', // 超时自动取消
  AUTO_CONFIRM: 'AUTO_CONFIRM', // 超时自动确认
  COMPLAINT: 'COMPLAINT', // 发起投诉 -> DISPUTED
  ARBITRATE: 'ARBITRATE', // 仲裁裁决 -> COMPLETED / REFUNDED
  REFUND: 'REFUND', // 退款（CANCELLED -> REFUNDED）
}
