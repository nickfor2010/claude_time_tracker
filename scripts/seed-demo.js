// Fills an EMPTY local database with sample team members and 3 weeks of shifts to preview the dashboard.
// Usage: DATA_DIR=./demo-data npm run demo   (then: DATA_DIR=./demo-data npm start)
import { createApp, hashSecret, addDays } from '../src/app.js';
import { openNodeDb } from '../src/node-db.js';

const db = openNodeDb(process.env.DATA_DIR || './data');
const app = createApp({ db, timezone: process.env.APP_TIMEZONE || 'Asia/Taipei' });
await app.ready();
const { dayKey, zonedToMs } = app.time;
if ((await db.get('SELECT COUNT(*) AS n FROM employees')).n > 0) {
  console.error('Database already has employees — demo data is only added to an empty database.');
  process.exit(1);
}
const colors = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const team = [
  ['Vera', 'Head pastry chef', 230, '08:30', 10],
  ['Jhoann', 'Pastry cook', 196, '08:50', 7],
  ['Winnie', 'Packing & shipping', 196, '09:00', 7],
  ['Tina', 'Shop assistant', 196, '13:00', 4],
];
const now = Date.now(), today = dayKey(now);
let rnd = 7; const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
const pin = await hashSecret('1234');
for (const [i, [name, role, rate, start, len]] of team.entries()) {
  const monthly = i === 0; // Vera is full-time on a monthly salary, the others are hourly
  const { lastId: id } = await db.run('INSERT INTO employees(name, role, pin_hash, color, hourly_rate, pay_type, monthly_salary, insurance, active, created_at) VALUES(?,?,?,?,?,?,?,?,1,?)',
    [name, role, pin, colors[i], monthly ? 0 : rate, monthly ? 'monthly' : 'hourly', monthly ? 46000 : 0, monthly ? 1150 : 0, now - (10 - i) * 86400e3]);
  for (let k = 21; k >= 0; k--) {
    const date = addDays(today, -k);
    const wd = new Date(date + 'T00:00:00Z').getUTCDay();
    if (wd === 0 || (wd === 6 && i !== 3) || rand() < 0.12) continue;
    const cin = zonedToMs(date, start) + Math.round((rand() - 0.5) * 20) * 60e3;
    if (k === 0) { if (cin < now && i !== 3) await db.run('INSERT INTO shifts(employee_id, clock_in) VALUES(?,?)', [id, cin]); continue; }
    await db.run('INSERT INTO shifts(employee_id, clock_in, clock_out, break_min) VALUES(?,?,?,?)', [id, cin, Math.round(cin + (len + (rand() - 0.4) * 1.4) * 3600e3), len >= 9 ? 60 : 0]);
  }
}
// Start dates and some leave history for the balances view
const starts = { Vera: '2021-09-01', Jhoann: '2024-03-15', Winnie: '2026-01-05', Tina: '2025-06-01' };
for (const [name, start] of Object.entries(starts)) await db.run('UPDATE employees SET start_date = ? WHERE name = ?', [start, name]);
await db.run("UPDATE employees SET daily_hours = 4, work_days = '1,2,3,4,5,6' WHERE name = 'Tina'");
const leave = [['Vera', 'annual', '2026-09-28', '2026-10-02', 0, 'approved'], ['Vera', 'sick', '2026-03-10', '2026-03-10', 0, 'approved'],
  ['Jhoann', 'annual', '2026-07-20', '2026-07-24', 0, 'approved'], ['Jhoann', 'annual', '2026-12-21', '2026-12-23', 0, 'pending'],
  ['Jhoann', 'personal', '2026-05-06', '2026-05-06', 1, 'approved'], ['Tina', 'annual', '2026-08-10', '2026-08-11', 0, 'approved']];
for (const [name, type, from, to, half, status] of leave) {
  const { id } = await db.get('SELECT id FROM employees WHERE name = ?', [name]);
  await db.run('INSERT INTO leave_requests(employee_id, type, start_date, end_date, half_day, status, created_at, decided_at, seen) VALUES(?,?,?,?,?,?,?,?,1)', [id, type, from, to, half, status, now, status === 'pending' ? null : now]);
}
console.log('Demo data added. Every demo PIN is 1234. Admin password: parsley');
