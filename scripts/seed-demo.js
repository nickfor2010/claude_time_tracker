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
console.log('Demo data added. Every demo PIN is 1234. Admin password: parsley');
