# 校送 v1.0 本地运行说明

> 适用版本：v1.0（5 模块闭环框架，纯后端）
> 不包含前端 H5（前端在 v2.0 才加入）

## 一、环境要求

| 项 | 要求 | 检查命令 |
|---|---|---|
| Node.js | >= 18.0 | `node -v` |
| npm | >= 9.0 | `npm -v` |
| git | 任意版本 | `git --version` |
| 端口 | 3000 空闲 | `lsof -i:3000` 应为空 |

> 不需要数据库 / Redis / 任何外部服务，v1.0 全内存运行。

## 二、获取代码

### 方式 A：从 GitHub Release 下载源码包

1. 打开 https://github.com/65z8zyw6gv-dev/campus-pickup/releases/tag/v1.0
2. 在 Assets 区点 `Source code (zip)` 下载
3. 解压到本地任意目录，如 `D:\projects\campus-pickup-v1.0\`

### 方式 B：git clone 后切到 v1.0 标签

```bash
git clone https://github.com/65z8zyw6gv-dev/campus-pickup.git
cd campus-pickup
git checkout v1.0
```

## 三、安装依赖

在项目根目录执行：

```bash
npm install
```

依赖只有 3 个包（express / cors / dotenv），约 30 秒装完。

## 四、启动服务

```bash
npm start
```

或开发模式（文件改动自动重启）：

```bash
npm run dev
```

启动成功会看到如下 banner：

```
==================================================
  校送 · 校园代取服务平台已启动（框架 mock）
  端口: 3000
  首页: http://localhost:3000/
  订单: http://localhost:3000/api/orders
  用户: http://localhost:3000/api/users
  后台: http://localhost:3000/api/admin
  健康: http://localhost:3000/api/health
  分账: ¥1.5 = 帮取人¥1.2 + 平台¥0.3
  信誉: 完成一单 +0.5（满分 10）
  注：内存存储，进程重启数据清空
==================================================
```

## 五、验证服务

### 5.1 健康检查

浏览器或 curl：

```bash
curl http://localhost:3000/api/health
# 期望返回：{"ok":true,"ts":1790576471861}
```

### 5.2 跑完整闭环（端到端验证）

复制下面整段到终端，一行执行：

```bash
# 1. 注册帮取人 + 准入
P=$(curl -s -X POST http://localhost:3000/api/users/register -H "Content-Type: application/json" -d '{"role":"picker","name":"李四","studentId":"P001","phone":"13800000002"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
curl -s -X POST http://localhost:3000/api/users/$P/verify-face > /dev/null
curl -s -X POST http://localhost:3000/api/users/$P/pay-deposit > /dev/null
curl -s -X POST http://localhost:3000/api/users/$P/checkin > /dev/null

# 2. 注册顾客
C=$(curl -s -X POST http://localhost:3000/api/users/register -H "Content-Type: application/json" -d '{"role":"customer","name":"张三","studentId":"C001","phone":"13800000001"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")

# 3. 发单 → 支付 → 接单 → 取货 → 配送 → 送达 → 确认 → 评价
O=$(curl -s -X POST http://localhost:3000/api/orders -H "Content-Type: application/json" -d "{\"type\":\"food\",\"pickupLocation\":\"东门\",\"deliveryLocation\":\"5号楼302\",\"customerId\":\"$C\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
curl -s -X POST http://localhost:3000/api/orders/$O/pay > /dev/null
curl -s -X POST http://localhost:3000/api/orders/$O/accept -H "Content-Type: application/json" -d "{\"pickerId\":\"$P\"}" > /dev/null
curl -s -X POST http://localhost:3000/api/orders/$O/pickup -H "Content-Type: application/json" -d "{\"pickupPhoto\":\"p.jpg\",\"faceVerified\":true,\"pickupCode\":\"\"}" > /dev/null
curl -s -X POST http://localhost:3000/api/orders/$O/deliver -H "Content-Type: application/json" -d "{\"pickerId\":\"$P\"}" > /dev/null
curl -s -X POST http://localhost:3000/api/orders/$O/arrive -H "Content-Type: application/json" -d "{\"pickerId\":\"$P\"}" > /dev/null
curl -s -X POST http://localhost:3000/api/orders/$O/confirm > /dev/null
curl -s -X POST http://localhost:3000/api/orders/$O/rate -H "Content-Type: application/json" -d '{"customerToPicker":5,"onTime":true}' > /dev/null

# 4. 验证结果
echo "=== 订单状态 ==="
curl -s http://localhost:3000/api/orders/$O | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('status:',d['status'],'| timeline:',len(d.get('timeline',[])),'步')"
echo "=== 帮取人信誉分 ==="
curl -s http://localhost:3000/api/users/$P | python3 -c "import sys,json;print('信誉分:',json.load(sys.stdin)['data'].get('creditScore'))"
```

期望输出：

```
=== 订单状态 ===
status: COMPLETED | timeline: 7 步
=== 帮取人信誉分 ===
信誉分: 1.1
```

> 1.1 = 0.5（完成一单）+ 0.5（五星好评）+ 0.1（准时送达）

## 六、API 接口速查

### 6.1 用户模块 `/api/users`

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/register` | 注册（role/name/studentId/phone） |
| POST | `/:id/verify-face` | 人脸核验 |
| POST | `/:id/pay-deposit` | 交保证金 ¥50 |
| POST | `/:id/checkin` | 签到（须先人脸+保证金） |
| GET | `/:id` | 查询用户信息 |

### 6.2 订单模块 `/api/orders`

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/` | 发单（type/customerId/pickupLocation/...） |
| POST | `/:id/pay` | 支付 ¥1.5 |
| POST | `/:id/accept` | 接单（pickerId） |
| POST | `/:id/pickup` | 取货（pickupPhoto/faceVerified/pickupCode） |
| POST | `/:id/deliver` | 开始配送 |
| POST | `/:id/arrive` | 送达 |
| POST | `/:id/confirm` | 确认收货（触发分账 + 攒分） |
| POST | `/:id/rate` | 评价（customerToPicker 1-5 / onTime bool） |
| POST | `/:id/cancel` | 取消订单（按阶段退款） |
| GET | `/:id` | 查询订单详情 |
| GET | `/` | 列出所有订单 |

### 6.3 治理模块 `/api/admin`

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/arbitrate/:orderId` | 投诉仲裁（扣保证金 / 扣信誉分 / 退款顾客） |
| GET | `/stats` | 全局统计 |

完整字段、副作用、错误码详见 [CONTRACT.md](./CONTRACT.md)。

## 七、统一返回结构

所有接口返回 JSON：

```json
// 成功
{ "ok": true, "data": { ... } }

// 失败
{ "ok": false, "error": { "code": "E_XXX", "message": "..." } }
```

错误码前缀：

| 前缀 | 含义 |
|---|---|
| E_NOTFOUND | 资源不存在 |
| E_ACCESS | 权限不足（如未准入） |
| E_VALIDATION | 参数校验失败 |
| E_STATE | 状态机非法转换 |
| E_PAYMENT | 支付/退款失败 |
| E_RISK | 风控拦截 |
| E_CREDIT | 信誉分操作失败 |
| E_ARBITRATION | 仲裁裁决非法 |

## 八、关键业务规则（不可变）

| 规则 | 值 |
|---|---|
| 单价 | ¥1.5 |
| 帮取人分成 | ¥1.2（80%） |
| 平台分成 | ¥0.3（20%） |
| 保证金 | ¥50/人 |
| 信誉分上限 | 10 |
| 完成一单 | +0.5 |
| 五星好评 | +0.5 |
| 准时送达 | +0.1 |
| 差评（≤2 星） | -0.5 |
| 投诉成立 | -1.0 |
| 超时未接单自动取消 | 10 分钟 |
| 超时未确认自动确认 | 24 小时 |
| 信誉等级分档 | 青铜 / 银牌 / 金牌 / 王者 |

## 九、停止服务

终端按 `Ctrl + C`。

## 十、常见问题

### Q1: 重启服务后数据没了？

A: 是设计如此。v1.0 用内存存储（`src/store/memoryStore.js`），进程退出数据清空。生产环境需替换为数据库（参考 CONTRACT.md 的"模块可替换"原则）。

### Q2: 端口被占用怎么办？

A: 用环境变量改端口：

```bash
PORT=4000 npm start
```

### Q3: 不想看到 banner？

A: 设环境变量 `SILENT=1`：

```bash
SILENT=1 npm start
```

### Q4: 取货时总是报"取件码不匹配"？

A: 如果订单创建时没传 pickupCode（如外卖类），调用 pickup 接口时传 `pickupCode: ""`（空字符串）。v1.0 已正确处理空取件码订单。

### Q5: 怎么看订单的可用动作？

A: 调 `GET /api/orders/:id`，返回里带 `validActions` 数组，前端按它驱动按钮。

### Q6: 怎么测退款分支？

A: 不同阶段取消有不同退款：

```bash
# 待接单取消 → 全额退 ¥1.5
curl -X POST http://localhost:3000/api/orders/$O/cancel

# 已接单未取货取消 → 扣 ¥0.3 退 ¥1.2（先 accept 再 cancel）
```

## 十一、项目结构

```
campus-pickup/
├── server.js                   # 入口 + 超时扫描器
├── CONTRACT.md                  # 5 模块接口契约
├── package.json
├── .env.example
└── src/
    ├── models/                  # Order / User / constants
    ├── stateMachine/            # orderStateMachine
    ├── services/                # payment / credit / matching / risk
    ├── routes/                  # order / user / admin
    ├── store/                   # memoryStore（可替换为 DB）
    └── utils/                   # id
```

## 十二、与 v2.0 的区别

| 项 | v1.0 | v2.0 |
|---|---|---|
| 后端 5 模块 | ✅ | ✅ |
| 前端 H5 | ❌ 无前端 | ✅ public/app.html |
| 演示方式 | curl / Postman | 浏览器开 app.html |
| 自动注册 demo 用户 | ❌ 需手动 | ✅ 自动 |
| riskService 取件码空值 | 已正确处理 | 已正确处理 |

> v2.0 完整说明见 https://github.com/65z8zyw6gv-dev/campus-pickup/releases/tag/v2.0
