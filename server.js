// Express 入口：挂载路由 + 静态前端 + 超时扫描
// 框架阶段：内存存储，进程重启数据清空；不接真实支付/数据库。
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import orderRoutes from './src/routes/orderRoutes.js'
import userRoutes from './src/routes/userRoutes.js'
import adminRoutes from './src/routes/adminRoutes.js'
import { orders, getUser } from './src/store/memoryStore.js'
import { startTimeoutSweeper } from './src/stateMachine/orderStateMachine.js'
import { CreditAction } from './src/models/constants.js'
import { refund, splitPayment } from './src/services/paymentService.js'
import { addCredit } from './src/services/creditService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// 静态前端：public/ 托管到根路径
app.use(express.static(path.join(__dirname, 'public')))

// API 路由
app.use('/api/orders', orderRoutes)
app.use('/api/users', userRoutes)
app.use('/api/admin', adminRoutes)

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }))

// 启动超时扫描定时器（PENDING_MATCH 10min / PENDING_CONFIRM 24h）
// 注意：定时器随进程退出而停止，框架阶段不持久化
startTimeoutSweeper(
  orders,
  // 超时取消 → 全额退款
  (order) => {
    try {
      refund(order.id)
      console.log(`[超时] 订单 ${order.id} 10min 无人接单，自动取消并全额退款`)
    } catch (e) {
      console.error(`[超时取消退款失败] ${order.id}:`, e.message)
    }
  },
  // 超时自动确认 → 触发分账 + 信誉分
  (order) => {
    try {
      splitPayment(order.id)
      if (order.pickerId) {
        addCredit(order.pickerId, CreditAction.COMPLETE, { orderId: order.id })
        const picker = getUser(order.pickerId)
        picker.totalOrders = (picker.totalOrders || 0) + 1
      }
      console.log(`[超时] 订单 ${order.id} 24h 未确认，自动确认并触发分账`)
    } catch (e) {
      console.error(`[超时自动确认失败] ${order.id}:`, e.message)
    }
  }
)

app.listen(PORT, () => {
  console.log('==================================================')
  console.log(`  校送 · 校园代取服务平台已启动（框架 mock）`)
  console.log(`  端口: ${PORT}`)
  console.log(`  首页: http://localhost:${PORT}/`)
  console.log(`  订单: http://localhost:${PORT}/api/orders`)
  console.log(`  用户: http://localhost:${PORT}/api/users`)
  console.log(`  后台: http://localhost:${PORT}/api/admin`)
  console.log(`  健康: http://localhost:${PORT}/api/health`)
  console.log(`  分账: ¥1.5 = 帮取人¥1.2 + 平台¥0.3`)
  console.log(`  信誉: 完成一单 +0.5（满分 10）`)
  console.log('  注：内存存储，进程重启数据清空')
  console.log('==================================================')
})
