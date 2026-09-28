// 全局错误处理中间件（v2.1.1 新增）
// 解决缺陷 #20（无全局错误中间件，未捕获错误直接 500 暴露堆栈）
//
// 用法：在 server.js 所有路由之后挂载
//   app.use(notFound)
//   app.use(errorHandler)
//
// 错误码 → HTTP 状态码映射：
//   E_AUTH / E_ACCESS → 401 / 403
//   E_NOTFOUND        → 404
//   E_RATE_LIMIT      → 429
//   其他 E_*          → 400
//   无 code           → 500（生产隐藏堆栈）
import { ENV } from '../config/env.js'

export function notFound(req, res) {
  res.status(404).json({
    ok: false,
    error: { code: 'E_NOTFOUND', message: `路由不存在: ${req.method} ${req.path}` },
  })
}

// Express 错误中间件必须 4 参数，否则不被识别
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const code = err.code || 'E_INTERNAL'
  let statusCode = 400
  if (code.startsWith('E_AUTH')) statusCode = 401
  else if (code.startsWith('E_ACCESS')) statusCode = 403
  else if (code.startsWith('E_NOTFOUND')) statusCode = 404
  else if (code === 'E_RATE_LIMIT') statusCode = 429
  else if (!err.code) statusCode = 500

  // 5xx 才记日志（4xx 是业务错误不算系统故障）
  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(`[未捕获错误] ${req.method} ${req.path}:`, err)
  }

  res.status(statusCode).json({
    ok: false,
    error: {
      code,
      message: statusCode >= 500 ? '服务器内部错误' : err.message,
      // 生产关闭 stack，开发暴露便于调试
      ...(ENV.NODE_ENV === 'development' && { stack: err.stack }),
    },
  })
}
