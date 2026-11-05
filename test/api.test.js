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
  // Paid leave (Mon–Fri schedule): Dec 10–12 is Thu–Sat -> 2 annual days x 8h x NT$200 = 3200; half sick day 4h x 200 x 50% = 400
  const sick = (await phone('/api/leave', { method: 'POST', body: { type: 'sick', start: '2026-12-15', end: '2026-12-15', half: true } })).data;
  await admin(`/api/admin/leave/${sick.id}`, { method: 'POST', body: { status: 'approved' } });
  let dec = (await admin('/api/admin/shifts?from=2026-12-01&to=2026-12-31')).data.leave;
  assert.equal(dec.length, 3);
  assert.equal(dec.filter((l) => l.type === 'annual').reduce((a, l) => a + l.pay, 0), 3200);
  assert.equal(dec.find((l) => l.type === 'sick').pay, 400);
  // a range that cuts a request in half only counts the days inside it
  assert.equal((await admin('/api/admin/shifts?from=2026-12-11&to=2026-12-31')).data.leave.filter((l) => l.type === 'annual').length, 1);
  // per-employee leave hours and pay rates are adjustable
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { leave_hours: 4 } });
  assert.equal((await admin('/api/admin/settings', { method: 'POST', body: { leave_pay: { annual: 150, sick: 50, personal: 0, other: 0 } } })).status, 400);
  assert.equal((await admin('/api/admin/settings', { method: 'POST', body: { leave_pay: { annual: 100, sick: 60, personal: 0, other: 0 } } })).status, 200);
  dec = (await admin('/api/admin/shifts?from=2026-12-01&to=2026-12-31')).data.leave;
  assert.equal(dec.filter((l) => l.type === 'annual').reduce((a, l) => a + l.pay, 0), 1600);
  assert.equal(dec.find((l) => l.type === 'sick').pay, 2 * 200 * 0.6);
  const decCsv = (await admin('/api/admin/export.csv?from=2026-12-01&to=2026-12-31')).data;
  assert.match(decCsv, /Vera,2026-12-10,Annual leave,,,4\.00,4h 00m,200,800,Paid leave 100%/);
  assert.match(decCsv, /GROSS PAY Vera,,,,,,,,1840/);
  assert.match((await admin('/api/admin/export.csv?from=2026-12-01&to=2026-12-31&lang=zh')).data, /帶薪假 100%/);

  // Payroll: switch Vera to a monthly salary and check December
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { pay_type: 'monthly', monthly_salary: 48000, daily_hours: 8, work_days: '1,2,3,4,5', insurance: 1200 } });
  let pr = (await admin('/api/admin/payroll?month=2026-12')).data;
  let row = pr.rows.find((r) => r.employee_id === emp.id);
  assert.equal(row.pay_type, 'monthly');
  assert.equal(row.earnings.base, 48000);
  // sick half day at 60%: 4h x (48000/240) x 40% unpaid = 320
  assert.equal(row.deductions.leave, 320);
  assert.equal(row.net, 48000 - 320 - 1200);
  assert.equal((await admin(`/api/admin/payroll/2026-12/${emp.id}`, { method: 'POST', body: { bonus: 2000, deduction: 100, deduction_note: 'uniform' } })).status, 200);
  row = (await admin(`/api/admin/payroll/2026-12/${emp.id}`)).data.row;
  assert.equal(row.net, 48000 + 2000 - 320 - 1200 - 100);
  assert.equal((await admin(`/api/admin/payroll/2026-12/${emp.id}/paid`, { method: 'POST' })).status, 200);
  // paid payslips are frozen and visible to the employee
  assert.equal((await admin(`/api/admin/payroll/2026-12/${emp.id}`, { method: 'POST', body: { bonus: 0 } })).status, 400);
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { monthly_salary: 50000 } });
  row = (await admin(`/api/admin/payroll/2026-12/${emp.id}`)).data.row;
  assert.equal(row.status, 'paid');
  assert.equal(row.net, 48380);
  assert.equal(row.changed_since_paid, true);
  assert.deepEqual((await phone('/api/payslips')).data.payslips.map((x) => [x.month, x.net]), [['2026-12', 48380]]);
  assert.equal((await phone('/api/payslips/2026-12')).data.row.earnings.bonus, 2000);
  assert.equal((await phone('/api/payslips/2026-11')).status, 404);
  assert.equal((await admin(`/api/admin/payroll/2026-12/${emp.id}/reopen`, { method: 'POST' })).status, 200);
  assert.equal((await phone('/api/payslips')).data.payslips.length, 0);
  assert.match((await admin('/api/admin/payroll.csv?month=2026-12&lang=zh')).data, /員工,計薪方式,工時/);
  assert.equal((await admin('/api/admin/settings', { method: 'POST', body: { payroll: { ot_auto: true, ot_rate1: 5, ot_tier: 2, ot_rate2: 1.67, divisor: 240 } } })).status, 400);
  assert.equal((await admin('/api/admin/settings', { method: 'POST', body: { payroll: { ot_auto: true, ot_rate1: 1.34, ot_tier: 2, ot_rate2: 1.67, divisor: 240 } } })).status, 200);
  assert.equal((await client()('/api/admin/payroll?month=2026-12')).status, 401);
  assert.equal((await client()('/api/payslips')).status, 401);

  // Holidays: official list is pre-loaded; custom days can be added/removed and change payroll
  const hol = (await admin('/api/admin/holidays?year=2026')).data.holidays;
  assert.ok(hol.some((h) => h.date === '2026-09-25' && h.name_zh === '中秋節'));
  assert.equal(hol.length, 16);
  assert.equal((await admin('/api/admin/holidays', { method: 'POST', body: { date: '2026-12-31', name_zh: '公司年終', name_en: 'Company year-end' } })).status, 200);
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { pay_type: 'hourly', hourly_rate: 200, daily_hours: 8, work_days: '1,2,3,4,5' } });
  pr = (await admin('/api/admin/payroll?month=2026-12')).data;
  row = pr.rows.find((r) => r.employee_id === emp.id);
  // Dec 25 (Constitution Day) and Dec 31 (custom) are paid days off for an hourly Mon–Fri worker: 2 x 8 h x 200
  assert.equal(row.earnings.holiday, 3200);
  assert.deepEqual(row.holidays.map((h) => h.date), ['2026-12-25', '2026-12-31']);
  assert.equal((await admin('/api/admin/holidays/2026-12-31', { method: 'DELETE' })).status, 200);
  assert.equal((await admin('/api/admin/holidays?year=2026')).data.holidays.length, 16);
  await admin('/api/admin/holidays/2026-09-25', { method: 'DELETE' });
  await admin('/api/admin/holidays/restore', { method: 'POST', body: { year: 2026 } });
  assert.equal((await admin('/api/admin/holidays?year=2026')).data.holidays.length, 16);
  assert.match((await admin('/api/admin/payroll.csv?month=2026-12')).data, /Holiday pay,Holiday work pay/);

  // Leave balances: start date gives 特休 by seniority; approved annual days are used
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { start_date: '2023-06-01', work_days: '1,2,3,4,5', daily_hours: 8 } });
  const vb = (await admin('/api/admin/balances')).data.balances.find((b) => b.employee_id === emp.id);
  assert.equal(vb.start_date, '2023-06-01');
  assert.equal(vb.annual.earned, 14);           // 3 years -> 14 days
  assert.equal(vb.annual.used, 2);              // Dec 10–11 approved (Thu, Fri)
  assert.equal(vb.annual.remaining, 12);
  assert.equal(vb.sick.used, 0.5);
  assert.equal((await phone('/api/me')).data.balance.annual.remaining, 12);
  assert.equal((await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { start_date: 'nope' } })).data.start_date, null);
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { start_date: '2023-06-01' } });

  // Carry-over / pay-out / adjustments. Vera (start 2023-06-01): previous year 2025-06-01..2026-05-31, 10 days, none used.
  let vb2 = (await admin('/api/admin/balances')).data.balances.find((b) => b.employee_id === emp.id);
  assert.deepEqual([vb2.previous.from, vb2.previous.unused, vb2.previous.needs_decision], ['2025-06-01', 10, true]);
  assert.equal((await admin(`/api/admin/balances/${emp.id}/settle`, { method: 'POST', body: { action: 'carry', days: 11 } })).status, 400);
  assert.equal((await admin(`/api/admin/balances/${emp.id}/settle`, { method: 'POST', body: { action: 'carry', days: 4 } })).status, 200);
  assert.equal((await admin(`/api/admin/balances/${emp.id}/adjust`, { method: 'POST', body: { days: 1.5, note: 'opening balance' } })).status, 200);
  vb2 = (await admin('/api/admin/balances')).data.balances.find((b) => b.employee_id === emp.id);
  assert.deepEqual([vb2.annual.carried, vb2.annual.adjusted, vb2.annual.remaining], [4, 1.5, 12 + 4 + 1.5]);
  assert.equal((await admin(`/api/admin/balances/${emp.id}/settle`, { method: 'POST', body: { action: 'none' } })).status, 400); // already settled
  assert.equal((await admin(`/api/admin/balances/${emp.id}/settle/2025-06-01`, { method: 'DELETE' })).status, 200);
  await admin(`/api/admin/balances/${emp.id}/adjust/${vb2.annual.adjustments[0].id}`, { method: 'DELETE' });
  // Pay out 10 days in 2027-01: hourly NT$200 x 8 h = 1600/day -> 16000 on that payslip
  assert.equal((await admin(`/api/admin/balances/${emp.id}/settle`, { method: 'POST', body: { action: 'payout', days: 10, month: '2027-01' } })).status, 200);
  const jan = (await admin('/api/admin/payroll?month=2027-01')).data.rows.find((r) => r.employee_id === emp.id);
  assert.equal(jan.earnings.leave_payout, 16000);
  // Switching Vera to the calendar-year system
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { leave_system: 'calendar' } });
  vb2 = (await admin('/api/admin/balances')).data.balances.find((b) => b.employee_id === emp.id);
  assert.deepEqual([vb2.leave_system, vb2.annual.from, vb2.annual.to], ['calendar', '2026-01-01', '2026-12-31']);
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { leave_system: 'anniversary' } });

  // History: manager-entered leave, standard schedule fill, CSV import
  const hist = (await admin('/api/admin/employees', { method: 'POST', body: { name: 'Mei', pin: '1111', pay_type: 'monthly', monthly_salary: 40000, start_date: '2020-03-02', work_days: '1,2,3,4,5' } })).data;
  assert.equal((await admin('/api/admin/leave', { method: 'POST', body: { employee_id: hist.id, type: 'annual', start: '2025-08-04', end: '2025-08-08' } })).status, 201);
  // Aug 2025: 21 weekdays (no holidays), 5 on leave -> 16 shifts; preview first
  let bf = (await admin('/api/admin/backfill', { method: 'POST', body: { employee_id: hist.id, from: '2025-08-01', to: '2025-08-31', in: '09:00', out: '18:00', break_min: 60, dry_run: true } })).data;
  assert.deepEqual([bf.days, bf.created, bf.skipped.leave, bf.skipped.off], [16, 0, 5, 10]);
  assert.deepEqual(bf.years_without_holidays, []); // 2020–2025 holidays are built in now
  bf = (await admin('/api/admin/backfill', { method: 'POST', body: { employee_id: hist.id, from: '2025-08-01', to: '2025-08-31', in: '09:00', out: '18:00', break_min: 60 } })).data;
  assert.equal(bf.created, 16);
  // running it again creates nothing (days already have shifts)
  assert.equal((await admin('/api/admin/backfill', { method: 'POST', body: { employee_id: hist.id, from: '2025-08-01', to: '2025-08-31', in: '09:00', out: '18:00' } })).data.created, 0);
  // 2026-12-25 is a holiday and is skipped; future dates are refused
  assert.equal((await admin('/api/admin/backfill', { method: 'POST', body: { employee_id: hist.id, from: '2025-08-01', to: '2099-01-01', in: '09:00', out: '18:00' } })).status, 400);
  const augHours = (await admin('/api/admin/payroll?month=2025-08')).data.rows.find((r) => r.employee_id === hist.id).hours.worked;
  assert.equal(augHours, 16 * 8);
  // CSV import rows (already parsed by the browser): ok, duplicate, unknown employee, overnight, bad time
  const imp = { rows: [
    { employee_id: hist.id, date: '2025-09-01', in: '09:00', out: '17:30', break_min: 30, note: 'old system' },
    { employee_id: hist.id, date: '2025-09-01', in: '09:00', out: '17:30' },
    { employee_id: 999999, date: '2025-09-02', in: '09:00', out: '17:00' },
    { employee_id: hist.id, date: '2025-09-03', in: '22:00', out: '06:00' },
    { employee_id: hist.id, date: '2025-09-04', in: '9am', out: '17:00' },
  ] };
  let ir = (await admin('/api/admin/import/shifts', { method: 'POST', body: { ...imp, dry_run: true } })).data;
  assert.deepEqual(ir.results.map((x) => x.status), ['ok', 'duplicate', 'error', 'ok', 'error']);
  assert.equal(ir.imported, 0);
  ir = (await admin('/api/admin/import/shifts', { method: 'POST', body: imp })).data;
  assert.equal(ir.imported, 2);
  ir = (await admin('/api/admin/import/shifts', { method: 'POST', body: imp })).data;
  assert.equal(ir.imported, 0); // second import: everything is a duplicate
  const sep = (await admin(`/api/admin/shifts?from=2025-09-01&to=2025-09-30&employee=${hist.id}`)).data.shifts;
  assert.equal(sep.length, 2);
  assert.equal(sep.find((x) => x.day === '2025-09-03').clock_out - sep.find((x) => x.day === '2025-09-03').clock_in, 8 * 3600e3);

  // Past holidays are loaded: 2024 Children's Day moved to Fri 4/5; 2021-12-31 substitute for New Year 2022
  const h24 = (await admin('/api/admin/holidays?year=2024')).data.holidays.map((h) => h.date);
  assert.ok(h24.includes('2024-04-05') && h24.includes('2024-02-14'));
  assert.ok((await admin('/api/admin/holidays?year=2021')).data.holidays.some((h) => h.date === '2021-12-31'));

  // 補休: manager proposes -> nothing changes until the employee agrees -> overtime banked -> request by the hour
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { pay_type: 'hourly', hourly_rate: 200, daily_hours: 8, work_days: '0,1,2,3,4,5,6' } });
  assert.equal((await phone('/api/comp/withdraw', { method: 'POST' })).status, 400);
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { comp_time: true } });
  let me3 = (await phone('/api/me')).data;
  assert.equal(me3.comp.status, 'proposed');
  assert.equal(me3.comp.balance, null);
  assert.equal((await phone('/api/leave', { method: 'POST', body: { type: 'comp', start: today, end: today, hours: 1 } })).status, 400); // nothing banked
  assert.equal((await phone('/api/comp/consent', { method: 'POST', body: { agree: true } })).status, 200);
  assert.equal((await phone('/api/comp/consent', { method: 'POST', body: { agree: true } })).status, 400); // already answered
  // today: 11 h + the 4 h shift from earlier = 15 h -> 7 h overtime, banked, not paid
  await admin('/api/admin/shifts', { method: 'POST', body: { employee_id: emp.id, date: today, in: '07:00', out: '18:00' } });
  me3 = (await phone('/api/me')).data;
  assert.equal(me3.comp.status, 'active');
  assert.equal(me3.comp.balance.earned, 7);
  const prNow = (await admin(`/api/admin/payroll?month=${today.slice(0, 7)}`)).data.rows.find((r) => r.employee_id === emp.id);
  assert.equal(prNow.hours.comp, 7);
  assert.equal(prNow.hours.ot1 + prNow.hours.ot2, 0);
  // ask for 2 h, then more than is left (Vera works every day in this test, so today is a work day)
  assert.equal((await phone('/api/leave', { method: 'POST', body: { type: 'comp', start: today, end: today, hours: 2 } })).status, 201);
  assert.equal((await phone('/api/leave', { method: 'POST', body: { type: 'comp', start: today, end: today, hours: 6 } })).status, 400);
  assert.equal((await admin('/api/admin/balances')).data.balances.find((b) => b.employee_id === emp.id).comp.balance.requestable, 5);
  // the employee can stop it; banked hours stay
  assert.equal((await phone('/api/comp/withdraw', { method: 'POST' })).status, 200);
  me3 = (await phone('/api/me')).data;
  assert.deepEqual([me3.comp.status, me3.comp.balance.earned], ['off', 7]);
  // nothing expired yet -> nothing to pay out
  assert.equal((await admin(`/api/admin/comp/${emp.id}/payout`, { method: 'POST', body: {} })).status, 400);

  // Personal details: admin sets them, the employee can update their own; bad values are refused
  assert.equal((await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { email: 'not-an-email' } })).status, 400);
  await admin(`/api/admin/employees/${emp.id}`, { method: 'PATCH', body: { birthday: '1990-11-12', email: 'vera@example.com', phone: '0912 345 678', emergency_name: 'Mom', emergency_relation: '母親', emergency_phone: '+886 2 1234 5678' } });
  let mine = (await phone('/api/me')).data.employee;
  assert.deepEqual([mine.birthday, mine.phone, mine.emergency_relation], ['1990-11-12', '0912 345 678', '母親']);
  assert.equal((await phone('/api/me/profile', { method: 'PATCH', body: { phone: 'call me' } })).status, 400);
  assert.equal((await phone('/api/me/profile', { method: 'PATCH', body: { phone: '0987-654-321' } })).status, 200);
  mine = (await phone('/api/me')).data.employee;
  assert.deepEqual([mine.phone, mine.email], ['0987-654-321', 'vera@example.com']); // other fields untouched
  assert.equal((await client()('/api/me/profile', { method: 'PATCH', body: { phone: '0900000000' } })).status, 401);
  // Change PIN: needs the current PIN, refuses easy PINs, signs out the person's other phones
  const phone2 = client();
  await phone2('/api/login', { method: 'POST', body: { employeeId: emp.id, pin: '4321' } });
  assert.equal((await phone('/api/me/pin', { method: 'POST', body: { current: '0000', pin: '5826' } })).status, 400);
  assert.equal((await phone('/api/me/pin', { method: 'POST', body: { current: '4321', pin: '1111' } })).status, 400);
  assert.equal((await phone('/api/me/pin', { method: 'POST', body: { current: '4321', pin: '1234' } })).status, 400);
  assert.equal((await phone('/api/me/pin', { method: 'POST', body: { current: '4321', pin: '5826' } })).status, 200);
  assert.equal((await phone('/api/me')).status, 200);   // this phone stays signed in
  assert.equal((await phone2('/api/me')).status, 401);  // the other phone is signed out
  assert.equal((await phone2('/api/login', { method: 'POST', body: { employeeId: emp.id, pin: '4321' } })).status, 401);
  assert.equal((await phone2('/api/login', { method: 'POST', body: { employeeId: emp.id, pin: '5826' } })).status, 200);

  // Revoking approved leave: employee asks, manager revokes or keeps; balances follow; paid months are protected
  const far = (n) => { const d = new Date(Date.parse(today + 'T00:00:00Z') + n * 86400e3); return d.toISOString().slice(0, 10); };
  const lv = (await phone('/api/leave', { method: 'POST', body: { type: 'annual', start: far(40), end: far(41) } })).data;
  await admin(`/api/admin/leave/${lv.id}`, { method: 'POST', body: { status: 'approved' } });
  const usedBefore = (await admin('/api/admin/balances')).data.balances.find((b) => b.employee_id === emp.id).annual;
  assert.equal((await phone(`/api/leave/${lv.id}/cancel`, { method: 'POST', body: { reason: 'Plans changed' } })).data.requested, true);
  assert.equal((await phone(`/api/leave/${lv.id}/cancel`, { method: 'POST', body: {} })).status, 400); // asked already
  let ovr = (await admin('/api/admin/overview')).data;
  assert.ok(ovr.pendingLeave >= 1);
  let lr = (await admin('/api/admin/leave')).data.requests.find((r) => r.id === lv.id);
  assert.deepEqual([lr.status, lr.cancel_requested, lr.cancel_reason], ['approved', 1, 'Plans changed']);
  // keep it
  assert.equal((await admin(`/api/admin/leave/${lv.id}/keep`, { method: 'POST', body: { manager_note: 'We need you that week' } })).status, 200);
  lr = (await admin('/api/admin/leave')).data.requests.find((r) => r.id === lv.id);
  assert.deepEqual([lr.status, lr.cancel_requested], ['approved', 0]);
  // revoke it (manager can revoke directly too)
  assert.equal((await admin(`/api/admin/leave/${lv.id}/revoke`, { method: 'POST', body: { manager_note: 'Cancelled as asked' } })).status, 200);
  assert.equal((await admin(`/api/admin/leave/${lv.id}/revoke`, { method: 'POST', body: {} })).status, 400); // already cancelled
  const after = (await admin('/api/admin/balances')).data.balances.find((b) => b.employee_id === emp.id).annual;
  assert.ok(after.used <= usedBefore.used && after.remaining >= usedBefore.remaining);
  const notice = (await phone('/api/me')).data.leaveNotices.find((n) => n.id === lv.id);
  assert.deepEqual([notice.status, notice.revoked], ['cancelled', 1]);
  // a leave in a paid month can't be revoked until the payslip is reopened
  const paidLv = (await admin('/api/admin/leave', { method: 'POST', body: { employee_id: emp.id, type: 'sick', start: '2027-01-06', end: '2027-01-06' } }));
  const paidId = (await admin('/api/admin/leave')).data.requests.find((r) => r.start_date === '2027-01-06' && r.employee_id === emp.id).id;
  await admin(`/api/admin/payroll/2027-01/${emp.id}/paid`, { method: 'POST' });
  assert.equal((await admin(`/api/admin/leave/${paidId}/revoke`, { method: 'POST', body: {} })).status, 400);
  await admin(`/api/admin/payroll/2027-01/${emp.id}/reopen`, { method: 'POST' });
  assert.equal((await admin(`/api/admin/leave/${paidId}/revoke`, { method: 'POST', body: {} })).status, 200);

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
