// Parsley Time Tracker — zero-dependency Node.js server (Node >= 22.5)
// Serves the installable employee app (/), the admin dashboard (/admin) and a JSON API.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const TZ = process.env.APP_TIMEZONE || 'Asia/Taipei';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const EMP_SESSION_DAYS = 180; // employees stay signed in on their phone
const ADMIN_SESSION_HOURS = 12;

// Categorical palette (validated for colour-blind separation), assigned in order.
const EMPLOYEE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'parsley.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT DEFAULT '',
    pin_hash TEXT NOT NULL,
    color TEXT NOT NULL,
    hourly_rate REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    clock_in INTEGER NOT NULL,
    clock_out INTEGER,
    in_lat REAL, in_lng REAL, out_lat REAL, out_lng REAL,
    break_min INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    edited INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_shifts_emp ON shifts(employee_id, clock_in);
  CREATE INDEX IF NOT EXISTS idx_shifts_in ON shifts(clock_in);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    employee_id INTEGER,
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// ---------- helpers ----------
const hash = (secret) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(secret), salt, 32).toString('hex')}`;
};
const verify = (secret, stored) => {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const a = crypto.scryptSync(String(secret), salt, 32);
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

if (!getSetting('admin_hash')) {
  const initial = process.env.ADMIN_PASSWORD || 'parsley';
  setSetting('admin_hash', hash(initial));
  setSetting('admin_default', process.env.ADMIN_PASSWORD ? '0' : '1');
  console.log(`[parsley] Admin password initialised${process.env.ADMIN_PASSWORD ? ' from ADMIN_PASSWORD' : ' to the default "parsley" — change it in Settings'}.`);
}
if (!getSetting('company')) setSetting('company', 'Parsley 帕斯里');

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (ms) => dayFmt.format(new Date(ms)); // YYYY-MM-DD in business timezone
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

// Convert a local (business timezone) date + time into epoch ms.
function zonedToMs(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = tzOffset(guess);
  let ms = guess - offset;
  const off2 = tzOffset(ms); // handle DST edges (not used in Taiwan, but safe)
  if (off2 !== offset) ms = guess - off2;
  return ms;
}
function tzOffset(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekday = (dateStr) => new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
const workedMs = (s, now = Date.now()) => Math.max(0, (s.clock_out ?? now) - s.clock_in - (s.break_min || 0) * 60000);

const publicEmployee = (e) => e && ({ id: e.id, name: e.name, role: e.role, color: e.color, hourly_rate: e.hourly_rate, active: !!e.active, created_at: e.created_at });

// ---------- sessions & rate limiting ----------
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((c) => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}
function createSession(res, req, kind, employeeId, ttlMs) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token, kind, employee_id, expires) VALUES(?, ?, ?, ?)').run(token, kind, employeeId ?? null, Date.now() + ttlMs);
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${kind}_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`);
}
function getSession(req, kind) {
  const token = parseCookies(req)[`${kind}_session`];
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ? AND kind = ?').get(token, kind);
  if (!s || s.expires < Date.now()) return null;
  return s;
}
function clearSession(req, res, kind) {
  const token = parseCookies(req)[`${kind}_session`];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${kind}_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600e3).unref();

const attempts = new Map(); // ip -> { count, until }
function rateLimited(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const a = attempts.get(ip) || { count: 0, first: Date.now() };
  if (Date.now() - a.first > 15 * 60e3) { a.count = 0; a.first = Date.now(); }
  a.count++;
  attempts.set(ip, a);
  return a.count > 20;
}

// ---------- HTTP plumbing ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const send = (res, status, body, headers = {}) => {
  const isStr = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 1e5) { reject(new HttpError(413, 'Too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
});

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const ext = path.extname(file);
    const noCache = ext === '.html' || pathname === '/sw.js' || ext === '.webmanifest';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- domain ----------
const openShift = (empId) => db.prepare('SELECT * FROM shifts WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1').get(empId);

function employeeSummary(emp) {
  const now = Date.now();
  const today = dayKey(now);
  const mondayOffset = (weekday(today) + 6) % 7;
  const weekStart = addDays(today, -mondayOffset);
  const monthStart = today.slice(0, 8) + '01';
  const from = zonedToMs(monthStart < weekStart ? monthStart : weekStart);
  const shifts = db.prepare('SELECT * FROM shifts WHERE employee_id = ? AND (clock_in >= ? OR clock_out IS NULL) ORDER BY clock_in DESC').all(emp.id, from);
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
    open: openShift(emp.id) || null,
    todayShifts: shifts.filter((s) => dayKey(s.clock_in) === today).sort((a, b) => a.clock_in - b.clock_in),
    recent: shifts.filter((s) => s.clock_out && dayKey(s.clock_in) !== today).slice(0, 10),
    week, todayMs, monthMs, now, today, timezone: TZ, geo: getSetting('geo') === '1',
  };
}

function shiftsInRange(fromDate, toDate, employeeId) {
  const from = zonedToMs(fromDate), to = zonedToMs(addDays(toDate, 1));
  const q = `SELECT s.*, e.name, e.color, e.hourly_rate FROM shifts s JOIN employees e ON e.id = s.employee_id
             WHERE s.clock_in >= ? AND s.clock_in < ? ${employeeId ? 'AND s.employee_id = ?' : ''} ORDER BY s.clock_in DESC`;
  return employeeId ? db.prepare(q).all(from, to, employeeId) : db.prepare(q).all(from, to);
}

function overview() {
  const now = Date.now();
  const today = dayKey(now);
  const weekStart = addDays(today, -((weekday(today) + 6) % 7));
  const monthStart = today.slice(0, 8) + '01';
  const chartStart = addDays(today, -13);
  const from = [monthStart, weekStart, chartStart].sort()[0];
  const employees = db.prepare('SELECT * FROM employees ORDER BY created_at').all();
  const shifts = shiftsInRange(from, today);
  const days = Array.from({ length: 14 }, (_, i) => ({ date: addDays(chartStart, i), byEmp: {} }));
  const totals = { todayMs: 0, weekMs: 0, monthMs: 0, monthPay: 0 };
  const perEmp = Object.fromEntries(employees.map((e) => [e.id, { todayMs: 0, weekMs: 0, monthMs: 0 }]));
  for (const s of shifts) {
    const d = dayKey(s.clock_in), w = workedMs(s, now), pe = perEmp[s.employee_id];
    const slot = days.find((x) => x.date === d);
    if (slot) slot.byEmp[s.employee_id] = (slot.byEmp[s.employee_id] || 0) + w;
    if (d === today) { totals.todayMs += w; pe.todayMs += w; }
    if (d >= weekStart) { totals.weekMs += w; pe.weekMs += w; }
    if (d >= monthStart) { totals.monthMs += w; pe.monthMs += w; totals.monthPay += (w / 3600e3) * (s.hourly_rate || 0); }
  }
  const onShift = db.prepare(`SELECT s.*, e.name, e.color, e.role FROM shifts s JOIN employees e ON e.id = s.employee_id WHERE s.clock_out IS NULL ORDER BY s.clock_in`).all();
  const activity = db.prepare(`SELECT s.*, e.name, e.color FROM shifts s JOIN employees e ON e.id = s.employee_id ORDER BY MAX(s.clock_in, COALESCE(s.clock_out, 0)) DESC LIMIT 12`).all();
  return {
    now, today, timezone: TZ, company: getSetting('company'), geo: getSetting('geo') === '1',
    adminDefaultPassword: getSetting('admin_default') === '1',
    employees: employees.map((e) => ({ ...publicEmployee(e), ...perEmp[e.id], onShift: onShift.some((s) => s.employee_id === e.id) })),
    totals, onShift, days, activity,
  };
}

function toCsv(rows) {
  const esc = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
function exportCsv(fromDate, toDate, employeeId) {
  const shifts = shiftsInRange(fromDate, toDate, employeeId).filter((s) => s.clock_out).reverse();
  const rows = [['Employee', 'Date', 'Clock in', 'Clock out', 'Break (min)', 'Duration (hours)', 'Duration (h:m)', 'Hourly rate', 'Gross', 'Note']];
  const totals = {};
  for (const s of shifts) {
    const ms = workedMs(s);
    const hrs = ms / 3600e3;
    const mins = Math.round(ms / 60000);
    rows.push([s.name, dayKey(s.clock_in), timeFmt.format(s.clock_in), timeFmt.format(s.clock_out), s.break_min || 0, hrs.toFixed(2),
      `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`, s.hourly_rate || 0, Math.round(hrs * (s.hourly_rate || 0)), s.note || '']);
    const t = (totals[s.name] ||= { ms: 0, pay: 0 });
    t.ms += ms; t.pay += hrs * (s.hourly_rate || 0);
  }
  rows.push([]);
  for (const [name, t] of Object.entries(totals)) {
    const mins = Math.round(t.ms / 60000);
    rows.push([`TOTAL ${name}`, '', '', '', '', (t.ms / 3600e3).toFixed(2), `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`, '', Math.round(t.pay), '']);
  }
  return toCsv(rows);
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
const validPin = (p) => typeof p === 'string' && /^\d{4,6}$/.test(p);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;

  // Public
  if (p === '/api/team' && m === 'GET') {
    return send(res, 200, { company: getSetting('company'), timezone: TZ, geo: getSetting('geo') === '1', employees: db.prepare('SELECT id, name, role, color FROM employees WHERE active = 1 ORDER BY name').all() });
  }
  if (p === '/api/login' && m === 'POST') {
    if (rateLimited(req)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const { employeeId, pin } = await readBody(req);
    const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND active = 1').get(Number(employeeId));
    if (!emp || !verify(String(pin ?? ''), emp.pin_hash)) throw new HttpError(401, 'Wrong PIN');
    createSession(res, req, 'emp', emp.id, EMP_SESSION_DAYS * 86400e3);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/login' && m === 'POST') {
    if (rateLimited(req)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const { password } = await readBody(req);
    if (!verify(String(password ?? ''), getSetting('admin_hash'))) throw new HttpError(401, 'Wrong password');
    createSession(res, req, 'admin', null, ADMIN_SESSION_HOURS * 3600e3);
    return send(res, 200, { ok: true });
  }

  // Employee
  if (p.startsWith('/api/me') || p === '/api/punch' || p === '/api/logout') {
    const s = getSession(req, 'emp');
    const emp = s && db.prepare('SELECT * FROM employees WHERE id = ? AND active = 1').get(s.employee_id);
    if (p === '/api/logout' && m === 'POST') { clearSession(req, res, 'emp'); return send(res, 200, { ok: true }); }
    if (!emp) throw new HttpError(401, 'Not signed in');
    if (p === '/api/me' && m === 'GET') return send(res, 200, employeeSummary(emp));
    if (p === '/api/punch' && m === 'POST') {
      const { lat, lng } = await readBody(req);
      const open = openShift(emp.id);
      const now = Date.now();
      if (open) {
        db.prepare('UPDATE shifts SET clock_out = ?, out_lat = ?, out_lng = ? WHERE id = ?').run(now, num(lat), num(lng), open.id);
      } else {
        db.prepare('INSERT INTO shifts(employee_id, clock_in, in_lat, in_lng) VALUES(?, ?, ?, ?)').run(emp.id, now, num(lat), num(lng));
      }
      return send(res, 200, { action: open ? 'out' : 'in', at: now, ...employeeSummary(emp) });
    }
  }

  // Admin
  if (p.startsWith('/api/admin/')) {
    if (p === '/api/admin/logout' && m === 'POST') { clearSession(req, res, 'admin'); return send(res, 200, { ok: true }); }
    if (!getSession(req, 'admin')) throw new HttpError(401, 'Not signed in');

    if (p === '/api/admin/overview' && m === 'GET') return send(res, 200, overview());

    if (p === '/api/admin/employees' && m === 'POST') {
      const b = await readBody(req);
      if (!b.name?.trim()) throw new HttpError(400, 'Name is required');
      if (!validPin(b.pin)) throw new HttpError(400, 'PIN must be 4–6 digits');
      const count = db.prepare('SELECT COUNT(*) AS n FROM employees').get().n;
      const r = db.prepare('INSERT INTO employees(name, role, pin_hash, color, hourly_rate, active, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)')
        .run(b.name.trim(), (b.role || '').trim(), hash(b.pin), EMPLOYEE_COLORS[count % EMPLOYEE_COLORS.length], Number(b.hourly_rate) || 0, Date.now());
      return send(res, 201, publicEmployee(db.prepare('SELECT * FROM employees WHERE id = ?').get(r.lastInsertRowid)));
    }
    let mm;
    if ((mm = p.match(/^\/api\/admin\/employees\/(\d+)$/)) && m === 'PATCH') {
      const b = await readBody(req);
      const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(mm[1]));
      if (!emp) throw new HttpError(404, 'Employee not found');
      if (b.pin !== undefined && b.pin !== '' && !validPin(b.pin)) throw new HttpError(400, 'PIN must be 4–6 digits');
      db.prepare('UPDATE employees SET name = ?, role = ?, hourly_rate = ?, active = ?, pin_hash = ? WHERE id = ?').run(
        b.name?.trim() || emp.name, b.role !== undefined ? String(b.role).trim() : emp.role,
        b.hourly_rate !== undefined ? Number(b.hourly_rate) || 0 : emp.hourly_rate,
        b.active !== undefined ? (b.active ? 1 : 0) : emp.active,
        b.pin ? hash(b.pin) : emp.pin_hash, emp.id);
      if (b.active === false) db.prepare("DELETE FROM sessions WHERE kind = 'emp' AND employee_id = ?").run(emp.id);
      return send(res, 200, publicEmployee(db.prepare('SELECT * FROM employees WHERE id = ?').get(emp.id)));
    }

    if (p === '/api/admin/shifts' && m === 'GET') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from/to required');
      const emp = Number(url.searchParams.get('employee')) || null;
      return send(res, 200, { now: Date.now(), shifts: shiftsInRange(from, to, emp).map((s) => ({ ...s, day: dayKey(s.clock_in) })) });
    }
    if (p === '/api/admin/shifts' && m === 'POST') {
      const b = await readBody(req);
      const emp = db.prepare('SELECT id FROM employees WHERE id = ?').get(Number(b.employee_id));
      if (!emp) throw new HttpError(400, 'Choose an employee');
      const { cin, cout } = parseShiftTimes(b);
      db.prepare('INSERT INTO shifts(employee_id, clock_in, clock_out, break_min, note, edited) VALUES(?, ?, ?, ?, ?, 1)')
        .run(emp.id, cin, cout, Math.max(0, Number(b.break_min) || 0), String(b.note || ''));
      return send(res, 201, { ok: true });
    }
    if ((mm = p.match(/^\/api\/admin\/shifts\/(\d+)$/))) {
      const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(Number(mm[1]));
      if (!shift) throw new HttpError(404, 'Shift not found');
      if (m === 'DELETE') { db.prepare('DELETE FROM shifts WHERE id = ?').run(shift.id); return send(res, 200, { ok: true }); }
      if (m === 'PATCH') {
        const b = await readBody(req);
        const { cin, cout } = parseShiftTimes(b);
        db.prepare('UPDATE shifts SET clock_in = ?, clock_out = ?, break_min = ?, note = ?, edited = 1 WHERE id = ?')
          .run(cin, cout, Math.max(0, Number(b.break_min) || 0), String(b.note || ''), shift.id);
        return send(res, 200, { ok: true });
      }
    }

    if (p === '/api/admin/export.csv' && m === 'GET') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from/to required');
      const emp = Number(url.searchParams.get('employee')) || null;
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="parsley-timesheet-${from}_to_${to}.csv"` });
      return res.end(exportCsv(from, to, emp));
    }

    if (p === '/api/admin/settings' && m === 'POST') {
      const b = await readBody(req);
      if (b.newPassword !== undefined) {
        if (!verify(String(b.currentPassword ?? ''), getSetting('admin_hash'))) throw new HttpError(400, 'Current password is wrong');
        if (String(b.newPassword).length < 6) throw new HttpError(400, 'New password needs at least 6 characters');
        setSetting('admin_hash', hash(b.newPassword));
        setSetting('admin_default', '0');
      }
      if (b.company?.trim()) setSetting('company', b.company.trim().slice(0, 60));
      if (b.geo !== undefined) setSetting('geo', b.geo ? '1' : '0');
      return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Not found');
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') { db.prepare('SELECT 1').get(); return send(res, 200, 'ok'); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`[parsley] Time tracker running on http://localhost:${PORT}  (admin: /admin, timezone: ${TZ})`));
}
module.exports = { server, db, zonedToMs, dayKey };
