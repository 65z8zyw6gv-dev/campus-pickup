# 校送 · 模块接口契约 v1

按业务域拆 5 个模块，单向依赖无环：M1 ← M2 ← (M3 ‖ M4) ← M5。
每个模块只暴露下方列出的接口，内部实现可独立替换。
所有金额单位：元（¥）。所有 ID 为 string。所有时间为 ISO 8601。

---

## 通用约定

### 统一返回结构
```
成功: { ok: true, data: <T> }
失败: { ok: false, error: { code: string, message: string } }
```

### 错误码前缀（全模块共用）
| 前缀 | 含义 |
|---|---|
| `E_AUTH` | 未登录/无权限 |
| `E_NOTFOUND` | 资源不存在 |
| `E_STATE` | 状态机非法转换 |
| `E_VALIDATION` | 参数校验失败 |
| `E_ACCESS` | 准入未通过（M1） |
| `E_PAYMENT` | 支付/分账/退款失败（M3） |
| `E_CREDIT` | 信誉分操作非法（M4） |
| `E_RISK` | 风控拦截（M5） |
| `E_ARBITRATION` | 仲裁失败（M5） |

### 共享类型
```
type UserId = string          // "u_..."
type OrderId = string        // "CS20260927143508"
type ISOTime = string        // "2026-09-27T14:35:08.000Z"
type Money = number          // 1.5 表示 ¥1.5
```

---

## M1 · 准入模块 access

依赖：无。提供用户与准入能力给所有上层模块。

### 1.1 registerUser
创建用户（顾客或帮取人）。
```
POST /api/users/register
Body: {
  role: "customer" | "picker",
  name: string,
  studentId: string,
  college: string,
  phone: string
}
→ data: {
  id: UserId, role, name, studentId, college, phone,
  faceVerified: false, depositPaid: false, depositAmount: 0,
  creditScore: 0, status: "active", createdAt: ISOTime
}
错误: E_VALIDATION(学号/手机重复) E_VALIDATION(role 非法)
```

### 1.2 verifyFace
人脸采集（mock：直接置 true）。
```
POST /api/users/:id/verify-face
→ data: { userId, faceVerified: true, verifiedAt: ISOTime }
错误: E_NOTFOUND E_ACCESS(已被冻结)
```

### 1.3 payDeposit
缴存保证金。帮取人 ¥50；王者等级可减半 ¥25（由 M4 提供折扣）。
```
POST /api/users/:id/pay-deposit
Body: { amount?: Money }   // 不传则按等级自动算
→ data: { userId, depositPaid: true, depositAmount: Money, paidAt: ISOTime }
错误: E_NOTFOUND E_ACCESS(仅 picker 可缴) E_PAYMENT(mock 支付失败)
副作用: 写入保证金池（M3 getDepositPool 可查）
```

### 1.4 checkin ★准入三关
帮取人准入校验：实名 + 人脸 + 保证金 三关全过才可接单。
```
POST /api/users/:id/checkin
→ data: {
  userId, passed: boolean,
  checks: {
    identity: boolean,    // 实名（学籍校验，mock）
    face: boolean,        // 人脸采集
    deposit: boolean      // 保证金已缴
  },
  missing: string[]        // 未通过项
}
错误: E_NOTFOUND E_ACCESS(role 非 picker)
```

> 导出函数（供其他模块调用）：
> - `getUser(id): User | null`
> - `isPickerReady(id): boolean`（三关是否全过）

---

## M2 · 订单模块 order

依赖：M1（订单需顾客与帮取人存在）。

### 2.1 createOrder
顾客发单，初始状态 PENDING_PAYMENT。
```
POST /api/orders
Body: {
  customerId: UserId,
  type: "food" | "parcel" | "other",
  pickupLocation: string,
  pickupCode?: string,
  deliveryLocation: string,
  expectedTime: ISOTime,
  note?: string
}
→ data: {
  id: OrderId, status: "PENDING_PAYMENT",
  amount: 1.5, pickerFee: 1.2, platformFee: 0.3,
  ...orderFields, timeline: [...], createdAt: ISOTime
}
错误: E_NOTFOUND(顾客不存在) E_VALIDATION
```

### 2.2 transition ★状态机
执行状态转换。非法转换抛 E_STATE。所有订单流转都走这里。
```
函数调用（非 HTTP）：transition(order, action, payload?)
action ∈ {PAY, CANCEL, ACCEPT, PICKUP, DELIVER, ARRIVE, CONFIRM,
           AUTO_CANCEL, AUTO_CONFIRM, REFUND}
payload: { photoUrl?, faceVerified?, pickupCodeVerified?, by?: UserId }
→ order (mutated, 含 timeline 追加)
抛: E_STATE(非法转换) E_VALIDATION(动作未知)
```

### 2.3 getValidActions
返回当前状态可执行动作（驱动前端按钮）。
```
函数: getValidActions(status) → string[]   // 如 ["PICKUP","CANCEL"]
```

### 2.4 advanceTimeout ★超时推进
扫描超时订单自动推进（定时器或手动触发）。
```
函数: advanceTimeoutOrders(orders, onAutoCancel?, onAutoConfirm?)
规则:
  PENDING_MATCH 超 10min → AUTO_CANCEL（回调 onAutoCancel，触发 M3 全额退款）
  PENDING_CONFIRM 超 24h → AUTO_CONFIRM（回调 onAutoConfirm，触发 M3 分账 + M4 攒分）
→ Order[]   // 发生推进的订单
```

### HTTP 端点（/api/orders）
| Method Path | 动作 | 转换 |
|---|---|---|
| POST `/` | 创建 | →PENDING_PAYMENT |
| POST `/:id/pay` | 支付 | →PENDING_MATCH |
| POST `/:id/cancel` | 取消 | →CANCELLED（按状态） |
| POST `/:id/accept` | 接单 | →MATCHED（需 M1.isPickerReady + M5.checkBeforePickup） |
| POST `/:id/pickup` | 取货凭证 | →PICKED_UP（需 photo+face+pickupCode） |
| POST `/:id/deliver` | 出发送达 | →DELIVERING |
| POST `/:id/arrive` | 送达照片 | →PENDING_CONFIRM |
| POST `/:id/confirm` | 确认收货 | →COMPLETED（触发 M3.splitPayment + M4.addCredit COMPLETE） |
| POST `/:id/rate` | 双向评价 | 调 M4.addCredit |
| GET `/:id` | 详情 | — |
| GET `/` | 列表(?status=) | — |

### 订单状态枚举（9 态）
PENDING_PAYMENT → PENDING_MATCH → MATCHED → PICKED_UP → DELIVERING → PENDING_CONFIRM → COMPLETED
异常: CANCELLED → REFUNDED
取货后(PICKED_UP+)不可取消。

---

## M3 · 资金模块 payment

依赖：M1（保证金池）、M2（按订单状态退款）。

### 3.1 payOrder
顾客支付 ¥1.5（mock：打印日志，订单转 PENDING_MATCH）。
```
函数: payOrder(orderId) → { orderId, paid: true, amount: 1.5, paidAt: ISOTime }
副作用: order.status → PENDING_MATCH, order.paidAt = now
错误: E_PAYMENT(mock 失败) E_STATE(非 PENDING_PAYMENT)
```

### 3.2 splitPayment ★分账
完成时自动分账：¥1.2 → 帮取人，¥0.3 → 平台。
```
函数: splitPayment(orderId) → {
  orderId, pickerFee: 1.2, platformFee: 0.3, total: 1.5,
  splitAt: ISOTime, ledger: [{to:"picker",amount:1.2},{to:"platform",amount:0.3}]
}
错误: E_PAYMENT E_STATE(非 COMPLETED)
```

### 3.3 refund ★分阶段退款
按订单状态退款，原路退回（mock）。
```
函数: refund(orderId) → { orderId, refundAmount: Money, reason: string, refundedAt: ISOTime }
规则:
  PENDING_MATCH 未接单/超时 → 全额 ¥1.5
  MATCHED 未取货取消      → 扣 ¥0.3 退 ¥1.2
  PICKED_UP 之后           → 不支持退款(E_PAYMENT)，走 M5 仲裁
错误: E_PAYMENT E_STATE
```

### 3.4 getDepositPool
保证金池总额（供 M5/admin 查询）。
```
函数: getDepositPool() → {
  total: Money, count: number, perHead: 50,
  deductions: number,   // 累计扣罚
  refunds: number       // 累计退还
}
```

### HTTP（在 /api/admin 下）
| Method Path | 说明 |
|---|---|
| GET `/deposits` | 保证金池（调 3.4） |

---

## M4 · 信用模块 credit

依赖：M1（用户）、M2（完成单触发）。与 M3 互不依赖。

### 4.1 addCredit ★攒分/扣分
```
函数: addCredit(userId, action, ctx?) → {
  before: number, delta: number, after: number, tier: TierInfo, skipped?: boolean
}
action ∈ {COMPLETE, GOOD_RATE, ON_TIME, BAD_RATE, COMPLAINT}
分值: COMPLETE +0.5 | GOOD_RATE +0.5(每单上限+0.5) | ON_TIME +0.1
      BAD_RATE -0.5 | COMPLAINT -1.0
规则: 满分 10 封顶，扣分不破 0；好评每单去重
ctx: { orderId? }   // 好评去重用
错误: E_CREDIT(动作未知) E_NOTFOUND
```

### 4.2 getTier
四档等级（影响匹配优先级 + 佣金加成 + 保证金减免）。
```
函数: getTier(score) → {
  tier: "BRONZE"|"SILVER"|"GOLD"|"KING", name: string,
  bonusFee: Money,       // 金牌+0.1 王者+0.2
  depositDiscount: Money,// 王者保证金减半(¥25)
  match: string           // 匹配优先级描述
}
区间: 青铜 0-2.5 | 银牌 2.5-6.0 | 金牌 6.0-9.0 | 王者 9.0-10
```

### 4.3 getCreditDetail
```
函数: getCreditDetail(userId) → {
  userId, name, creditScore, tier: TierInfo,
  totalOrders, goodRate, badCount, complaintCount,
  logs: [{ at, action, delta, before, after, orderId }]
}
```

### 4.4 matchOrder ★匹配
按信誉分降序返回候选帮取人。
```
函数: matchOrder(orderId) → { orderId, candidates: PickerCandidate[] }
候选: 仅 M1.isPickerReady=true 的帮取人，按 creditScore 降序
错误: E_NOTFOUND(订单)
```

### HTTP
| Method Path | 说明 |
|---|---|
| GET `/api/users/:id/credit-detail` | 信誉明细（4.3） |

---

## M5 · 治理模块 governance

依赖：M1-M4 全部。

### 5.1 checkBeforePickup ★取货风控
```
函数: checkBeforePickup(orderId, pickerId) → {
  passed: boolean,
  checks: {
    pickupCodeMatch: boolean,  // 取件码与人脸匹配
    inCampus: boolean,          // 送达地点校内
    pickerReady: boolean        // 帮取人准入通过
  },
  blocked: string[]
}
拦截: 取件码与人脸不匹配 → E_RISK 拦截取货
错误: E_NOTFOUND E_RISK
```

### 5.2 checkPickerRisk
帮取人风控（接单前）。
```
函数: checkPickerRisk(userId) → {
  passed: boolean,
  badRate: number,             // 差评率
  warnings: string[]
}
拦截: 差评率 > 10% → 暂停接单 + 保证金复核
```

### 5.3 arbitrate ★仲裁
投诉成立后的裁决（扣保证金/退款/扣信誉分）。
```
POST /api/admin/arbitrate/:orderId
Body: {
  decision: "refund_customer" | "reject" | "split",
  deduction: Money,           // 扣保证金金额
  complaintEstablished: boolean
}
→ data: {
  orderId, decision, deduction,
  refundAmount?: Money,        // 退给顾客
  creditDelta: number,        // 投诉成立 -1.0（调 M4）
  arbitratedAt: ISOTime
}
副作用: complaintEstablished=true → 调 M4.addCredit(COMPLAINT)
        扣保证金 → 更新 M3 保证金池 deductions
错误: E_ARBITRATION E_NOTFOUND
```

### 5.4 getStats
管理后台统计。
```
GET /api/admin/stats
→ data: {
  todayOrders, todayRevenue, todayPlatformFee, todayComplaints,
  totalDeposits, pickerCount, avgCredit
}
```

### HTTP（/api/admin）
| Method Path | 说明 |
|---|---|
| GET `/stats` | 统计（5.4） |
| GET `/deposits` | 保证金池（M3.4） |
| GET `/pickers` | 帮取人列表（信誉分排序） |
| POST `/arbitrate/:orderId` | 仲裁（5.3） |

---

## 依赖关系总览

```
M1 准入  ──────────────────────────────────────┐
  │                                            │
  ↓                                            ↓
M2 订单  ──────────────┐                       M5 治理
  │                   │                        ↑
  ↓                   ↓                        │
M3 资金  ←──(互不依赖)──→  M4 信用  ────────────┘
```

- M1 无依赖（基础）
- M2 → M1
- M3 → M1, M2   ‖   M4 → M1, M2   （M3 与 M4 可并行开发）
- M5 → M1, M2, M3, M4（最后做）

## 关键数值契约（不可变）
| 项 | 值 |
|---|---|
| 顾客支付 | ¥1.5 / 单 |
| 帮取人佣金 | ¥1.2 / 单 (80%) |
| 平台提成 | ¥0.3 / 单 (20%) |
| 保证金 | ¥50 / 人（王者 ¥25） |
| 信誉分满分 | 10 分，完成一单 +0.5 |
| 接单超时 | 10min 自动取消 |
| 确认超时 | 24h 自动确认 |
| 金牌加成 | +¥0.1/单 |
| 王者加成 | +¥0.2/单 + 保证金减半 |

## 变更记录
- v1 (2026-09-27): 初版契约，5 模块 / 4 层依赖。
