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
