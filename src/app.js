import { createVapidKeys, sendPush } from './push.js';
import { computePay, DEFAULT_PAYROLL, workDaySet, weekday as wdOf } from './payroll.js';
import { TW_HOLIDAYS } from './holidays-tw.js';
import { leaveBalance } from './leave-balance.js';
// Parsley Time — platform-independent API core.
// Runs on Cloudflare Workers (D1) and on Node.js (node:sqlite) through a tiny async DB adapter:
//   db.all(sql, params) -> rows, db.get(sql, params) -> row|null, db.run(sql, params) -> { lastId }, db.batch(sqls)

const EMP_SESSION_DAYS = 180; // employees stay signed in on their phone
const ADMIN_SESSION_HOURS = 12;
const PBKDF2_ITERATIONS = 20000; // kept modest for the Workers CPU budget; logins are also rate-limited
const LEAVE_TYPES = ['annual', 'personal', 'sick', 'other'];
const LEAVE_LABEL = {
  en: { annual: 'Annual leave', personal: 'Personal leave', sick: 'Sick leave', other: 'Other leave' },
  zh: { annual: '特休', personal: '事假', sick: '病假', other: '休假' },
};
// Categorical palette (validated for colour-blind separation), assigned in order.
const EMPLOYEE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT DEFAULT '', pin_hash TEXT NOT NULL,
     color TEXT NOT NULL, hourly_rate REAL DEFAULT 0, active INTEGER DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
     clock_in INTEGER NOT NULL, clock_out INTEGER, in_lat REAL, in_lng REAL, out_lat REAL, out_lng REAL, break_min INTEGER DEFAULT 0,
     note TEXT DEFAULT '', edited INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_shifts_emp ON shifts(employee_id, clock_in)`,
  `CREATE INDEX IF NOT EXISTS idx_shifts_in ON shifts(clock_in)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, kind TEXT NOT NULL, employee_id INTEGER, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, first INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS leave_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
     type TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, half_day INTEGER DEFAULT 0, note TEXT DEFAULT '',
     status TEXT NOT NULL DEFAULT 'pending', manager_note TEXT DEFAULT '', created_at INTEGER NOT NULL, decided_at INTEGER, seen INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_leave_emp ON leave_requests(employee_id, start_date)`,
  `CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status, start_date)`,
  `CREATE TABLE IF NOT EXISTS payroll_runs (month TEXT NOT NULL, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
     bonus REAL DEFAULT 0, deduction REAL DEFAULT 0, deduction_note TEXT DEFAULT '', insurance REAL, note TEXT DEFAULT '',
     status TEXT NOT NULL DEFAULT 'draft', snapshot TEXT, paid_at INTEGER, PRIMARY KEY (month, employee_id))`,
  `CREATE TABLE IF NOT EXISTS holidays (date TEXT PRIMARY KEY, name_zh TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '', source TEXT DEFAULT 'official')`,
  `CREATE TABLE IF NOT EXISTS leave_adjust (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
     period_from TEXT NOT NULL, days REAL NOT NULL, note TEXT DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS leave_settle (employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE, period_from TEXT NOT NULL,
     action TEXT NOT NULL, days REAL NOT NULL DEFAULT 0, target_from TEXT, payout_month TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (employee_id, period_from))`,
  `CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, employee_id INTEGER, endpoint TEXT NOT NULL,
     p256dh TEXT NOT NULL, auth TEXT NOT NULL, lang TEXT DEFAULT 'en', created_at INTEGER NOT NULL, UNIQUE(endpoint, role))`,
];

// ---------- crypto ----------
const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));
async function pbkdf2(secret, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256));
}
export async function hashSecret(secret) {
  const salt = randomHex(16);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${toHex(await pbkdf2(secret, salt, PBKDF2_ITERATIONS))}`;
}
async function verifySecret(secret, stored) {
  if (!stored?.startsWith('pbkdf2$')) return false;
  const [, iter, salt, h] = stored.split('$');
  const a = await pbkdf2(secret, salt, Number(iter));
  const b = fromHex(h);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- time helpers (business timezone) ----------
export function makeTime(TZ) {
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  const dayKey = (ms) => dayFmt.format(new Date(ms)); // YYYY-MM-DD
  const tzOffset = (ms) => {
    const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  const zonedToMs = (dateStr, timeStr = '00:00') => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const off = tzOffset(guess);
    const off2 = tzOffset(guess - off); // DST edges (not used in Taiwan, but safe)
    return guess - off2;
  };
  return { dayKey, zonedToMs, clock: (ms) => timeFmt.format(ms) };
}
export const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekday = (dateStr) => new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
const workedMs = (s, now = Date.now()) => Math.max(0, (s.clock_out ?? now) - s.clock_in - (s.break_min || 0) * 60000);
const publicEmployee = (e) => e && ({ id: e.id, name: e.name, role: e.role, color: e.color, hourly_rate: e.hourly_rate, leave_hours: e.leave_hours ?? 8,
  pay_type: e.pay_type || 'hourly', monthly_salary: e.monthly_salary || 0, daily_hours: e.daily_hours ?? 8, work_days: e.work_days ?? '1,2,3,4,5',
  insurance: e.insurance || 0, start_date: e.start_date || null, leave_system: e.leave_system === 'calendar' ? 'calendar' : 'anniversary', active: !!e.active, created_at: e.created_at });
// Share of normal pay for each leave type (Taiwan common practice; editable in Settings).
const DEFAULT_LEAVE_PAY = { annual: 100, sick: 50, personal: 0, other: 0 };
// Validated pay fields shared by "add" and "edit employee".
function payFields(b, cur = {}) {
  const pick = (k, fallback) => (b[k] !== undefined ? b[k] : fallback);
  const pay_type = pick('pay_type', cur.pay_type || 'hourly') === 'monthly' ? 'monthly' : 'hourly';
  const nonNeg = (v, f) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : f; };
  const days = String(pick('work_days', cur.work_days ?? '1,2,3,4,5')).split(',').map(Number).filter((n) => n >= 0 && n <= 6);
  return {
    pay_type,
    monthly_salary: nonNeg(pick('monthly_salary', cur.monthly_salary || 0), 0),
    daily_hours: Math.min(24, nonNeg(pick('daily_hours', cur.daily_hours ?? 8), 8)) || 8,
    work_days: [...new Set(days)].sort().join(','),
    insurance: nonNeg(pick('insurance', cur.insurance || 0), 0),
    start_date: (() => { const v = pick('start_date', cur.start_date ?? null); return isDate(v) ? v : null; })(),
    leave_system: pick('leave_system', cur.leave_system || 'anniversary') === 'calendar' ? 'calendar' : 'anniversary',
  };
}

// ---------- HTTP helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const parseCookies = (req) => Object.fromEntries((req.headers.get('cookie') || '').split(';').filter((c) => c.includes('=')).map((c) => {
  const i = c.indexOf('=');
  return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
}));
async function readBody(req) {
  const text = await req.text();
  if (text.length > 1e5) throw new HttpError(413, 'Too large');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'Invalid JSON'); }
}
const leaveHours = (v, fallback) => { const n = Number(v); return n >= 0 && n <= 24 ? n : fallback; };
const lastDayOfMonth = (monthStart) => { const [y, m] = monthStart.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
const validPin = (p) => typeof p === 'string' && /^\d{4,6}$/.test(p);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------- app ----------
export function createApp({ db, timezone = 'Asia/Taipei', adminPassword } = {}) {
  const TZ = timezone;
  const { dayKey, zonedToMs, clock } = makeTime(TZ);
  const clockZh = new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  let ready;

  const getSetting = async (k) => (await db.get('SELECT value FROM settings WHERE key = ?', [k]))?.value;
  const setSetting = (k, v) => db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]);

  async function init() {
    await db.batch(SCHEMA);
    // Migration for databases created before paid leave existed.
    for (const col of ['leave_hours REAL DEFAULT 8', "pay_type TEXT DEFAULT 'hourly'", 'monthly_salary REAL DEFAULT 0', 'daily_hours REAL DEFAULT 8',
      "work_days TEXT DEFAULT '1,2,3,4,5'", 'insurance REAL DEFAULT 0', 'start_date TEXT', "leave_system TEXT DEFAULT 'anniversary'"]) {
      try { await db.run(`ALTER TABLE employees ADD COLUMN ${col}`); } catch { /* column already exists */ }
    }
    if (!(await getSetting('admin_hash'))) {
      await setSetting('admin_hash', await hashSecret(adminPassword || 'parsley'));
      await setSetting('admin_default', adminPassword ? '0' : '1');
    }
    if (!(await getSetting('company'))) await setSetting('company', 'Parsley 帕斯里');
    // Load the official Taiwan holiday list once (and again when a newer built-in year is added).
    const seeded = Number(await getSetting('holidays_seeded') || 0);
    const latestYear = Number(TW_HOLIDAYS[TW_HOLIDAYS.length - 1][0].slice(0, 4));
    if (seeded < latestYear) {
      for (const [date, zh, en] of TW_HOLIDAYS) {
        if (Number(date.slice(0, 4)) > seeded) await db.run('INSERT INTO holidays(date, name_zh, name_en, source) VALUES(?, ?, ?, ?) ON CONFLICT(date) DO NOTHING', [date, zh, en, 'official']);
      }
      await setSetting('holidays_seeded', String(latestYear));
    }
  }
  const ensureReady = () => (ready ||= init().catch((e) => { ready = null; throw e; }));

  // sessions
  async function createSession(req, kind, employeeId, ttlMs) {
    const token = randomHex(32);
    await db.run('INSERT INTO sessions(token, kind, employee_id, expires) VALUES(?, ?, ?, ?)', [token, kind, employeeId ?? null, Date.now() + ttlMs]);
    if (Math.random() < 0.05) await db.run('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
    const secure = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : '';
    return `${kind}_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`;
  }
  async function getSession(req, kind) {
    const token = parseCookies(req)[`${kind}_session`];
    if (!token) return null;
    const s = await db.get('SELECT * FROM sessions WHERE token = ? AND kind = ?', [token, kind]);
    return s && s.expires >= Date.now() ? s : null;
  }
  async function clearSession(req, kind) {
    const token = parseCookies(req)[`${kind}_session`];
    if (token) await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return `${kind}_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }
  async function rateLimited(ip) {
    const now = Date.now();
    const a = await db.get('SELECT * FROM login_attempts WHERE ip = ?', [ip]);
    if (!a || now - a.first > 15 * 60e3) {
      await db.run('INSERT INTO login_attempts(ip, count, first) VALUES(?, 1, ?) ON CONFLICT(ip) DO UPDATE SET count = 1, first = excluded.first', [ip, now]);
      return false;
    }
    await db.run('UPDATE login_attempts SET count = count + 1 WHERE ip = ?', [ip]);
    return a.count + 1 > 20;
  }

  // domain
  const openShift = (empId) => db.get('SELECT * FROM shifts WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', [empId]);

  async function employeeSummary(emp) {
    const now = Date.now();
    const today = dayKey(now);
    const weekStart = addDays(today, -((weekday(today) + 6) % 7));
    const monthStart = today.slice(0, 8) + '01';
    const from = zonedToMs(monthStart < weekStart ? monthStart : weekStart);
    const shifts = await db.all('SELECT * FROM shifts WHERE employee_id = ? AND (clock_in >= ? OR clock_out IS NULL) ORDER BY clock_in DESC', [emp.id, from]);
    const recentPast = await db.all('SELECT * FROM shifts WHERE employee_id = ? AND clock_out IS NOT NULL AND clock_in < ? ORDER BY clock_in DESC LIMIT 10', [emp.id, zonedToMs(today)]);
    const week = Array.from({ length: 7 }, (_, i) => ({ date: addDays(weekStart, i), ms: 0 }));
    let monthMs = 0, todayMs = 0;
    for (const s of shifts) {
      const d = dayKey(s.clock_in), w = workedMs(s, now);
      const slot = week.find((x) => x.date === d);
      if (slot) slot.ms += w;
      if (d >= monthStart) monthMs += w;
      if (d === today) todayMs += w;
    }
    return {
      employee: publicEmployee(emp),
      open: (await openShift(emp.id)) || null,
      todayShifts: shifts.filter((s) => dayKey(s.clock_in) === today).sort((a, b) => a.clock_in - b.clock_in),
      recent: recentPast,
      week, todayMs, monthMs, now, today, timezone: TZ, geo: (await getSetting('geo')) === '1',
      balance: (await balancesFor([emp]))[0],
      leaveNotices: (await db.all("SELECT * FROM leave_requests WHERE employee_id = ? AND seen = 0 AND status IN ('approved', 'rejected') ORDER BY decided_at", [emp.id])).map(withDays),
    };
  }

  function shiftsInRange(fromDate, toDate, employeeId) {
    const params = [zonedToMs(fromDate), zonedToMs(addDays(toDate, 1))];
    if (employeeId) params.push(employeeId);
    return db.all(`SELECT s.*, e.name, e.color, e.hourly_rate, e.pay_type FROM shifts s JOIN employees e ON e.id = s.employee_id
      WHERE s.clock_in >= ? AND s.clock_in < ? ${employeeId ? 'AND s.employee_id = ?' : ''} ORDER BY s.clock_in DESC`, params);
  }

  async function overview() {
    const now = Date.now();
    const today = dayKey(now);
    const weekStart = addDays(today, -((weekday(today) + 6) % 7));
    const monthStart = today.slice(0, 8) + '01';
    const chartStart = addDays(today, -13);
    const from = [monthStart, weekStart, chartStart].sort()[0];
    const [employees, shifts, onShift, activity, company, adminDefault, geo, alertHours, pendingLeave, leaveSoon, monthLeave, pr] = await Promise.all([
      db.all('SELECT * FROM employees ORDER BY created_at'),
      shiftsInRange(from, today),
      db.all('SELECT s.*, e.name, e.color, e.role FROM shifts s JOIN employees e ON e.id = s.employee_id WHERE s.clock_out IS NULL ORDER BY s.clock_in'),
      db.all('SELECT s.*, e.name, e.color FROM shifts s JOIN employees e ON e.id = s.employee_id ORDER BY MAX(s.clock_in, COALESCE(s.clock_out, 0)) DESC LIMIT 12'),
      getSetting('company'), getSetting('admin_default'), getSetting('geo'), getSetting('alert_hours'),
      db.get("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'"),
      db.all(`SELECT l.*, e.name, e.color FROM leave_requests l JOIN employees e ON e.id = l.employee_id
        WHERE l.status = 'approved' AND l.end_date >= ? AND l.start_date <= ? ORDER BY l.start_date`, [today, addDays(today, 13)]),
      leaveEntries(monthStart, lastDayOfMonth(monthStart)),
      payrollMonth(today.slice(0, 7)),
    ]);
    const nextHolidays = await db.all('SELECT * FROM holidays WHERE date >= ? ORDER BY date LIMIT 3', [today]);
    const days = Array.from({ length: 14 }, (_, i) => ({ date: addDays(chartStart, i), byEmp: {} }));
    const totals = { todayMs: 0, weekMs: 0, monthMs: 0, monthPay: 0, monthLeavePay: 0, monthLeaveDays: 0 };
    const perEmp = Object.fromEntries(employees.map((e) => [e.id, { todayMs: 0, weekMs: 0, monthMs: 0, monthLeavePay: 0, monthLeaveDays: 0 }]));
    for (const l of monthLeave) {
      const pe = perEmp[l.employee_id], days = l.half_day ? 0.5 : 1;
      if (pe) { pe.monthLeavePay += l.pay; pe.monthLeaveDays += days; }
      totals.monthLeavePay += l.pay; totals.monthLeaveDays += days;
    }
    // Labour cost this month = gross pay from payroll (hourly pay, salaries, overtime, paid leave, bonuses)
    totals.monthPay = pr.totals.gross;
    for (const r of pr.rows) if (perEmp[r.employee_id]) perEmp[r.employee_id].monthGross = r.gross;
    for (const s of shifts) {
      const d = dayKey(s.clock_in), w = workedMs(s, now), pe = perEmp[s.employee_id];
      const slot = days.find((x) => x.date === d);
      if (slot) slot.byEmp[s.employee_id] = (slot.byEmp[s.employee_id] || 0) + w;
      if (d === today) { totals.todayMs += w; pe.todayMs += w; }
      if (d >= weekStart) { totals.weekMs += w; pe.weekMs += w; }
      if (d >= monthStart) { totals.monthMs += w; pe.monthMs += w; }
    }
    return {
      now, today, timezone: TZ, company, geo: geo === '1', adminDefaultPassword: adminDefault === '1', alertHours: Number(alertHours) || 12,
      employees: employees.map((e) => ({ ...publicEmployee(e), ...perEmp[e.id], onShift: onShift.some((s) => s.employee_id === e.id) })),
      totals, onShift, days, activity,
      pendingLeave: pendingLeave.n, leaveSoon: leaveSoon.map(withDays), leavePay: await leavePayRates(), payroll: pr.cfg, nextHolidays,
    };
  }

  async function exportCsv(fromDate, toDate, employeeId, lang = 'en') {
    const zh = lang === 'zh';
    const shifts = (await shiftsInRange(fromDate, toDate, employeeId)).filter((s) => s.clock_out).reverse();
    const clk = zh ? (ms) => clockZh.format(ms) : clock;
    const hm = (ms) => { const m = Math.round(ms / 60000); return zh ? `${Math.floor(m / 60)}小時${String(m % 60).padStart(2, '0')}分` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
    const rows = [zh
      ? ['員工', '日期', '上班打卡', '下班打卡', '休息（分鐘）', '工時（小時）', '工時（時:分）', '時薪', '薪資', '備註']
      : ['Employee', 'Date', 'Clock in', 'Clock out', 'Break (min)', 'Duration (hours)', 'Duration (h:m)', 'Hourly rate', 'Gross', 'Note']];
    const totals = {};
    const entries = shifts.map((s) => ({ date: dayKey(s.clock_in), sort: s.clock_in, s }));
    for (const l of await leaveEntries(fromDate, toDate, employeeId)) entries.push({ date: l.date, sort: zonedToMs(l.date), l });
    entries.sort((a, b) => a.sort - b.sort);
    const label = LEAVE_LABEL[zh ? 'zh' : 'en'];
    for (const { s, l } of entries) {
      if (s) {
        const ms = workedMs(s), hrs = ms / 3600e3;
        const salaried = s.pay_type === 'monthly';
        rows.push([s.name, dayKey(s.clock_in), clk(s.clock_in), clk(s.clock_out), s.break_min || 0, hrs.toFixed(2), hm(ms), salaried ? (zh ? '月薪' : 'salary') : s.hourly_rate || 0, salaried ? '' : Math.round(hrs * (s.hourly_rate || 0)), s.note || '']);
        const t = (totals[s.name] ||= { ms: 0, pay: 0, leaveMs: 0, leavePay: 0 });
        t.ms += ms; t.pay += salaried ? 0 : hrs * (s.hourly_rate || 0);
      } else {
        const ms = l.hours * 3600e3;
        rows.push([l.name, l.date, label[l.type], '', '', l.hours.toFixed(2), hm(ms), l.hourly_rate, Math.round(l.pay),
          zh ? `帶薪假 ${l.pct}%${l.half_day ? '（半天）' : ''}` : `Paid leave ${l.pct}%${l.half_day ? ' (half day)' : ''}`]);
        const t = (totals[l.name] ||= { ms: 0, pay: 0, leaveMs: 0, leavePay: 0 });
        t.leaveMs += ms; t.leavePay += l.pay;
      }
    }
    rows.push([]);
    for (const [name, t] of Object.entries(totals)) {
      rows.push([`${zh ? '合計' : 'TOTAL'} ${name}`, zh ? '工作' : 'worked', '', '', '', (t.ms / 3600e3).toFixed(2), hm(t.ms), '', Math.round(t.pay), '']);
      if (t.leaveMs) rows.push([`${zh ? '合計' : 'TOTAL'} ${name}`, zh ? '帶薪假' : 'paid leave', '', '', '', (t.leaveMs / 3600e3).toFixed(2), hm(t.leaveMs), '', Math.round(t.leavePay), '']);
      if (t.leaveMs) rows.push([`${zh ? '應付薪資' : 'GROSS PAY'} ${name}`, '', '', '', '', '', '', '', Math.round(t.pay + t.leavePay), '']);
    }
    const esc = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }

  function parseShiftTimes(b) {
    if (!isDate(b.date) || !isTime(b.in)) throw new HttpError(400, 'Date and clock-in time are required');
    const cin = zonedToMs(b.date, b.in);
    let cout = null;
    if (b.out) {
      if (!isTime(b.out)) throw new HttpError(400, 'Invalid clock-out time');
      cout = zonedToMs(b.date, b.out);
      if (cout <= cin) cout = zonedToMs(addDays(b.date, 1), b.out); // overnight shift
    }
    return { cin, cout };
  }

  // ---------- time off ----------
  const leaveDays = (r) => (r.half_day ? 0.5 : Math.round((Date.parse(r.end_date) - Date.parse(r.start_date)) / 86400e3) + 1);
  const withDays = (r) => ({ ...r, days: leaveDays(r) });
  const fmtRange = (r, lang) => {
    const f = (d) => new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(d + 'T00:00:00Z'));
    return r.start_date === r.end_date ? f(r.start_date) : `${f(r.start_date)} – ${f(r.end_date)}`;
  };

  async function leavePayRates() {
    try { return { ...DEFAULT_LEAVE_PAY, ...JSON.parse((await getSetting('leave_pay')) || '{}') }; } catch { return { ...DEFAULT_LEAVE_PAY }; }
  }
  // One entry per approved leave day inside [fromDate, toDate], with paid hours and pay.
  async function leaveEntries(fromDate, toDate, employeeId) {
    const rates = await leavePayRates();
    const hol = await holidayMap(fromDate, toDate);
    const params = [toDate, fromDate];
    if (employeeId) params.push(employeeId);
    const rows = await db.all(`SELECT l.*, e.name, e.color, e.hourly_rate, e.leave_hours, e.pay_type, e.daily_hours, e.work_days FROM leave_requests l JOIN employees e ON e.id = l.employee_id
      WHERE l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ? ${employeeId ? 'AND l.employee_id = ?' : ''}`, params);
    const out = [];
    for (const r of rows) {
      const wd = workDaySet(r), monthly = r.pay_type === 'monthly';
      for (let d = r.start_date > fromDate ? r.start_date : fromDate; d <= r.end_date && d <= toDate; d = addDays(d, 1)) {
        if (!wd.has(wdOf(d)) || hol.has(d)) continue; // only scheduled working days that aren't holidays count as leave
        const hours = (monthly ? (r.daily_hours ?? 8) : (r.leave_hours ?? 8)) * (r.half_day ? 0.5 : 1);
        const pct = Number(rates[r.type]) || 0;
        out.push({ request_id: r.id, employee_id: r.employee_id, name: r.name, color: r.color, hourly_rate: r.hourly_rate || 0, pay_type: monthly ? 'monthly' : 'hourly',
          date: d, type: r.type, half_day: r.half_day, hours, pct, pay: monthly ? 0 : hours * (r.hourly_rate || 0) * pct / 100 });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  }

  // ---------- holidays ----------
  async function holidayMap(from, to) {
    const rows = await db.all('SELECT * FROM holidays WHERE date >= ? AND date <= ? ORDER BY date', [from, to]);
    return new Map(rows.map((h) => [h.date, `${h.name_zh}${h.name_en ? ' ' + h.name_en : ''}`]));
  }

  async function balancesFor(employees) {
    const today = dayKey(Date.now());
    const ids = employees.map((e) => e.id);
    if (!ids.length) return [];
    const reqs = await db.all(`SELECT * FROM leave_requests WHERE employee_id IN (${ids.map(() => '?').join(',')}) AND status IN ('approved', 'pending') AND end_date >= ?`,
      [...ids, addDays(today, -800)]);
    const hol = new Set((await db.all('SELECT date FROM holidays WHERE date >= ?', [addDays(today, -800)])).map((h) => h.date));
    const inIds = `(${ids.map(() => '?').join(',')})`;
    const adjusts = await db.all(`SELECT * FROM leave_adjust WHERE employee_id IN ${inIds} ORDER BY created_at`, ids);
    const settles = await db.all(`SELECT * FROM leave_settle WHERE employee_id IN ${inIds}`, ids);
    return employees.map((e) => leaveBalance(e, reqs.filter((r) => r.employee_id === e.id), today, hol,
      adjusts.filter((x) => x.employee_id === e.id), settles.filter((x) => x.employee_id === e.id)));
  }

  // ---------- payroll ----------
  async function payrollCfg() {
    try { return { ...DEFAULT_PAYROLL, ...JSON.parse((await getSetting('payroll')) || '{}') }; } catch { return { ...DEFAULT_PAYROLL }; }
  }
  // Payroll rows for a month. Paid rows come from their saved snapshot so later edits don't change a paid payslip.
  async function payrollMonth(month, onlyEmployeeId = null) {
    const from = `${month}-01`, to = lastDayOfMonth(from);
    const [employees, shifts, leave, runs, leavePay, cfg, holidays, payouts] = await Promise.all([
      db.all('SELECT * FROM employees ORDER BY created_at'),
      shiftsInRange(from, to),
      db.all("SELECT * FROM leave_requests WHERE status = 'approved' AND start_date <= ? AND end_date >= ?", [to, from]),
      db.all('SELECT * FROM payroll_runs WHERE month = ?', [month]),
      leavePayRates(), payrollCfg(), holidayMap(from, to),
      db.all("SELECT * FROM leave_settle WHERE action = 'payout' AND payout_month = ?", [month]),
    ]);
    const today = dayKey(Date.now()), now = Date.now();
    const rows = [];
    for (const e of employees) {
      if (onlyEmployeeId && e.id !== onlyEmployeeId) continue;
      const mine = shifts.filter((x) => x.employee_id === e.id);
      const myLeave = leave.filter((x) => x.employee_id === e.id);
      const run = runs.find((x) => x.employee_id === e.id);
      const payoutDays = payouts.filter((x) => x.employee_id === e.id).reduce((a, x) => a + Number(x.days), 0);
      // include active staff, plus anyone with hours, leave or a saved run this month
      if (!e.active && !mine.length && !myLeave.length && !run) continue;
      if (!onlyEmployeeId && e.pay_type !== 'monthly' && !mine.length && !myLeave.length && !run && !payoutDays) continue;
      if (run?.status === 'paid' && run.snapshot) {
        const snap = JSON.parse(run.snapshot);
        const fresh = computePay({ e, month, shifts: mine, leave: myLeave, adj: run, leavePay, cfg, dayKey, today, now, holidays, payoutDays });
        rows.push({ ...snap, status: 'paid', paid_at: run.paid_at, changed_since_paid: fresh.net !== snap.net });
      } else {
        rows.push({ ...computePay({ e, month, shifts: mine, leave: myLeave, adj: run, leavePay, cfg, dayKey, today, now, holidays, payoutDays }), status: 'draft' });
      }
    }
    const totals = rows.reduce((t, r) => ({ gross: t.gross + r.gross, deductions: t.deductions + r.total_deductions, net: t.net + r.net,
      hours: t.hours + r.hours.worked, overtime: t.overtime + r.hours.ot1 + r.hours.ot2 }), { gross: 0, deductions: 0, net: 0, hours: 0, overtime: 0 });
    return { month, rows, totals, cfg, leavePay, company: await getSetting('company') };
  }
  function payrollCsv(pr, lang) {
    const zh = lang === 'zh';
    const H = zh
      ? ['員工', '計薪方式', '工時', '加班 (1.34)', '加班 (1.67)', '本薪', '加班費', '帶薪假', '國定假日工資', '國定假日出勤加給', '特休未休工資', '獎金', '請假扣款', '勞健保', '其他扣款', '應發', '實發', '狀態']
      : ['Employee', 'Pay type', 'Hours', 'Overtime (1.34)', 'Overtime (1.67)', 'Base', 'Overtime pay', 'Paid leave', 'Holiday pay', 'Holiday work pay', 'Unused leave pay', 'Bonus', 'Leave deduction', 'Insurance', 'Other deduction', 'Gross', 'Net', 'Status'];
    const rows = [H, ...pr.rows.map((r) => [r.name, zh ? (r.pay_type === 'monthly' ? '月薪' : '時薪') : r.pay_type, r.hours.worked, r.hours.ot1, r.hours.ot2,
      r.earnings.base, r.earnings.overtime, r.earnings.leave, r.earnings.holiday || 0, r.earnings.holiday_work || 0, r.earnings.leave_payout || 0, r.earnings.bonus, r.deductions.leave, r.deductions.insurance, r.deductions.other,
      r.gross, r.net, zh ? (r.status === 'paid' ? '已發放' : '草稿') : r.status])];
    rows.push([zh ? '合計' : 'TOTAL', '', Math.round(pr.totals.hours * 100) / 100, '', '', '', '', '', '', '', '', '', '', '', '', pr.totals.gross, pr.totals.net, '']);
    const esc = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    return '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }

  // ---------- push notifications ----------
  async function vapid() {
    let keys = await getSetting('vapid');
    if (!keys) {
      keys = JSON.stringify(await createVapidKeys());
      await db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING', ['vapid', keys]);
      keys = await getSetting('vapid');
    }
    return JSON.parse(keys);
  }
  // Sends a message (built per language) to every device of the given role / employee.
  async function notify(role, employeeId, build, origin) {
    const subs = role === 'admin'
      ? await db.all("SELECT * FROM push_subs WHERE role = 'admin'")
      : await db.all("SELECT * FROM push_subs WHERE role = 'emp' AND employee_id = ?", [employeeId]);
    if (!subs.length) return;
    const keys = await vapid();
    const subject = origin.startsWith('https:') ? origin : 'https://parsley-time.workers.dev';
    await Promise.all(subs.map(async (sub) => {
      const r = await sendPush(sub, build(sub.lang === 'zh' ? 'zh' : 'en'), keys, subject);
      if (r === 'gone') await db.run('DELETE FROM push_subs WHERE id = ?', [sub.id]);
    }));
  }

  // routes
  async function route(req, ip, defer) {
    const origin = new URL(req.url).origin;
    const later = (promise) => defer(promise.catch((e) => console.error('push failed', e)));
    async function pushRoutes(req, p, m, role, employeeId) {
      if (role === 'admin' && !(await getSession(req, 'admin'))) throw new HttpError(401, 'Not signed in');
      if (p === '/api/push/subscribe' && m === 'POST') {
        const { subscription: sub, lang } = await readBody(req);
        const endpoint = sub?.endpoint, p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth;
        if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string') throw new HttpError(400, 'Invalid subscription');
        await db.run(`INSERT INTO push_subs(role, employee_id, endpoint, p256dh, auth, lang, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(endpoint, role) DO UPDATE SET employee_id = excluded.employee_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang`,
          [role, employeeId, endpoint, p256dh, auth, lang === 'zh' ? 'zh' : 'en', Date.now()]);
        return json(200, { ok: true });
      }
      if (p === '/api/push/unsubscribe' && m === 'POST') {
        const { endpoint } = await readBody(req);
        await db.run('DELETE FROM push_subs WHERE endpoint = ? AND role = ?', [String(endpoint || ''), role]);
        return json(200, { ok: true });
      }
      if (p === '/api/push/test' && m === 'POST') {
        const { lang } = await readBody(req);
        later(notify(role, employeeId, (l) => ({ title: 'Parsley', body: l === 'zh' ? '通知已開啟 ✓' : 'Notifications are on ✓', url: role === 'admin' ? '/admin#timeoff' : '/' }), origin));
        return json(200, { ok: true, lang });
      }
      throw new HttpError(404, 'Not found');
    }
    const url = new URL(req.url);
    const p = url.pathname, m = req.method;

    if (p === '/healthz') { await db.get('SELECT 1 AS ok'); return new Response('ok'); }

    // Public
    if (p === '/api/team' && m === 'GET') {
      const employees = await db.all('SELECT id, name, role, color FROM employees WHERE active = 1 ORDER BY name');
      return json(200, { company: await getSetting('company'), timezone: TZ, geo: (await getSetting('geo')) === '1', employees });
    }
    if (p === '/api/login' && m === 'POST') {
      if (await rateLimited(ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
      const { employeeId, pin } = await readBody(req);
      const emp = await db.get('SELECT * FROM employees WHERE id = ? AND active = 1', [Number(employeeId) || 0]);
      if (!emp || !(await verifySecret(String(pin ?? ''), emp.pin_hash))) throw new HttpError(401, 'Wrong PIN');
      return json(200, { ok: true }, { 'Set-Cookie': await createSession(req, 'emp', emp.id, EMP_SESSION_DAYS * 86400e3) });
    }
    if (p === '/api/push/key' && m === 'GET') return json(200, { publicKey: (await vapid()).publicKey });
    if (p === '/api/admin/login' && m === 'POST') {
      if (await rateLimited(ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
      const { password } = await readBody(req);
      if (!(await verifySecret(String(password ?? ''), await getSetting('admin_hash')))) throw new HttpError(401, 'Wrong password');
      return json(200, { ok: true }, { 'Set-Cookie': await createSession(req, 'admin', null, ADMIN_SESSION_HOURS * 3600e3) });
    }

    // Employee
    if (p === '/api/logout' && m === 'POST') return json(200, { ok: true }, { 'Set-Cookie': await clearSession(req, 'emp') });
    if (p === '/api/me' || p === '/api/punch' || p.startsWith('/api/leave') || p.startsWith('/api/payslips') || (p.startsWith('/api/push/') && p !== '/api/push/key')) {
      if (p.startsWith('/api/push/') && new URL(req.url).searchParams.get('role') === 'admin') return pushRoutes(req, p, m, 'admin', null);
      const s = await getSession(req, 'emp');
      const emp = s && await db.get('SELECT * FROM employees WHERE id = ? AND active = 1', [s.employee_id]);
      if (!emp) throw new HttpError(401, 'Not signed in');
      if (p === '/api/me' && m === 'GET') return json(200, await employeeSummary(emp));
      if (p === '/api/punch' && m === 'POST') {
        const { lat, lng } = await readBody(req);
        const open = await openShift(emp.id);
        const now = Date.now();
        if (open) await db.run('UPDATE shifts SET clock_out = ?, out_lat = ?, out_lng = ? WHERE id = ?', [now, num(lat), num(lng), open.id]);
        else await db.run('INSERT INTO shifts(employee_id, clock_in, in_lat, in_lng) VALUES(?, ?, ?, ?)', [emp.id, now, num(lat), num(lng)]);
        return json(200, { action: open ? 'out' : 'in', at: now, ...(await employeeSummary(emp)) });
      }
      if (p.startsWith('/api/push/')) return pushRoutes(req, p, m, 'emp', emp.id);

      if (p === '/api/payslips' && m === 'GET') {
        const runs = await db.all("SELECT month, snapshot, paid_at FROM payroll_runs WHERE employee_id = ? AND status = 'paid' ORDER BY month DESC LIMIT 24", [emp.id]);
        return json(200, { payslips: runs.map((r) => ({ month: r.month, net: JSON.parse(r.snapshot).net, paid_at: r.paid_at })) });
      }
      let ps;
      if ((ps = p.match(/^\/api\/payslips\/(\d{4}-\d{2})$/)) && m === 'GET') {
        const run = await db.get("SELECT * FROM payroll_runs WHERE employee_id = ? AND month = ? AND status = 'paid'", [emp.id, ps[1]]);
        if (!run) throw new HttpError(404, 'Payslip not found');
        return json(200, { row: { ...JSON.parse(run.snapshot), status: 'paid', paid_at: run.paid_at }, company: await getSetting('company') });
      }
      if (p === '/api/leave' && m === 'GET') {
        const rows = await db.all('SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY start_date DESC, id DESC LIMIT 30', [emp.id]);
        return json(200, { requests: rows.map(withDays) });
      }
      if (p === '/api/leave' && m === 'POST') {
        const b = await readBody(req);
        if (!LEAVE_TYPES.includes(b.type)) throw new HttpError(400, 'Choose a type of leave');
        if (!isDate(b.start) || !isDate(b.end)) throw new HttpError(400, 'Choose the dates');
        if (b.end < b.start) throw new HttpError(400, 'The end date is before the start date');
        if (leaveDays({ start_date: b.start, end_date: b.end }) > 60) throw new HttpError(400, 'A request can be at most 60 days');
        const half = b.half && b.start === b.end ? 1 : 0;
        const { lastId } = await db.run('INSERT INTO leave_requests(employee_id, type, start_date, end_date, half_day, note, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
          [emp.id, b.type, b.start, b.end, half, String(b.note || '').slice(0, 300), 'pending', Date.now()]);
        const r = await db.get('SELECT * FROM leave_requests WHERE id = ?', [lastId]);
        later(notify('admin', null, (lang) => ({
          title: lang === 'zh' ? `${emp.name} 申請${LEAVE_LABEL.zh[r.type]}` : `${emp.name} asked for time off`,
          body: `${LEAVE_LABEL[lang][r.type]} · ${fmtRange(r, lang)}${r.half_day ? (lang === 'zh' ? '（半天）' : ' (half day)') : ''}${r.note ? ` · ${r.note}` : ''}`,
          url: '/admin#timeoff', tag: `leave-${r.id}`,
        }), origin));
        return json(201, withDays(r));
      }
      let lm;
      if ((lm = p.match(/^\/api\/leave\/(\d+)\/cancel$/)) && m === 'POST') {
        const r = await db.get('SELECT * FROM leave_requests WHERE id = ? AND employee_id = ?', [Number(lm[1]), emp.id]);
        if (!r) throw new HttpError(404, 'Request not found');
        if (r.status !== 'pending') throw new HttpError(400, 'Only a pending request can be cancelled');
        await db.run("UPDATE leave_requests SET status = 'cancelled', decided_at = ?, seen = 1 WHERE id = ?", [Date.now(), r.id]);
        return json(200, { ok: true });
      }
      if (p === '/api/leave/seen' && m === 'POST') {
        await db.run("UPDATE leave_requests SET seen = 1 WHERE employee_id = ? AND status IN ('approved', 'rejected')", [emp.id]);
        return json(200, { ok: true });
      }
    }

    // Admin
    if (p.startsWith('/api/admin/')) {
      if (p === '/api/admin/logout' && m === 'POST') return json(200, { ok: true }, { 'Set-Cookie': await clearSession(req, 'admin') });
      if (!(await getSession(req, 'admin'))) throw new HttpError(401, 'Not signed in');

      if (p === '/api/admin/overview' && m === 'GET') return json(200, await overview());

      if (p === '/api/admin/employees' && m === 'POST') {
        const b = await readBody(req);
        if (!b.name?.trim()) throw new HttpError(400, 'Name is required');
        if (!validPin(b.pin)) throw new HttpError(400, 'PIN must be 4–6 digits');
        const { n } = await db.get('SELECT COUNT(*) AS n FROM employees');
        const pf = payFields(b);
        const { lastId } = await db.run(`INSERT INTO employees(name, role, pin_hash, color, hourly_rate, leave_hours, pay_type, monthly_salary, daily_hours, work_days, insurance, start_date, active, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [b.name.trim().slice(0, 40), String(b.role || '').trim().slice(0, 40), await hashSecret(b.pin), EMPLOYEE_COLORS[n % EMPLOYEE_COLORS.length], Number(b.hourly_rate) || 0, leaveHours(b.leave_hours, 8),
            pf.pay_type, pf.monthly_salary, pf.daily_hours, pf.work_days, pf.insurance, pf.start_date, Date.now()]);
        await db.run('UPDATE employees SET leave_system = ? WHERE id = ?', [pf.leave_system, lastId]);
        return json(201, publicEmployee(await db.get('SELECT * FROM employees WHERE id = ?', [lastId])));
      }
      let mm;
      if ((mm = p.match(/^\/api\/admin\/employees\/(\d+)$/)) && m === 'PATCH') {
        const b = await readBody(req);
        const emp = await db.get('SELECT * FROM employees WHERE id = ?', [Number(mm[1])]);
        if (!emp) throw new HttpError(404, 'Employee not found');
        if (b.pin !== undefined && b.pin !== '' && !validPin(b.pin)) throw new HttpError(400, 'PIN must be 4–6 digits');
        await db.run('UPDATE employees SET name = ?, role = ?, hourly_rate = ?, leave_hours = ?, active = ?, pin_hash = ? WHERE id = ?', [
          b.name?.trim()?.slice(0, 40) || emp.name, b.role !== undefined ? String(b.role).trim().slice(0, 40) : emp.role,
          b.hourly_rate !== undefined ? Number(b.hourly_rate) || 0 : emp.hourly_rate,
          b.leave_hours !== undefined ? leaveHours(b.leave_hours, emp.leave_hours ?? 8) : (emp.leave_hours ?? 8),
          b.active !== undefined ? (b.active ? 1 : 0) : emp.active,
          b.pin ? await hashSecret(b.pin) : emp.pin_hash, emp.id]);
        const pf = payFields(b, emp);
        await db.run('UPDATE employees SET pay_type = ?, monthly_salary = ?, daily_hours = ?, work_days = ?, insurance = ?, start_date = ?, leave_system = ? WHERE id = ?',
          [pf.pay_type, pf.monthly_salary, pf.daily_hours, pf.work_days, pf.insurance, pf.start_date, pf.leave_system, emp.id]);
        if (b.active === false) await db.run("DELETE FROM sessions WHERE kind = 'emp' AND employee_id = ?", [emp.id]);
        return json(200, publicEmployee(await db.get('SELECT * FROM employees WHERE id = ?', [emp.id])));
      }

      if (p === '/api/admin/shifts' && m === 'GET') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from/to required');
        const shifts = await shiftsInRange(from, to, Number(url.searchParams.get('employee')) || null);
        const leave = await leaveEntries(from, to, Number(url.searchParams.get('employee')) || null);
        return json(200, { now: Date.now(), shifts: shifts.map((s) => ({ ...s, day: dayKey(s.clock_in) })), leave });
      }
      if (p === '/api/admin/shifts' && m === 'POST') {
        const b = await readBody(req);
        const emp = await db.get('SELECT id FROM employees WHERE id = ?', [Number(b.employee_id) || 0]);
        if (!emp) throw new HttpError(400, 'Choose an employee');
        const { cin, cout } = parseShiftTimes(b);
        await db.run('INSERT INTO shifts(employee_id, clock_in, clock_out, break_min, note, edited) VALUES(?, ?, ?, ?, ?, 1)',
          [emp.id, cin, cout, Math.max(0, Number(b.break_min) || 0), String(b.note || '').slice(0, 200)]);
        return json(201, { ok: true });
      }
      if ((mm = p.match(/^\/api\/admin\/shifts\/(\d+)$/))) {
        const shift = await db.get('SELECT * FROM shifts WHERE id = ?', [Number(mm[1])]);
        if (!shift) throw new HttpError(404, 'Shift not found');
        if (m === 'DELETE') { await db.run('DELETE FROM shifts WHERE id = ?', [shift.id]); return json(200, { ok: true }); }
        if (m === 'PATCH') {
          const b = await readBody(req);
          const { cin, cout } = parseShiftTimes(b);
          await db.run('UPDATE shifts SET clock_in = ?, clock_out = ?, break_min = ?, note = ?, edited = 1 WHERE id = ?',
            [cin, cout, Math.max(0, Number(b.break_min) || 0), String(b.note || '').slice(0, 200), shift.id]);
          return json(200, { ok: true });
        }
      }

      if (p === '/api/admin/leave' && m === 'GET') {
        const rows = await db.all(`SELECT l.*, e.name, e.color FROM leave_requests l JOIN employees e ON e.id = l.employee_id
          WHERE l.status = 'pending' OR l.end_date >= ? OR l.created_at >= ? ORDER BY l.start_date DESC, l.id DESC LIMIT 200`,
          [addDays(dayKey(Date.now()), -60), Date.now() - 60 * 86400e3]);
        return json(200, { today: dayKey(Date.now()), requests: rows.map(withDays) });
      }
      if ((mm = p.match(/^\/api\/admin\/leave\/(\d+)$/)) && m === 'POST') {
        const b = await readBody(req);
        if (!['approved', 'rejected'].includes(b.status)) throw new HttpError(400, 'Invalid decision');
        const r = await db.get('SELECT l.*, e.name FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?', [Number(mm[1])]);
        if (!r) throw new HttpError(404, 'Request not found');
        if (r.status === 'cancelled') throw new HttpError(400, 'This request was cancelled');
        const note = String(b.manager_note || '').slice(0, 300);
        await db.run('UPDATE leave_requests SET status = ?, manager_note = ?, decided_at = ?, seen = 0 WHERE id = ?', [b.status, note, Date.now(), r.id]);
        const ok = b.status === 'approved';
        later(notify('emp', r.employee_id, (lang) => ({
          title: lang === 'zh' ? (ok ? '休假已核准 ✓' : '休假未核准') : (ok ? 'Time off approved ✓' : 'Time off declined'),
          body: `${LEAVE_LABEL[lang][r.type]} · ${fmtRange(r, lang)}${note ? ` · ${note}` : ''}`,
          url: '/#timeoff', tag: `leave-${r.id}`,
        }), origin));
        return json(200, { ok: true });
      }

      if (p === '/api/admin/balances' && m === 'GET') {
        const employees = await db.all('SELECT * FROM employees WHERE active = 1 ORDER BY name');
        return json(200, { today: dayKey(Date.now()), balances: await balancesFor(employees) });
      }
      let bm;
      if ((bm = p.match(/^\/api\/admin\/balances\/(\d+)\/(settle|adjust)(?:\/([\w-]+))?$/))) {
        const [, idStr, kind, key] = bm;
        const emp = await db.get('SELECT * FROM employees WHERE id = ?', [Number(idStr)]);
        if (!emp) throw new HttpError(404, 'Employee not found');
        const [bal] = await balancesFor([emp]);
        if (kind === 'settle' && m === 'POST') {
          const prev = bal.previous;
          if (!prev) throw new HttpError(400, 'There is no closed leave year to settle');
          if (prev.decision) throw new HttpError(400, 'This year is already settled. Undo it first.');
          const b = await readBody(req);
          if (!['carry', 'payout', 'none'].includes(b.action)) throw new HttpError(400, 'Invalid decision');
          const days = b.action === 'none' ? 0 : Number(b.days ?? prev.unused);
          if (b.action !== 'none' && !(days > 0 && days <= prev.unused + 0.001)) throw new HttpError(400, 'Days must be more than 0 and at most the unused days');
          const month = b.action === 'payout' ? (/^\d{4}-\d{2}$/.test(b.month || '') ? b.month : dayKey(Date.now()).slice(0, 7)) : null;
          if (month) {
            const run = await db.get("SELECT status FROM payroll_runs WHERE month = ? AND employee_id = ?", [month, emp.id]);
            if (run?.status === 'paid') throw new HttpError(400, 'That month is already paid. Choose another month or reopen the payslip.');
          }
          await db.run('INSERT INTO leave_settle(employee_id, period_from, action, days, target_from, payout_month, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
            [emp.id, prev.from, b.action, days, b.action === 'carry' ? bal.annual.from : null, month, Date.now()]);
          return json(200, { ok: true });
        }
        if (kind === 'settle' && m === 'DELETE' && key) {
          const st = await db.get('SELECT * FROM leave_settle WHERE employee_id = ? AND period_from = ?', [emp.id, key]);
          if (!st) throw new HttpError(404, 'Not found');
          if (st.action === 'payout') {
            const run = await db.get("SELECT status FROM payroll_runs WHERE month = ? AND employee_id = ?", [st.payout_month, emp.id]);
            if (run?.status === 'paid') throw new HttpError(400, 'That month is already paid. Reopen the payslip first.');
          }
          await db.run('DELETE FROM leave_settle WHERE employee_id = ? AND period_from = ?', [emp.id, key]);
          return json(200, { ok: true });
        }
        if (kind === 'adjust' && m === 'POST') {
          if (bal.annual?.status !== 'active') throw new HttpError(400, 'Add a start date first');
          const b = await readBody(req);
          const days = Number(b.days);
          if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 60) throw new HttpError(400, 'Days must be between −60 and 60 (not 0)');
          await db.run('INSERT INTO leave_adjust(employee_id, period_from, days, note, created_at) VALUES(?, ?, ?, ?, ?)',
            [emp.id, bal.annual.from, Math.round(days * 10) / 10, String(b.note || '').slice(0, 120), Date.now()]);
          return json(200, { ok: true });
        }
        if (kind === 'adjust' && m === 'DELETE' && key) {
          await db.run('DELETE FROM leave_adjust WHERE id = ? AND employee_id = ?', [Number(key), emp.id]);
          return json(200, { ok: true });
        }
      }
      if (p === '/api/admin/holidays' && m === 'GET') {
        const year = /^\d{4}$/.test(url.searchParams.get('year') || '') ? url.searchParams.get('year') : dayKey(Date.now()).slice(0, 4);
        return json(200, { year, holidays: await db.all('SELECT * FROM holidays WHERE date LIKE ? ORDER BY date', [`${year}-%`]) });
      }
      if (p === '/api/admin/holidays' && m === 'POST') {
        const b = await readBody(req);
        if (!isDate(b.date)) throw new HttpError(400, 'Choose the dates');
        if (!String(b.name_zh || b.name_en || '').trim()) throw new HttpError(400, 'Name is required');
        await db.run('INSERT INTO holidays(date, name_zh, name_en, source) VALUES(?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET name_zh = excluded.name_zh, name_en = excluded.name_en, source = excluded.source',
          [b.date, String(b.name_zh || b.name_en).trim().slice(0, 40), String(b.name_en || '').trim().slice(0, 60), 'custom']);
        return json(200, { ok: true });
      }
      let hm;
      if ((hm = p.match(/^\/api\/admin\/holidays\/(\d{4}-\d{2}-\d{2})$/)) && m === 'DELETE') {
        await db.run('DELETE FROM holidays WHERE date = ?', [hm[1]]);
        return json(200, { ok: true });
      }
      if (p === '/api/admin/holidays/restore' && m === 'POST') {
        const { year } = await readBody(req);
        for (const [date, zh, en] of TW_HOLIDAYS) {
          if (date.startsWith(String(year))) await db.run('INSERT INTO holidays(date, name_zh, name_en, source) VALUES(?, ?, ?, ?) ON CONFLICT(date) DO NOTHING', [date, zh, en, 'official']);
        }
        return json(200, { ok: true });
      }

      // ---------- history: import, standard schedule, manager-entered leave ----------
      if (p === '/api/admin/import/shifts' && m === 'POST') {
        const { rows, dry_run } = await readBody(req);
        if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'Nothing to import');
        if (rows.length > 1000) throw new HttpError(400, 'Send at most 1000 rows at a time');
        const emps = new Map((await db.all('SELECT id FROM employees')).map((e) => [e.id, e]));
        const results = [], toInsert = [];
        // existing shifts of these employees in the date range, to skip duplicates
        const dates = rows.map((r) => r.date).filter(isDate).sort();
        const existing = dates.length ? await db.all('SELECT employee_id, clock_in FROM shifts WHERE clock_in >= ? AND clock_in < ?',
          [zonedToMs(dates[0]), zonedToMs(addDays(dates[dates.length - 1], 2))]) : [];
        const seen = new Set(existing.map((x) => `${x.employee_id}|${x.clock_in}`));
        for (const r of rows) {
          try {
            if (!emps.has(Number(r.employee_id))) throw new HttpError(400, 'Unknown employee');
            const { cin, cout } = parseShiftTimes({ date: r.date, in: r.in, out: r.out });
            if (!cout) throw new HttpError(400, 'Clock-out time is missing');
            if (cout - cin > 24 * 3600e3) throw new HttpError(400, 'Shift longer than 24 hours');
            const key = `${Number(r.employee_id)}|${cin}`;
            if (seen.has(key)) { results.push({ status: 'duplicate' }); continue; }
            seen.add(key);
            const brk = Math.max(0, Math.min(600, Number(r.break_min) || 0));
            toInsert.push([Number(r.employee_id), cin, cout, brk, String(r.note || '').slice(0, 200)]);
            results.push({ status: 'ok' });
          } catch (e) { results.push({ status: 'error', error: e.message }); }
        }
        if (!dry_run) await db.runMany('INSERT INTO shifts(employee_id, clock_in, clock_out, break_min, note, edited) VALUES(?, ?, ?, ?, ?, 1)', toInsert);
        return json(200, { results, imported: dry_run ? 0 : toInsert.length, ready: toInsert.length });
      }
      if (p === '/api/admin/backfill' && m === 'POST') {
        const b = await readBody(req);
        const emp = await db.get('SELECT * FROM employees WHERE id = ?', [Number(b.employee_id) || 0]);
        if (!emp) throw new HttpError(400, 'Choose an employee');
        if (!isDate(b.from) || !isDate(b.to) || b.to < b.from) throw new HttpError(400, 'Choose the dates');
        if (b.to > dayKey(Date.now())) throw new HttpError(400, 'The schedule can only be filled up to today');
        if (Date.parse(b.to) - Date.parse(b.from) > 8 * 366 * 86400e3) throw new HttpError(400, 'Fill at most 8 years at a time');
        if (!isTime(b.in) || !isTime(b.out)) throw new HttpError(400, 'Date and clock-in time are required');
        const wd = workDaySet(emp);
        const [hol, leave, existing] = await Promise.all([
          b.skip_holidays === false ? new Set() : db.all('SELECT date FROM holidays WHERE date >= ? AND date <= ?', [b.from, b.to]).then((r) => new Set(r.map((x) => x.date))),
          db.all("SELECT * FROM leave_requests WHERE employee_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?", [emp.id, b.to, b.from]),
          db.all('SELECT clock_in FROM shifts WHERE employee_id = ? AND clock_in >= ? AND clock_in < ?', [emp.id, zonedToMs(b.from), zonedToMs(addDays(b.to, 1))]),
        ]);
        const worked = new Set(existing.map((x) => dayKey(x.clock_in)));
        const onLeave = (d) => leave.some((l) => l.start_date <= d && l.end_date >= d && !l.half_day);
        const rows = [];
        let skipped = { off: 0, holiday: 0, leave: 0, existing: 0 };
        for (let d = b.from; d <= b.to; d = addDays(d, 1)) {
          if (!wd.has(wdOf(d))) { skipped.off++; continue; }
          if (hol.has(d)) { skipped.holiday++; continue; }
          if (onLeave(d)) { skipped.leave++; continue; }
          if (worked.has(d)) { skipped.existing++; continue; }
          const { cin, cout } = parseShiftTimes({ date: d, in: b.in, out: b.out });
          rows.push([emp.id, cin, cout, Math.max(0, Number(b.break_min) || 0), String(b.note || 'Standard schedule').slice(0, 200)]);
        }
        if (!b.dry_run) {
          for (let i = 0; i < rows.length; i += 200) await db.runMany('INSERT INTO shifts(employee_id, clock_in, clock_out, break_min, note, edited) VALUES(?, ?, ?, ?, ?, 1)', rows.slice(i, i + 200));
        }
        const holidayYears = (await db.all("SELECT DISTINCT substr(date, 1, 4) AS y FROM holidays")).map((x) => x.y);
        const years = []; for (let y = Number(b.from.slice(0, 4)); y <= Number(b.to.slice(0, 4)); y++) years.push(String(y));
        return json(200, { days: rows.length, created: b.dry_run ? 0 : rows.length, skipped, years_without_holidays: years.filter((y) => !holidayYears.includes(y)) });
      }
      if (p === '/api/admin/leave' && m === 'POST') {
        const b = await readBody(req);
        const emp = await db.get('SELECT * FROM employees WHERE id = ?', [Number(b.employee_id) || 0]);
        if (!emp) throw new HttpError(400, 'Choose an employee');
        if (!LEAVE_TYPES.includes(b.type)) throw new HttpError(400, 'Choose a type of leave');
        if (!isDate(b.start) || !isDate(b.end)) throw new HttpError(400, 'Choose the dates');
        if (b.end < b.start) throw new HttpError(400, 'The end date is before the start date');
        if (leaveDays({ start_date: b.start, end_date: b.end }) > 60) throw new HttpError(400, 'A request can be at most 60 days');
        const now = Date.now();
        await db.run("INSERT INTO leave_requests(employee_id, type, start_date, end_date, half_day, note, status, manager_note, created_at, decided_at, seen) VALUES(?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, 1)",
          [emp.id, b.type, b.start, b.end, b.half && b.start === b.end ? 1 : 0, String(b.note || '').slice(0, 300), 'Added by manager', now, now]);
        return json(201, { ok: true });
      }

      const isMonth = (x) => typeof x === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
      if (p === '/api/admin/payroll' && m === 'GET') {
        const month = url.searchParams.get('month');
        if (!isMonth(month)) throw new HttpError(400, 'Choose a month');
        return json(200, await payrollMonth(month));
      }
      if (p === '/api/admin/payroll.csv' && m === 'GET') {
        const month = url.searchParams.get('month');
        if (!isMonth(month)) throw new HttpError(400, 'Choose a month');
        return new Response(payrollCsv(await payrollMonth(month), url.searchParams.get('lang')), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="parsley-payroll-${month}.csv"` } });
      }
      let pm;
      if ((pm = p.match(/^\/api\/admin\/payroll\/(\d{4}-\d{2})\/(\d+)(?:\/(paid|reopen))?$/))) {
        const [, month, idStr, action] = pm;
        if (!isMonth(month)) throw new HttpError(400, 'Choose a month');
        const id = Number(idStr);
        const emp = await db.get('SELECT * FROM employees WHERE id = ?', [id]);
        if (!emp) throw new HttpError(404, 'Employee not found');
        const run = await db.get('SELECT * FROM payroll_runs WHERE month = ? AND employee_id = ?', [month, id]);
        const ensureRun = () => db.run("INSERT INTO payroll_runs(month, employee_id) VALUES(?, ?) ON CONFLICT(month, employee_id) DO NOTHING", [month, id]);
        if (m === 'GET' && !action) {
          const pr = await payrollMonth(month, id);
          return json(200, { row: pr.rows[0], company: pr.company });
        }
        if (m === 'POST' && !action) {
          if (run?.status === 'paid') throw new HttpError(400, 'This payslip is already paid. Reopen it to make changes.');
          const b = await readBody(req);
          const nn = (v) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0; };
          await ensureRun();
          await db.run('UPDATE payroll_runs SET bonus = ?, deduction = ?, deduction_note = ?, insurance = ?, note = ? WHERE month = ? AND employee_id = ?',
            [nn(b.bonus), nn(b.deduction), String(b.deduction_note || '').slice(0, 100), b.insurance === '' || b.insurance == null ? null : nn(b.insurance), String(b.note || '').slice(0, 300), month, id]);
          return json(200, { ok: true });
        }
        if (m === 'POST' && action === 'paid') {
          await ensureRun();
          const pr = await payrollMonth(month, id);
          const row = pr.rows[0];
          if (row.open_shifts) throw new HttpError(400, 'Fix the shifts without a clock-out first.');
          const snap = { ...row }; delete snap.status; delete snap.paid_at; delete snap.changed_since_paid;
          await db.run("UPDATE payroll_runs SET status = 'paid', snapshot = ?, paid_at = ? WHERE month = ? AND employee_id = ?", [JSON.stringify(snap), Date.now(), month, id]);
          later(notify('emp', id, (lang) => ({
            title: lang === 'zh' ? '薪資單已發放' : 'Your payslip is ready',
            body: lang === 'zh' ? `${month} 實發 NT$ ${row.net.toLocaleString('en-US')}` : `${month} · net NT$ ${row.net.toLocaleString('en-US')}`,
            url: `/payslip?month=${month}`, tag: `payslip-${month}`,
          }), origin));
          return json(200, { ok: true });
        }
        if (m === 'POST' && action === 'reopen') {
          await db.run("UPDATE payroll_runs SET status = 'draft', snapshot = NULL, paid_at = NULL WHERE month = ? AND employee_id = ?", [month, id]);
          return json(200, { ok: true });
        }
      }

      if (p === '/api/admin/export.csv' && m === 'GET') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from/to required');
        const csv = await exportCsv(from, to, Number(url.searchParams.get('employee')) || null, url.searchParams.get('lang'));
        return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="parsley-timesheet-${from}_to_${to}.csv"` } });
      }

      if (p === '/api/admin/settings' && m === 'POST') {
        const b = await readBody(req);
        if (b.newPassword !== undefined) {
          if (!(await verifySecret(String(b.currentPassword ?? ''), await getSetting('admin_hash')))) throw new HttpError(400, 'Current password is wrong');
          if (String(b.newPassword).length < 6) throw new HttpError(400, 'New password needs at least 6 characters');
          await setSetting('admin_hash', await hashSecret(b.newPassword));
          await setSetting('admin_default', '0');
        }
        if (b.company?.trim()) await setSetting('company', b.company.trim().slice(0, 60));
        if (b.geo !== undefined) await setSetting('geo', b.geo ? '1' : '0');
        if (b.leave_pay !== undefined) {
          const rates = {};
          for (const k of LEAVE_TYPES) {
            const v = Number(b.leave_pay?.[k]);
            if (!(v >= 0 && v <= 100)) throw new HttpError(400, 'Leave pay must be between 0 and 100%');
            rates[k] = v;
          }
          await setSetting('leave_pay', JSON.stringify(rates));
        }
        if (b.payroll !== undefined) {
          const c = b.payroll || {};
          const n = (v, lo, hi, msg) => { const x = Number(v); if (!(x >= lo && x <= hi)) throw new HttpError(400, msg); return x; };
          await setSetting('payroll', JSON.stringify({
            ot_auto: !!c.ot_auto,
            ot_rate1: n(c.ot_rate1, 1, 3, 'Overtime rates must be between 1 and 3'),
            ot_tier: n(c.ot_tier, 0, 12, 'Overtime hours must be between 0 and 12'),
            ot_rate2: n(c.ot_rate2, 1, 3, 'Overtime rates must be between 1 and 3'),
            divisor: n(c.divisor, 1, 400, 'Hours per month must be between 1 and 400'),
            holiday_full_day: c.holiday_full_day !== false,
            holiday_pay_hourly: c.holiday_pay_hourly !== false,
          }));
        }
        if (b.alert_hours !== undefined) {
          const h = Number(b.alert_hours);
          if (!(h >= 1 && h <= 24)) throw new HttpError(400, 'Warning time must be between 1 and 24 hours');
          await setSetting('alert_hours', String(h));
        }
        return json(200, { ok: true });
      }
    }
    throw new HttpError(404, 'Not found');
  }

  return {
    ready: ensureReady,
    time: { dayKey, zonedToMs },
    // Returns a Response for API routes, or null so the host can serve static files.
    async handle(req, { ip = 'unknown', defer = (pr) => { pr.catch(() => {}); } } = {}) {
      const p = new URL(req.url).pathname;
      if (!p.startsWith('/api/') && p !== '/healthz') return null;
      try {
        await ensureReady();
        return await route(req, ip, defer);
      } catch (err) {
        if (!(err instanceof HttpError)) console.error(err);
        return json(err.status || 500, { error: err instanceof HttpError ? err.message : 'Server error' });
      }
    },
  };
}
