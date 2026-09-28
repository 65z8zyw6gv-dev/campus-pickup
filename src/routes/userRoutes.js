// M1 准入模块路由（挂载 /api/users）
// 契约：1.1 registerUser / 1.2 verifyFace / 1.3 payDeposit / 1.4 checkin
// 另含 M4 的两个查询端点：GET /:id（含 tier）+ GET /:id/credit-detail
// 改造（合规绕法 v2.1）：
//   - 校园邮箱注册（@xxx.edu.cn）替代拿不到的学籍接口
//   - 保证金默认 ¥20（env 配置，降低学生心理门槛）
//   - identity 准入关改为"邮箱已激活"
import { Router } from 'express'
import { users, requireUser, findByCampusEmailOrPhone, deposits, persistUser, persistDeposit } from '../store/memoryStore.js'
import { createUser, isPickerReady, isFrozen } from '../models/User.js'
import { Role } from '../models/constants.js'
import { getTier, getCreditDetail } from '../services/creditService.js'
import { genDepositId } from '../utils/id.js'

const router = Router()

// 保证金金额从 env 读，默认 ¥20（冷启动期建议降低门槛）
const DEPOSIT_AMOUNT = Number(process.env.DEPOSIT_AMOUNT ?? 20)
const DEPOSIT_DISCOUNT = Number(process.env.DEPOSIT_DISCOUNT_AMOUNT ?? 10)
// 校园邮箱后缀白名单，默认 edu.cn
const EMAIL_DOMAINS = (process.env.CAMPUS_EMAIL_DOMAINS || 'edu.cn')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

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

// 校园邮箱格式校验：必须以白名单后缀结尾
const isCampusEmail = (email) => {
  if (!email || typeof email !== 'string') return false
  const e = email.trim().toLowerCase()
  return EMAIL_DOMAINS.some((d) => e.endsWith('@' + d) || e.endsWith('.' + d))
}

// ===== 契约 1.1 registerUser =====
router.post(
  '/register',
  wrap((req) => {
    const { role, name, campusEmail, phone, studentId, college } = req.body || {}
    // role 校验
    if (role !== Role.CUSTOMER && role !== Role.PICKER) {
      throw fail('E_VALIDATION', 'role 非法，须为 customer 或 picker')
    }
    if (!name) throw fail('E_VALIDATION', '缺少 name')
    // 校园邮箱校验（替代拿不到的学籍接口）
    if (!campusEmail) throw fail('E_VALIDATION', '缺少 campusEmail（须为校园邮箱）')
    if (!isCampusEmail(campusEmail)) {
      throw fail('E_VALIDATION', `campusEmail 须为校园邮箱（后缀 ${EMAIL_DOMAINS.join('/')}）`)
    }
    // 邮箱/手机查重：已注册则直接返回已有用户（幂等，便于前端 demo 初始化）
    const dup = findByCampusEmailOrPhone(campusEmail, phone)
    if (dup) {
      return {
        id: dup.id,
        role: dup.role,
        name: dup.name,
        campusEmail: dup.campusEmail,
        emailVerified: dup.emailVerified,
        studentId: dup.studentId,
        college: dup.college,
        phone: dup.phone,
        faceVerified: dup.faceVerified,
        depositPaid: dup.depositPaid,
        depositAmount: dup.depositAmount,
        creditScore: dup.creditScore,
        status: dup.status,
        createdAt: dup.createdAt,
      }
    }
    const user = createUser({ role, name, campusEmail, phone, studentId, college })
    persistUser(user)
    // 返回契约规定的字段（不含内部统计字段如 goodCount，保持对外精简）
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      campusEmail: user.campusEmail,
      emailVerified: user.emailVerified,
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

// ===== 新增：邮箱激活 =====
// mock 实现：直接标记为已激活；真实场景发激活链接到邮箱，用户点击回调
// 入参：{ code } 激活码（mock 模式下不校验）
router.post(
  '/:id/verify-email',
  wrap((req) => {
    const user = requireUser(req.params.id)
    if (isFrozen(user.id)) {
      throw fail('E_ACCESS', '账号已被冻结，不可激活邮箱')
    }
    if (!user.campusEmail) {
      throw fail('E_VALIDATION', '用户无校园邮箱，不可激活')
    }
    // mock：不校验 code，直接通过；真实场景需校验邮件下发的 6 位码
    user.emailVerified = true
    persistUser(user)
    const verifiedAt = new Date().toISOString()
    return { userId: user.id, emailVerified: true, verifiedAt }
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
    // 注：mock 模式直接标记通过；真实场景为学生证照片审核通过，不再是严格的活体识别
    user.faceVerified = true
    persistUser(user)
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
    // 金额：body.amount 优先；不传按等级自动算（王者减免 DEPOSIT_DISCOUNT）
    const tier = getTier(user.creditScore)
    const defaultAmount = DEPOSIT_AMOUNT - (tier.depositDiscount || 0)
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
    persistDeposit(dep)
    persistUser(user)
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
      identity: user.emailVerified, // 邮箱已激活（替代学籍校验）
      face: user.faceVerified, // 人脸/学生证照片已审
      deposit: user.depositPaid, // 保证金
    }
    const missing = []
    if (!checks.identity) missing.push('identity(email)')
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
