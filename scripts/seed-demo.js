// Fills an EMPTY database with sample team members and 3 weeks of shifts so you can preview the dashboard.
// Usage: DATA_DIR=./demo-data npm run demo   (then: DATA_DIR=./demo-data npm start)
const { db, zonedToMs, dayKey } = require('../server.js');
const crypto = require('node:crypto');

if (db.prepare('SELECT COUNT(*) n FROM employees').get().n > 0) {
  console.error('Database already has employees — demo data is only added to an empty database.');
  process.exit(1);
}
const hash = (p) => { const s = crypto.randomBytes(16).toString('hex'); return `${s}:${crypto.scryptSync(p, s, 32).toString('hex')}`; };
const colors = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const team = [
  ['Vera', 'Head pastry chef', 230, [8, 30], 10],
  ['Jhoann', 'Pastry cook', 196, [8, 50], 7],
  ['Winnie', 'Packing & shipping', 196, [9, 0], 7],
  ['Tina', 'Shop assistant', 196, [13, 0], 4],
];
const now = Date.now();
const today = dayKey(now);
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const insE = db.prepare('INSERT INTO employees(name, role, pin_hash, color, hourly_rate, active, created_at) VALUES(?,?,?,?,?,1,?)');
const insS = db.prepare('INSERT INTO shifts(employee_id, clock_in, clock_out, break_min) VALUES(?,?,?,?)');
let rnd = 7; const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
team.forEach(([name, role, rate, [h, m], len], i) => {
  const id = insE.run(name, role, hash('1234'), colors[i], rate, now - (10 - i) * 86400e3).lastInsertRowid;
  for (let k = 21; k >= 0; k--) {
    const date = addDays(today, -k);
    const wd = new Date(date + 'T00:00:00Z').getUTCDay();
    if (wd === 0 || (wd === 6 && i !== 3) || rand() < 0.12) continue;
    const start = zonedToMs(date, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`) + Math.round((rand() - 0.5) * 20) * 60e3;
    const end = start + (len + (rand() - 0.4) * 1.4) * 3600e3;
    if (k === 0) { if (start < now && i !== 3) insS.run(id, start, null, 0); continue; }
    insS.run(id, start, Math.round(end), len >= 9 ? 60 : 0);
  }
});
console.log('Demo data added. Every demo PIN is 1234. Admin password: parsley');
