// Parsley Time — platform-independent API core.
// Runs on Cloudflare Workers (D1) and on Node.js (node:sqlite) through a tiny async DB adapter:
//   db.all(sql, params) -> rows, db.get(sql, params) -> row|null, db.run(sql, params) -> { lastId }, db.batch(sqls)

const EMP_SESSION_DAYS = 180; // employees stay signed in on their phone
const ADMIN_SESSION_HOURS = 12;
const PBKDF2_ITERATIONS = 20000; // kept modest for the Workers CPU budget; logins are also rate-limited
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
const publicEmployee = (e) => e && ({ id: e.id, name: e.name, role: e.role, color: e.color, hourly_rate: e.hourly_rate, active: !!e.active, created_at: e.created_at });

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
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
const validPin = (p) => typeof p === 'string' && /^\d{4,6}$/.test(p);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------- app ----------
export function createApp({ db, timezone = 'Asia/Taipei', adminPassword } = {}) {
  const TZ = timezone;
  const { dayKey, zonedToMs, clock } = makeTime(TZ);
  let ready;

  const getSetting = async (k) => (await db.get('SELECT value FROM settings WHERE key = ?', [k]))?.value;
  const setSetting = (k, v) => db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]);

  async function init() {
    await db.batch(SCHEMA);
    if (!(await getSetting('admin_hash'))) {
      await setSetting('admin_hash', await hashSecret(adminPassword || 'parsley'));
      await setSetting('admin_default', adminPassword ? '0' : '1');
    }
    if (!(await getSetting('company'))) await setSetting('company', 'Parsley 帕斯里');
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
    };
  }

  function shiftsInRange(fromDate, toDate, employeeId) {
    const params = [zonedToMs(fromDate), zonedToMs(addDays(toDate, 1))];
    if (employeeId) params.push(employeeId);
    return db.all(`SELECT s.*, e.name, e.color, e.hourly_rate FROM shifts s JOIN employees e ON e.id = s.employee_id
      WHERE s.clock_in >= ? AND s.clock_in < ? ${employeeId ? 'AND s.employee_id = ?' : ''} ORDER BY s.clock_in DESC`, params);
  }

  async function overview() {
    const now = Date.now();
    const today = dayKey(now);
    const weekStart = addDays(today, -((weekday(today) + 6) % 7));
    const monthStart = today.slice(0, 8) + '01';
    const chartStart = addDays(today, -13);
    const from = [monthStart, weekStart, chartStart].sort()[0];
    const [employees, shifts, onShift, activity, company, adminDefault, geo] = await Promise.all([
      db.all('SELECT * FROM employees ORDER BY created_at'),
      shiftsInRange(from, today),
      db.all('SELECT s.*, e.name, e.color, e.role FROM shifts s JOIN employees e ON e.id = s.employee_id WHERE s.clock_out IS NULL ORDER BY s.clock_in'),
      db.all('SELECT s.*, e.name, e.color FROM shifts s JOIN employees e ON e.id = s.employee_id ORDER BY MAX(s.clock_in, COALESCE(s.clock_out, 0)) DESC LIMIT 12'),
      getSetting('company'), getSetting('admin_default'), getSetting('geo'),
    ]);
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
    return {
      now, today, timezone: TZ, company, geo: geo === '1', adminDefaultPassword: adminDefault === '1',
      employees: employees.map((e) => ({ ...publicEmployee(e), ...perEmp[e.id], onShift: onShift.some((s) => s.employee_id === e.id) })),
      totals, onShift, days, activity,
    };
  }

  async function exportCsv(fromDate, toDate, employeeId) {
    const shifts = (await shiftsInRange(fromDate, toDate, employeeId)).filter((s) => s.clock_out).reverse();
    const hm = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
    const rows = [['Employee', 'Date', 'Clock in', 'Clock out', 'Break (min)', 'Duration (hours)', 'Duration (h:m)', 'Hourly rate', 'Gross', 'Note']];
    const totals = {};
    for (const s of shifts) {
      const ms = workedMs(s), hrs = ms / 3600e3;
      rows.push([s.name, dayKey(s.clock_in), clock(s.clock_in), clock(s.clock_out), s.break_min || 0, hrs.toFixed(2), hm(ms), s.hourly_rate || 0, Math.round(hrs * (s.hourly_rate || 0)), s.note || '']);
      const t = (totals[s.name] ||= { ms: 0, pay: 0 });
      t.ms += ms; t.pay += hrs * (s.hourly_rate || 0);
    }
    rows.push([]);
    for (const [name, t] of Object.entries(totals)) rows.push([`TOTAL ${name}`, '', '', '', '', (t.ms / 3600e3).toFixed(2), hm(t.ms), '', Math.round(t.pay), '']);
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

  // routes
  async function route(req, ip) {
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
    if (p === '/api/admin/login' && m === 'POST') {
      if (await rateLimited(ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
      const { password } = await readBody(req);
      if (!(await verifySecret(String(password ?? ''), await getSetting('admin_hash')))) throw new HttpError(401, 'Wrong password');
      return json(200, { ok: true }, { 'Set-Cookie': await createSession(req, 'admin', null, ADMIN_SESSION_HOURS * 3600e3) });
    }

    // Employee
    if (p === '/api/logout' && m === 'POST') return json(200, { ok: true }, { 'Set-Cookie': await clearSession(req, 'emp') });
    if (p === '/api/me' || p === '/api/punch') {
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
        const { lastId } = await db.run('INSERT INTO employees(name, role, pin_hash, color, hourly_rate, active, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)',
          [b.name.trim().slice(0, 40), String(b.role || '').trim().slice(0, 40), await hashSecret(b.pin), EMPLOYEE_COLORS[n % EMPLOYEE_COLORS.length], Number(b.hourly_rate) || 0, Date.now()]);
        return json(201, publicEmployee(await db.get('SELECT * FROM employees WHERE id = ?', [lastId])));
      }
      let mm;
      if ((mm = p.match(/^\/api\/admin\/employees\/(\d+)$/)) && m === 'PATCH') {
        const b = await readBody(req);
        const emp = await db.get('SELECT * FROM employees WHERE id = ?', [Number(mm[1])]);
        if (!emp) throw new HttpError(404, 'Employee not found');
        if (b.pin !== undefined && b.pin !== '' && !validPin(b.pin)) throw new HttpError(400, 'PIN must be 4–6 digits');
        await db.run('UPDATE employees SET name = ?, role = ?, hourly_rate = ?, active = ?, pin_hash = ? WHERE id = ?', [
          b.name?.trim()?.slice(0, 40) || emp.name, b.role !== undefined ? String(b.role).trim().slice(0, 40) : emp.role,
          b.hourly_rate !== undefined ? Number(b.hourly_rate) || 0 : emp.hourly_rate,
          b.active !== undefined ? (b.active ? 1 : 0) : emp.active,
          b.pin ? await hashSecret(b.pin) : emp.pin_hash, emp.id]);
        if (b.active === false) await db.run("DELETE FROM sessions WHERE kind = 'emp' AND employee_id = ?", [emp.id]);
        return json(200, publicEmployee(await db.get('SELECT * FROM employees WHERE id = ?', [emp.id])));
      }

      if (p === '/api/admin/shifts' && m === 'GET') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from/to required');
        const shifts = await shiftsInRange(from, to, Number(url.searchParams.get('employee')) || null);
        return json(200, { now: Date.now(), shifts: shifts.map((s) => ({ ...s, day: dayKey(s.clock_in) })) });
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

      if (p === '/api/admin/export.csv' && m === 'GET') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from/to required');
        const csv = await exportCsv(from, to, Number(url.searchParams.get('employee')) || null);
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
        return json(200, { ok: true });
      }
    }
    throw new HttpError(404, 'Not found');
  }

  return {
    ready: ensureReady,
    time: { dayKey, zonedToMs },
    // Returns a Response for API routes, or null so the host can serve static files.
    async handle(req, { ip = 'unknown' } = {}) {
      const p = new URL(req.url).pathname;
      if (!p.startsWith('/api/') && p !== '/healthz') return null;
      try {
        await ensureReady();
        return await route(req, ip);
      } catch (err) {
        if (!(err instanceof HttpError)) console.error(err);
        return json(err.status || 500, { error: err instanceof HttpError ? err.message : 'Server error' });
      }
    },
  };
}
