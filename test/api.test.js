// End-to-end API tests against a throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';

// Set BASE_URL to run the same tests against a running instance (e.g. `wrangler dev`).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parsley-test-'));
let base = process.env.BASE_URL, server;
before(async () => {
  if (base) return;
  ({ server } = createServer({ dataDir, adminPassword: 'secret-admin' }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

test('full punch flow', async () => {
  const admin = client(), phone = client();
  assert.equal((await admin('/api/admin/overview')).status, 401);
  assert.equal((await admin('/api/admin/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  assert.equal((await admin('/api/admin/login', { method: 'POST', body: { password: 'secret-admin' } })).status, 200);
  assert.equal((await admin('/api/admin/employees', { method: 'POST', body: { name: 'Vera', pin: '12' } })).status, 400);
  const emp = (await admin('/api/admin/employees', { method: 'POST', body: { name: 'Vera', role: 'Chef', pin: '4321', hourly_rate: 200 } })).data;
  assert.equal(emp.name, 'Vera');
  assert.ok(!('pin_hash' in emp));

  const team = (await phone('/api/team')).data;
  assert.equal(team.employees.length, 1);
  assert.ok(!('pin_hash' in team.employees[0]));
  assert.equal((await phone('/api/me')).status, 401);
  assert.equal((await phone('/api/login', { method: 'POST', body: { employeeId: emp.id, pin: '0000' } })).status, 401);
  assert.equal((await phone('/api/login', { method: 'POST', body: { employeeId: emp.id, pin: '4321' } })).status, 200);

  const inR = (await phone('/api/punch', { method: 'POST', body: {} })).data;
  assert.equal(inR.action, 'in');
  assert.ok(inR.open);
  let ov = (await admin('/api/admin/overview')).data;
  assert.equal(ov.onShift.length, 1);
  const outR = (await phone('/api/punch', { method: 'POST', body: {} })).data;
  assert.equal(outR.action, 'out');
  assert.equal(outR.open, null);
  assert.equal(outR.todayShifts.length, 1);

  // Manual shift: 09:00-17:30 with 30 min break = 8h -> NT$1600
  const today = ov.today;
  assert.equal((await admin('/api/admin/shifts', { method: 'POST', body: { employee_id: emp.id, date: today, in: '09:00', out: '17:30', break_min: 30 } })).status, 201);
  const list = (await admin(`/api/admin/shifts?from=${today}&to=${today}`)).data.shifts;
  assert.equal(list.length, 2);
  const manual = list.find((s) => s.edited);
  assert.equal(manual.clock_out - manual.clock_in, 8.5 * 3600e3);
  assert.equal(manual.day, today);

  // Overnight shift rolls to next day
  assert.equal((await admin(`/api/admin/shifts/${manual.id}`, { method: 'PATCH', body: { date: today, in: '22:00', out: '02:00' } })).status, 200);
  const edited = (await admin(`/api/admin/shifts?from=${today}&to=${today}`)).data.shifts.find((s) => s.id === manual.id);
  assert.equal(edited.clock_out - edited.clock_in, 4 * 3600e3);

  const csv = (await admin(`/api/admin/export.csv?from=${today}&to=${today}`)).data;
  assert.match(csv, /Employee,Date,Clock in,Clock out/);
  assert.match(csv, /TOTAL Vera/);
  const csvZh = (await admin(`/api/admin/export.csv?from=${today}&to=${today}&lang=zh`)).data;
  assert.match(csvZh, /員工,日期,上班打卡,下班打卡/);
  assert.match(csvZh, /合計 Vera/);

  // Forgotten clock-out warning threshold
  assert.equal((await admin('/api/admin/overview')).data.alertHours, 12);
  assert.equal((await admin('/api/admin/settings', { method: 'POST', body: { alert_hours: 30 } })).status, 400);
  assert.equal((await admin('/api/admin/settings', { method: 'POST', body: { alert_hours: 10 } })).status, 200);
  assert.equal((await admin('/api/admin/overview')).data.alertHours, 10);

  // Time off: request -> pending count -> approve -> employee notice -> seen
  assert.equal((await phone('/api/leave', { method: 'POST', body: { type: 'annual', start: '2026-12-10', end: '2026-12-08' } })).status, 400);
  assert.equal((await phone('/api/leave', { method: 'POST', body: { type: 'party', start: '2026-12-10', end: '2026-12-10' } })).status, 400);
  const req1 = (await phone('/api/leave', { method: 'POST', body: { type: 'annual', start: '2026-12-10', end: '2026-12-12', note: 'Family trip' } })).data;
  assert.equal(req1.status, 'pending');
  assert.equal(req1.days, 3);
  const req2 = (await phone('/api/leave', { method: 'POST', body: { type: 'personal', start: '2026-12-20', end: '2026-12-20', half: true } })).data;
  assert.equal(req2.days, 0.5);
  assert.equal((await admin('/api/admin/overview')).data.pendingLeave, 2);
  assert.equal((await phone(`/api/leave/${req2.id}/cancel`, { method: 'POST' })).status, 200);
  assert.equal((await admin('/api/admin/overview')).data.pendingLeave, 1);
  assert.equal((await admin(`/api/admin/leave/${req2.id}`, { method: 'POST', body: { status: 'approved' } })).status, 400);
  assert.equal((await admin(`/api/admin/leave/${req1.id}`, { method: 'POST', body: { status: 'approved', manager_note: 'Enjoy!' } })).status, 200);
  const me2 = (await phone('/api/me')).data;
  assert.equal(me2.leaveNotices.length, 1);
  assert.equal(me2.leaveNotices[0].manager_note, 'Enjoy!');
  await phone('/api/leave/seen', { method: 'POST' });
  assert.equal((await phone('/api/me')).data.leaveNotices.length, 0);
  const all = (await admin('/api/admin/leave')).data.requests;
  assert.equal(all.find((r) => r.id === req1.id).status, 'approved');
  assert.equal(all.find((r) => r.id === req1.id).name, 'Vera');
  // Paid leave: 3 approved annual days x 8h x NT$200 x 100% = 4800; half sick day 4h x 200 x 50% = 400
  const sick = (await phone('/api/leave', { method: 'POST', body: { type: 'sick', start: '2026-12-15', end: '2026-12-15', half: true } })).data;
  await admin(`/api/admin/leave/${sick.id}`, { method: 'POST', body: { status: 'approved' } });
  let dec = (await admin('/api/admin/shifts?from=2026-12-01&to=2026-12-31')).data.leave;
  assert.equal(dec.length, 4);
  assert.equal(dec.filter((l) => l.type === 'annual').reduce((a, l) => a + l.pay, 0), 4800);
  assert.equal(dec.find((l) => l.type === 'sick').pay, 400);
  // a range that cuts a request in half only counts the days inside it
  assert.equal((await admin('/api/admin/shifts?from=2026-12-11&to=2026-12-31')).data.leave.filter((l) => l.type === 'annual').length, 2);
  // per-employee leave hours and pay rates are adjustable
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { leave_hours: 4 } });
  assert.equal((await admin('/api/admin/settings', { method: 'POST', body: { leave_pay: { annual: 150, sick: 50, personal: 0, other: 0 } } })).status, 400);
  assert.equal((await admin('/api/admin/settings', { method: 'POST', body: { leave_pay: { annual: 100, sick: 60, personal: 0, other: 0 } } })).status, 200);
  dec = (await admin('/api/admin/shifts?from=2026-12-01&to=2026-12-31')).data.leave;
  assert.equal(dec.filter((l) => l.type === 'annual').reduce((a, l) => a + l.pay, 0), 2400);
  assert.equal(dec.find((l) => l.type === 'sick').pay, 2 * 200 * 0.6);
  const decCsv = (await admin('/api/admin/export.csv?from=2026-12-01&to=2026-12-31')).data;
  assert.match(decCsv, /Vera,2026-12-10,Annual leave,,,4\.00,4h 00m,200,800,Paid leave 100%/);
  assert.match(decCsv, /GROSS PAY Vera,,,,,,,,2640/);
  assert.match((await admin('/api/admin/export.csv?from=2026-12-01&to=2026-12-31&lang=zh')).data, /帶薪假 100%/);

  // other employees / logged-out users cannot touch requests
  assert.equal((await client()('/api/leave')).status, 401);
  assert.equal((await client()('/api/admin/leave')).status, 401);
  // push key + subscription storage
  const key = (await phone('/api/push/key')).data.publicKey;
  assert.equal(key.length, 87);
  assert.equal((await phone('/api/push/subscribe', { method: 'POST', body: { subscription: { endpoint: 'http://bad' } } })).status, 400);
  assert.equal((await phone('/api/push/subscribe', { method: 'POST', body: { subscription: { endpoint: 'https://push.example/1', keys: { p256dh: 'x', auth: 'y' } }, lang: 'zh' } })).status, 200);
  assert.equal((await client()('/api/push/subscribe?role=admin', { method: 'POST', body: { subscription: { endpoint: 'https://push.example/2', keys: { p256dh: 'x', auth: 'y' } } } })).status, 401);
  assert.equal((await admin('/api/push/subscribe?role=admin', { method: 'POST', body: { subscription: { endpoint: 'https://push.example/2', keys: { p256dh: 'x', auth: 'y' } } } })).status, 200);

  // Deactivating signs the phone out
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { active: false } });
  assert.equal((await phone('/api/me')).status, 401);
  assert.equal((await admin(`/api/admin/shifts/${manual.id}`, { method: 'DELETE' })).status, 200);
});

test('static files and path traversal', async () => {
  const c = client();
  assert.equal((await c('/')).status, 200);
  assert.equal((await c('/admin')).status, 200);
  assert.equal((await c('/manifest.webmanifest')).status, 200);
  assert.notEqual((await c('/..%2fserver.js')).status, 200);
});
