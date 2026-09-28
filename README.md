# 校送 · 校园代取服务平台

> 校园外卖 / 包裹代取的双边撮合平台后端框架。
> 顾客发单 → 帮取人接单 → 取货凭证 → 送达 → 确认 → 分账 → 评价，全链路闭环。

## 当前状态

**v0.1.0 — 框架阶段**（内存存储 + mock 支付，未接真实支付/数据库）

适合作为业务逻辑验证与架构样板，**未达生产可用**。

## 技术栈

- Node.js + Express 4
- 原生 ES Modules（`"type": "module"`）
- 内存存储（`src/store/memoryStore.js`，可替换为数据库）
- mock 支付（`src/services/paymentService.js`，可替换为真实支付通道）

## 5 模块架构

| 模块 | 职责 | 关键文件 |
|---|---|---|
| M1 准入 | 注册 / 人脸核验 / 保证金 / 签到 | `routes/userRoutes.js` |
| M2 订单 | 9 状态闭环 / 取货凭证 / 超时推进 | `models/Order.js`、`stateMachine/orderStateMachine.js`、`routes/orderRoutes.js` |
| M3 资金 | 支付 / 分账 / 退款 / 保证金池 | `services/paymentService.js` |
| M4 信用 | 攒分 / 等级 / 匹配优先级 | `services/creditService.js`、`services/matchingService.js` |
| M5 治理 | 风控 / 投诉仲裁 / 统计 | `services/riskService.js`、`routes/adminRoutes.js` |

## 关键规则（不可变）

- 单价 ¥1.5 = 帮取人 ¥1.2 + 平台 ¥0.3
- 保证金 ¥50/人，违规扣罚，退出可退
- 信誉分满分 10：完成 +0.5 / 好评 +0.5 / 准时 +0.1 / 差评 -0.5 / 投诉 -1.0
- 订单 9 状态：PENDING_PAYMENT → PENDING_ACCEPT → ACCEPTED → PICKED_UP → DELIVERING → ARRIVED → CONFIRMED / CANCELLED / REFUNDED
- 超时：10 分钟未接单自动取消，24 小时未确认自动确认

## 运行

```bash
npm install
npm start
# 服务默认在 http://localhost:3000
```

环境变量参考 `.env.example`。

## 接口契约

所有 API 函数与 HTTP 端点的输入 / 输出 / 副作用 / 错误码详见 [CONTRACT.md](./CONTRACT.md)。

- 21 个 API 函数
- 21 个 HTTP 端点
- 统一返回结构：`{ok, data}` / `{ok:false, error:{code, message}}`
- 6 类错误码前缀：E_NOTFOUND / E_ACCESS / E_VALIDATION / E_STATE / E_PAYMENT / E_RISK / E_CREDIT / E_ARBITRATION

## 项目结构

```
campus-pickup/
├── server.js                 # 入口 + 超时扫描器
├── CONTRACT.md               # 5 模块接口契约
├── package.json
├── .env.example
├── public/
│   └── index.html            # 设计模板
└── src/
    ├── models/               # Order / User / constants
    ├── stateMachine/         # orderStateMachine
    ├── services/             # payment / credit / matching / risk
    ├── routes/               # order / user / admin
    ├── store/                # memoryStore（可替换为 DB）
    └── utils/                # id
```

## 设计原则

1. **契约先行**：CONTRACT.md 在代码之前定义模块边界，再进入实现
2. **回调解耦**：状态机通过回调触发资金 / 信用副作用，不直接依赖具体实现（DIP）
3. **模块可替换**：存储层和支付层通过接口边界隔离，替换实现不动业务路由

## License

私有项目，未开源。
