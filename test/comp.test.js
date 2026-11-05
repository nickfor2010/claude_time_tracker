import { test } from 'node:test';
import assert from 'node:assert';
import { compBalance } from '../src/comp.js';
import { computePay, DEFAULT_PAYROLL } from '../src/payroll.js';
import { makeTime } from '../src/app.js';

const { dayKey, zonedToMs } = makeTime('Asia/Taipei');
const shift = (date, from, to) => ({ clock_in: zonedToMs(date, from), clock_out: zonedToMs(date, to), break_min: 0 });
const tina = { id: 1, name: 'Tina', pay_type: 'hourly', hourly_rate: 200, daily_hours: 8, work_days: '1,2,3,4,5' };

test('overtime on agreed dates is banked, not paid; 補休 taken is paid time', () => {
  const periods = [{ from_date: '2026-11-03', to_date: null }];
  const shifts = [shift('2026-11-02', '08:00', '19:00'), shift('2026-11-03', '08:00', '19:00')]; // 3 h OT each
  const r = computePay({ e: tina, month: '2026-11', shifts, leave: [{ type: 'comp', start_date: '2026-11-20', end_date: '2026-11-20', hours: 2 }],
    adj: null, cfg: DEFAULT_PAYROLL, dayKey, today: '2026-11-30', compPeriods: periods });
  assert.deepEqual([r.hours.ot1, r.hours.ot2, r.hours.comp], [2, 1, 3]);          // only Nov 2 paid as overtime
  assert.equal(r.earnings.overtime, Math.round(2 * 200 * 1.34 + 200 * 1.67));
  assert.equal(r.earnings.leave, 400);                                            // 2 h of 補休 paid at 200
  const vera = { ...tina, pay_type: 'monthly', monthly_salary: 48000 };
  const v = computePay({ e: vera, month: '2026-11', shifts: [], leave: [{ type: 'comp', start_date: '2026-11-20', end_date: '2026-11-20', hours: 8 }],
    adj: null, cfg: DEFAULT_PAYROLL, dayKey, today: '2026-11-30' });
  assert.equal(v.deductions.leave, 0);                                            // monthly: 補休 doesn't cut salary
});

test('balance: earned, used oldest-first, pending, expiry and payout value', () => {
  const periods = [{ from_date: '2026-01-01', to_date: null }];
  const shifts = [
    shift('2026-02-02', '08:00', '20:00'), // 4 h OT: 2 @1.34 + 2 @1.67  (expires 2026-08-02)
    shift('2026-09-01', '08:00', '18:00'), // 2 h OT                      (expires 2027-03-01)
    shift('2026-10-05', '08:00', '17:00'), // 1 h OT                      (expires 2027-04-05)
  ];
  const requests = [{ status: 'approved', hours: 1 }, { status: 'pending', hours: 2 }];
  const b = compBalance({ e: tina, shifts, periods, requests, today: '2026-11-05', dayKey });
  assert.equal(b.earned, 7);
  assert.equal(b.used, 1);
  // Feb entry: 1 h used from its 1.34 hours, so 1 @1.34 + 2 @1.67 expired unused on 2026-08-02
  assert.deepEqual(b.expired_unpaid, { hours: 3, amount: Math.round(200 * (1 * 1.34 + 2 * 1.67)) });
  assert.equal(b.available, 3);           // 7 − 1 used − 3 expired
  assert.equal(b.requestable, 1);         // minus 2 pending
  assert.equal(b.next_expiry, '2027-03-01');
  // after paying the expired hours out, nothing is left to pay
  const after = compBalance({ e: tina, shifts, periods, requests, payouts: [{ hours: 3 }], today: '2026-11-05', dayKey });
  assert.deepEqual([after.expired_unpaid.hours, after.available], [0, 3]);
  // overtime outside the agreed period is not banked
  assert.equal(compBalance({ e: tina, shifts, periods: [{ from_date: '2026-09-15', to_date: null }], today: '2026-11-05', dayKey }).earned, 1);
});
