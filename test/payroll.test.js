import { test } from 'node:test';
import assert from 'node:assert';
import { computePay, DEFAULT_PAYROLL } from '../src/payroll.js';
import { makeTime } from '../src/app.js';

const { dayKey, zonedToMs } = makeTime('Asia/Taipei');
const shift = (date, from, to, brk = 0) => ({ clock_in: zonedToMs(date, from), clock_out: zonedToMs(date, to), break_min: brk });
const base = { dayKey, today: '2026-11-30', month: '2026-11', leave: [], adj: null, cfg: DEFAULT_PAYROLL };

test('hourly: overtime after daily hours at 1.34 then 1.67', () => {
  const e = { id: 1, name: 'Tina', pay_type: 'hourly', hourly_rate: 200, daily_hours: 8 };
  // Mon 2 Nov: 11h worked -> 8 regular, 2 at 1.34, 1 at 1.67
  const r = computePay({ ...base, e, shifts: [shift('2026-11-02', '08:00', '19:00')] });
  assert.deepEqual(r.hours, { worked: 11, regular: 8, ot1: 2, ot2: 1 });
  assert.equal(r.earnings.base, 1600);
  assert.equal(r.earnings.overtime, Math.round(2 * 200 * 1.34 + 200 * 1.67)); // 536 + 334 = 870
  assert.equal(r.gross, 2470);
});

test('monthly: salary, overtime at salary/240, unpaid leave deducted, sick 50%', () => {
  const e = { id: 2, name: 'Vera', pay_type: 'monthly', monthly_salary: 48000, daily_hours: 8, work_days: '1,2,3,4,5', insurance: 1500 };
  const shifts = [
    shift('2026-11-02', '08:00', '18:00'),       // Mon: 10h -> 2h OT
    shift('2026-11-07', '09:00', '13:00'),       // Sat (not a workday): 4h, all overtime
  ];
  const leave = [
    { type: 'personal', start_date: '2026-11-05', end_date: '2026-11-06', half_day: 0 }, // Thu+Fri unpaid
    { type: 'sick', start_date: '2026-11-08', end_date: '2026-11-09', half_day: 0 },     // Sun (skipped) + Mon at 50%
  ];
  const r = computePay({ ...base, e, shifts, leave });
  assert.equal(r.rate, 200); // 48000 / 240
  assert.deepEqual(r.hours, { worked: 14, regular: 8, ot1: 4, ot2: 2 });
  assert.equal(r.earnings.base, 48000);
  assert.equal(r.earnings.overtime, Math.round(4 * 200 * 1.34 + 2 * 200 * 1.67)); // 1072 + 668
  assert.equal(r.deductions.leave, 2 * 8 * 200 + 8 * 200 * 0.5); // 3200 + 800
  assert.equal(r.deductions.insurance, 1500);
  assert.equal(r.net, 48000 + 1740 - 4000 - 1500);
  assert.deepEqual(r.leave.map((l) => [l.type, l.days]), [['personal', 2], ['sick', 1]]);
  // scheduled weekdays with no punches and no leave are listed (not deducted)
  assert.ok(r.missing_days.includes('2026-11-03'));
  assert.ok(!r.missing_days.includes('2026-11-05'));
});

test('adjustments: bonus, other deduction and insurance override', () => {
  const e = { id: 3, name: 'Jo', pay_type: 'hourly', hourly_rate: 196, insurance: 700 };
  const r = computePay({ ...base, e, shifts: [shift('2026-11-02', '09:00', '13:00')], adj: { bonus: 1000, deduction: 200, deduction_note: 'uniform', insurance: 0 } });
  assert.equal(r.earnings.base, 784);
  assert.equal(r.gross, 1784);
  assert.equal(r.total_deductions, 200);
  assert.equal(r.net, 1584);
});

test('overtime can be switched off', () => {
  const e = { id: 4, name: 'X', pay_type: 'hourly', hourly_rate: 100 };
  const r = computePay({ ...base, e, shifts: [shift('2026-11-02', '08:00', '20:00')], cfg: { ...DEFAULT_PAYROLL, ot_auto: false } });
  assert.deepEqual(r.hours, { worked: 12, regular: 12, ot1: 0, ot2: 0 });
  assert.equal(r.gross, 1200);
});
