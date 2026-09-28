// 用户/帮取人模型（含信誉分字段）
import { Role, UserStatus } from './constants.js'
import { genUserId } from '../utils/id.js'
import { getUser } from '../store/memoryStore.js'

/**
 * 创建用户
 * @param {object} p { role, name, studentId, college, phone }
 */
export function createUser(p) {
  const now = new Date().toISOString()
  const user = {
    id: genUserId(),
    role: p.role === Role.PICKER ? Role.PICKER : Role.CUSTOMER,
    name: p.name || '',
    studentId: p.studentId || '',
    college: p.college || '',
    phone: p.phone || '',
    faceVerified: false, // 人脸采集
    depositPaid: false, // 保证金已缴
    depositAmount: 0, // 已缴保证金金额
    creditScore: 0, // 信誉分 0-10
    totalOrders: 0, // 累计完成单数
    goodCount: 0, // 好评数
    goodRate: 0, // 好评率（0-1）
    badCount: 0, // 差评数
    complaintCount: 0, // 投诉成立数
    creditLogs: [], // 信誉分明细
    status: UserStatus.ACTIVE, // active / frozen
    createdAt: now,
  }
  return user
}

/**
 * 准入校验（契约导出签名：接收 id）
 * 帮取人须实名(studentId 非空) + 人脸(faceVerified) + 保证金(depositPaid) 三关全过
 * @param {string} id 用户 ID
 * @returns {boolean}
 */
export function isPickerReady(id) {
  const user = getUser(id)
  if (!user) return false
  if (user.role !== Role.PICKER) return false
  if (!user.studentId) return false
  if (!user.faceVerified) return false
  if (!user.depositPaid) return false
  if (user.status !== UserStatus.ACTIVE) return false
  return true
}

/**
 * 校验某用户是否已冻结（契约 1.2/1.3 E_ACCESS 用）
 * @param {string} id
 * @returns {boolean}
 */
export function isFrozen(id) {
  const user = getUser(id)
  return user ? user.status === UserStatus.FROZEN : false
}
