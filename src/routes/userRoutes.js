// M1 准入模块路由（挂载 /api/users）
// 契约：1.1 registerUser / 1.2 verifyFace / 1.3 payDeposit / 1.4 checkin
// 另含 M4 的两个查询端点：GET /:id（含 tier）+ GET /:id/credit-detail
import { Router } from 'express'
import { users, requireUser, findByStudentIdOrPhone, deposits } from '../store/memoryStore.js'
import { createUser, isPickerReady, isFrozen } from '../models/User.js'
import { Role } from '../models/constants.js'
import { getTier, getCreditDetail } from '../services/creditService.js'
import { genDepositId } from '../utils/id.js'

const router = Router()

// 统一返回 { ok, data } / { ok:false, error:{code,message} }
// 错误对象须带 .code 属性（如 E_NOTFOUND/E_ACCESS/E_VALIDATION/E_PAYMENT）
const wrap = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res)
    if (res.headersSent) return
    res.json({ ok: true, data })
  } catch (e) {
    const code = e.code || 'E_VALIDATION'
    res.status(400).json({ ok: false, error: { code, message: e.message } })
  }
}

// 抛带 code 的错误
const fail = (code, message) => {
  const e = new Error(message)
  e.code = code
  return e
}

// ===== 契约 1.1 registerUser =====
router.post(
  '/register',
  wrap((req) => {
    const { role, name, studentId, college, phone } = req.body || {}
    // role 校验
    if (role !== Role.CUSTOMER && role !== Role.PICKER) {
      throw fail('E_VALIDATION', 'role 非法，须为 customer 或 picker')
    }
    if (!name) throw fail('E_VALIDATION', '缺少 name')
    // 学号/手机查重
    const dup = findByStudentIdOrPhone(studentId, phone)
    if (dup) {
      throw fail('E_VALIDATION', '学号或手机号已注册')
    }
    const user = createUser({ role, name, studentId, college, phone })
    users.set(user.id, user)
    // 返回契约规定的字段（不含内部统计字段如 goodCount，保持对外精简）
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      studentId: user.studentId,
      college: user.college,
      phone: user.phone,
      faceVerified: user.faceVerified,
      depositPaid: user.depositPaid,
      depositAmount: user.depositAmount,
      creditScore: user.creditScore,
      status: user.status,
      createdAt: user.createdAt,
    }
  })
)

// ===== 契约 1.2 verifyFace =====
router.post(
  '/:id/verify-face',
  wrap((req) => {
    const user = requireUser(req.params.id)
    if (isFrozen(user.id)) {
      throw fail('E_ACCESS', '账号已被冻结，不可采集人脸')
    }
    user.faceVerified = true
    const verifiedAt = new Date().toISOString()
    return { userId: user.id, faceVerified: true, verifiedAt }
  })
)

// ===== 契约 1.3 payDeposit =====
router.post(
  '/:id/pay-deposit',
  wrap((req) => {
    const user = requireUser(req.params.id)
    // 仅 picker 可缴
    if (user.role !== Role.PICKER) {
      throw fail('E_ACCESS', '仅帮取人可缴保证金')
    }
    if (isFrozen(user.id)) {
      throw fail('E_ACCESS', '账号已被冻结，不可缴保证金')
    }
    // 金额：body.amount 优先；不传按等级自动算（王者减半 ¥25）
    const tier = getTier(user.creditScore)
    const defaultAmount = 50 - (tier.depositDiscount || 0)
    const amount = req.body?.amount ?? defaultAmount
    // mock 支付（真实接入后在此处调支付通道，失败抛 E_PAYMENT）
    // if (!mockPaySuccess()) throw fail('E_PAYMENT', '支付通道失败')
    user.depositPaid = true
    user.depositAmount = amount
    const paidAt = new Date().toISOString()
    // 副作用：写入保证金池
    const dep = {
      id: genDepositId(),
      userId: user.id,
      amount,
      status: 'paid',
      createdAt: paidAt,
    }
    deposits.set(dep.id, dep)
    return { userId: user.id, depositPaid: true, depositAmount: amount, paidAt }
  })
)

// ===== 契约 1.4 checkin ★准入三关 =====
router.post(
  '/:id/checkin',
  wrap((req) => {
    const user = requireUser(req.params.id)
    // role 非 picker 直接 E_ACCESS
    if (user.role !== Role.PICKER) {
      throw fail('E_ACCESS', '仅帮取人可准入校验')
    }
    const checks = {
      identity: !!user.studentId, // 实名（学籍校验 mock）
      face: user.faceVerified, // 人脸采集
      deposit: user.depositPaid, // 保证金
    }
    const missing = []
    if (!checks.identity) missing.push('identity')
    if (!checks.face) missing.push('face')
    if (!checks.deposit) missing.push('deposit')
    // 三关全过且未冻结
    const passed = checks.identity && checks.face && checks.deposit && !isFrozen(user.id)
    return { userId: user.id, passed, checks, missing }
  })
)

// ===== M4 查询端点（物理挂在 /api/users 下）=====
router.get(
  '/:id',
  wrap((req) => {
    const user = requireUser(req.params.id)
    return { ...user, tier: getTier(user.creditScore) }
  })
)

router.get(
  '/:id/credit-detail',
  wrap((req) => {
    requireUser(req.params.id)
    return getCreditDetail(req.params.id)
  })
)

export default router
