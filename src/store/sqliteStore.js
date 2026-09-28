// SQLite 持久化层（v2.1.1 新增）
// 解决缺陷 #1（内存存储无持久化）#2（超时扫描随进程退出失效）#25（ledger 无序）
//
// 设计策略：双写（内存对象 + SQLite），保留业务层对对象的引用修改
//   - 启动时从 SQLite 全量加载到 memoryStore 的 Map
//   - 业务层仍直接修改内存对象属性（不破坏现有代码）
//   - saveUser/saveOrder/saveDeposit/appendLedger 在写完内存后同步写库
//   - 进程重启后启动时自动恢复，超时扫描器能扫到上一次未完成的订单
//
// 约束：所有需要持久化的字段必须在此建表 + 序列化辅助函数同步更新
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(__dirname, '../../data')
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'campus.db')

// 启动前确保目录存在
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL') // 并发读不阻塞写
db.pragma('foreign_keys = ON')

// 启动建表（idempotent）
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    campus_email TEXT,
    email_verified INTEGER DEFAULT 0,
    student_id TEXT,
    college TEXT,
    phone TEXT,
    face_verified INTEGER DEFAULT 0,
    deposit_paid INTEGER DEFAULT 0,
    deposit_amount REAL DEFAULT 0,
    credit_score REAL DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    good_count INTEGER DEFAULT 0,
    good_rate REAL DEFAULT 0,
    bad_count INTEGER DEFAULT 0,
    complaint_count INTEGER DEFAULT 0,
    credit_logs TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    picker_id TEXT,
    pickup_location TEXT,
    pickup_code TEXT,
    delivery_location TEXT,
    expected_time TEXT,
    note TEXT,
    status TEXT NOT NULL,
    amount REAL,
    picker_fee REAL,
    platform_fee REAL,
    pickup_photo TEXT,
    delivery_photo TEXT,
    face_verified_at_pickup INTEGER DEFAULT 0,
    pickup_code_verified INTEGER DEFAULT 0,
    payment_mode TEXT,
    paid_at TEXT,
    pending_confirm_at TEXT,
    refund_amount REAL DEFAULT 0,
    rating TEXT,
    timeline TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    order_id TEXT,
    user_id TEXT,
    amount REAL,
    detail TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger(type);
`)

// ===== 增量迁移：给已有表加新列（idempotent）=====
// 检测列是否存在，不存在则 ALTER TABLE 加列
function hasColumn(table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  return cols.some((c) => c.name === col)
}
if (!hasColumn('orders', 'complaint')) {
  db.exec('ALTER TABLE orders ADD COLUMN complaint TEXT')
}
if (!hasColumn('orders', 'arbitration')) {
  db.exec('ALTER TABLE orders ADD COLUMN arbitration TEXT')
}

// ===== User 序列化辅助 =====
export function rowToUser(r) {
  if (!r) return null
  return {
    id: r.id,
    role: r.role,
    name: r.name,
    campusEmail: r.campus_email,
    emailVerified: !!r.email_verified,
    studentId: r.student_id,
    college: r.college,
    phone: r.phone,
    faceVerified: !!r.face_verified,
    depositPaid: !!r.deposit_paid,
    depositAmount: r.deposit_amount,
    creditScore: r.credit_score,
    totalOrders: r.total_orders,
    goodCount: r.good_count,
    goodRate: r.good_rate,
    badCount: r.bad_count,
    complaintCount: r.complaint_count,
    creditLogs: r.credit_logs ? JSON.parse(r.credit_logs) : [],
    status: r.status,
    createdAt: r.created_at,
  }
}

export function userToRow(u) {
  return {
    id: u.id,
    role: u.role,
    name: u.name,
    campus_email: u.campusEmail,
    email_verified: u.emailVerified ? 1 : 0,
    student_id: u.studentId,
    college: u.college,
    phone: u.phone,
    face_verified: u.faceVerified ? 1 : 0,
    deposit_paid: u.depositPaid ? 1 : 0,
    deposit_amount: u.depositAmount,
    credit_score: u.creditScore,
    total_orders: u.totalOrders,
    good_count: u.goodCount,
    good_rate: u.goodRate,
    bad_count: u.badCount,
    complaint_count: u.complaintCount,
    credit_logs: JSON.stringify(u.creditLogs || []),
    status: u.status,
    created_at: u.createdAt,
  }
}

const insertUserStmt = db.prepare(`
  INSERT OR REPLACE INTO users
  (id, role, name, campus_email, email_verified, student_id, college, phone,
   face_verified, deposit_paid, deposit_amount, credit_score, total_orders,
   good_count, good_rate, bad_count, complaint_count, credit_logs, status, created_at)
  VALUES (@id, @role, @name, @campus_email, @email_verified, @student_id, @college, @phone,
   @face_verified, @deposit_paid, @deposit_amount, @credit_score, @total_orders,
   @good_count, @good_rate, @bad_count, @complaint_count, @credit_logs, @status, @created_at)
`)

export function saveUserRow(u) {
  insertUserStmt.run(userToRow(u))
}

// ===== Order 序列化辅助 =====
export function rowToOrder(r) {
  if (!r) return null
  return {
    id: r.id,
    type: r.type,
    customerId: r.customer_id,
    pickerId: r.picker_id,
    pickupLocation: r.pickup_location,
    pickupCode: r.pickup_code,
    deliveryLocation: r.delivery_location,
    expectedTime: r.expected_time,
    note: r.note,
    status: r.status,
    amount: r.amount,
    pickerFee: r.picker_fee,
    platformFee: r.platform_fee,
    pickupPhoto: r.pickup_photo,
    deliveryPhoto: r.delivery_photo,
    faceVerifiedAtPickup: !!r.face_verified_at_pickup,
    pickupCodeVerified: !!r.pickup_code_verified,
    paymentMode: r.payment_mode,
    paidAt: r.paid_at,
    pendingConfirmAt: r.pending_confirm_at,
    refundAmount: r.refund_amount,
    complaint: r.complaint ? JSON.parse(r.complaint) : null,
    arbitration: r.arbitration ? JSON.parse(r.arbitration) : null,
    rating: r.rating ? JSON.parse(r.rating) : null,
    timeline: r.timeline ? JSON.parse(r.timeline) : [],
    createdAt: r.created_at,
  }
}

export function orderToRow(o) {
  return {
    id: o.id,
    type: o.type,
    customer_id: o.customerId,
    picker_id: o.pickerId,
    pickup_location: o.pickupLocation,
    pickup_code: o.pickupCode,
    delivery_location: o.deliveryLocation,
    expected_time: o.expectedTime,
    note: o.note,
    status: o.status,
    amount: o.amount,
    picker_fee: o.pickerFee,
    platform_fee: o.platformFee,
    pickup_photo: o.pickupPhoto,
    delivery_photo: o.deliveryPhoto,
    face_verified_at_pickup: o.faceVerifiedAtPickup ? 1 : 0,
    pickup_code_verified: o.pickupCodeVerified ? 1 : 0,
    payment_mode: o.paymentMode,
    paid_at: o.paidAt,
    pending_confirm_at: o.pendingConfirmAt,
    refund_amount: o.refundAmount,
    complaint: o.complaint ? JSON.stringify(o.complaint) : null,
    arbitration: o.arbitration ? JSON.stringify(o.arbitration) : null,
    rating: o.rating ? JSON.stringify(o.rating) : null,
    timeline: JSON.stringify(o.timeline || []),
    created_at: o.createdAt,
  }
}

const insertOrderStmt = db.prepare(`
  INSERT OR REPLACE INTO orders
  (id, type, customer_id, picker_id, pickup_location, pickup_code, delivery_location,
   expected_time, note, status, amount, picker_fee, platform_fee, pickup_photo,
   delivery_photo, face_verified_at_pickup, pickup_code_verified, payment_mode,
   paid_at, pending_confirm_at, refund_amount, complaint, arbitration, rating, timeline, created_at)
  VALUES (@id, @type, @customer_id, @picker_id, @pickup_location, @pickup_code, @delivery_location,
   @expected_time, @note, @status, @amount, @picker_fee, @platform_fee, @pickup_photo,
   @delivery_photo, @face_verified_at_pickup, @pickup_code_verified, @payment_mode,
   @paid_at, @pending_confirm_at, @refund_amount, @complaint, @arbitration, @rating, @timeline, @created_at)
`)

export function saveOrderRow(o) {
  insertOrderStmt.run(orderToRow(o))
}

// ===== Deposit 序列化辅助 =====
export function rowToDeposit(r) {
  if (!r) return null
  return {
    id: r.id,
    userId: r.user_id,
    amount: r.amount,
    status: r.status,
    createdAt: r.created_at,
  }
}

const insertDepositStmt = db.prepare(`
  INSERT OR REPLACE INTO deposits (id, user_id, amount, status, created_at)
  VALUES (@id, @user_id, @amount, @status, @created_at)
`)

export function saveDepositRow(d) {
  insertDepositStmt.run({
    id: d.id,
    user_id: d.userId,
    amount: d.amount,
    status: d.status,
    created_at: d.createdAt,
  })
}

// ===== Ledger（append-only，自增 id 保证顺序）=====
const insertLedgerStmt = db.prepare(`
  INSERT INTO ledger (type, order_id, user_id, amount, detail, at)
  VALUES (?, ?, ?, ?, ?, ?)
`)

export function appendLedgerRow(entry) {
  insertLedgerStmt.run(
    entry.type,
    entry.orderId || null,
    entry.userId || null,
    entry.amount,
    JSON.stringify(entry.detail || {}),
    entry.at
  )
}

// ===== 启动时全量加载到内存 =====
export function loadAllFromDB() {
  const users = db.prepare('SELECT * FROM users').all().map(rowToUser)
  const orders = db.prepare('SELECT * FROM orders').all().map(rowToOrder)
  const deposits = db.prepare('SELECT * FROM deposits').all().map(rowToDeposit)
  const ledger = db
    .prepare('SELECT * FROM ledger ORDER BY id')
    .all()
    .map((r) => ({
      type: r.type,
      orderId: r.order_id,
      userId: r.user_id,
      amount: r.amount,
      detail: r.detail ? JSON.parse(r.detail) : {},
      at: r.at,
    }))
  return { users, orders, deposits, ledger }
}
