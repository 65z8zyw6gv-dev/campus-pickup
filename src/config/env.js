// 环境变量统一读取 + 默认值（v2.1.1 新增）
// 解决缺陷 #23（env 读取散落各文件）
//
// 所有需要 env 的地方都从这里读，保证一处定义、一处变更、启动时可见
// 未来 v3.0 可在此处加 Zod 校验

const ENV = {
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',

  // 持久化
  DB_PATH: process.env.DB_PATH ?? './data/campus.db',

  // 支付（避二清）
  PLATFORM_FEE: Number(process.env.PLATFORM_FEE ?? 0.3),
  PICKER_FEE: Number(process.env.PICKER_FEE ?? 1.2),
  ORDER_AMOUNT: Number(process.env.ORDER_AMOUNT ?? 1.5),

  // 保证金
  DEPOSIT_AMOUNT: Number(process.env.DEPOSIT_AMOUNT ?? 20),
  DEPOSIT_DISCOUNT_AMOUNT: Number(process.env.DEPOSIT_DISCOUNT_AMOUNT ?? 10),

  // 校园邮箱
  CAMPUS_EMAIL_DOMAINS: process.env.CAMPUS_EMAIL_DOMAINS ?? 'edu.cn',

  // 超时
  PENDING_MATCH_TIMEOUT: Number(process.env.PENDING_MATCH_TIMEOUT ?? 600000),
  PENDING_CONFIRM_TIMEOUT: Number(process.env.PENDING_CONFIRM_TIMEOUT ?? 86400000),

  // 日志
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
}

export { ENV }
