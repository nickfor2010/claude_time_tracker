import { test } from 'node:test';
import assert from 'node:assert';
import { annualPeriod, daysForYears, addMonths, leaveBalance, partTimeRatio, calendarYearDays, leavePeriod, anniversaryPeriods } from '../src/leave-balance.js';

test('LSA art. 38 table', () => {
  assert.deepEqual([0.5, 1, 2, 3, 4, 5, 9, 10, 11, 24, 40].map(daysForYears), [3, 7, 10, 14, 14, 15, 15, 16, 17, 30, 30]);
});

test('periods by anniversary', () => {
  assert.equal(annualPeriod(null, '2026-11-05').status, 'no_start');
  assert.deepEqual(annualPeriod('2026-08-01', '2026-11-05'), { status: 'waiting', nextGrant: { date: '2027-02-01', days: 3 } });
  const half = annualPeriod('2026-03-10', '2026-11-05');
  assert.deepEqual([half.from, half.to, half.days, half.nextGrant.date, half.nextGrant.days], ['2026-09-10', '2027-03-09', 3, '2027-03-10', 7]);
  const three = annualPeriod('2023-06-01', '2026-11-05');
  assert.deepEqual([three.from, three.to, three.days, three.years, three.nextGrant.days], ['2026-06-01', '2027-05-31', 14, 3, 14]);
  assert.equal(annualPeriod('2016-01-15', '2026-11-05').days, 16); // 10 years
  assert.equal(addMonths('2025-08-31', 6), '2026-02-28');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
});

test('balance: used, pending, part-time share, sick/personal counters', () => {
  const vera = { id: 1, name: 'Vera', start_date: '2023-06-01', daily_hours: 8, work_days: '1,2,3,4,5' };
  const reqs = [
    { type: 'annual', status: 'approved', start_date: '2026-07-06', end_date: '2026-07-10', half_day: 0 }, // Mon–Fri: 5
    { type: 'annual', status: 'approved', start_date: '2026-05-25', end_date: '2026-05-29', half_day: 0 }, // previous period
    { type: 'annual', status: 'pending', start_date: '2026-12-24', end_date: '2026-12-28', half_day: 0 },  // Thu, (Fri 12/25 holiday), Mon -> 2
    { type: 'sick', status: 'approved', start_date: '2026-03-02', end_date: '2026-03-02', half_day: 1 },
    { type: 'personal', status: 'approved', start_date: '2026-04-13', end_date: '2026-04-14', half_day: 0 },
    { type: 'annual', status: 'rejected', start_date: '2026-08-03', end_date: '2026-08-04', half_day: 0 },
  ];
  const b = leaveBalance(vera, reqs, '2026-11-05', new Set(['2026-12-25']));
  assert.equal(b.annual.earned, 14);
  assert.equal(b.annual.used, 5);
  assert.equal(b.annual.pending, 2);
  assert.equal(b.annual.remaining, 9);
  assert.equal(b.annual.to, '2027-05-31');
  assert.deepEqual([b.sick.used, b.personal.used], [0.5, 2]);

  const tina = { id: 2, name: 'Tina', start_date: '2023-06-01', daily_hours: 4, work_days: '1,2,3,4' }; // 16 h/week
  assert.equal(partTimeRatio(tina), 0.4);
  assert.equal(leaveBalance(tina, [], '2026-11-05').annual.earned, 5.6); // 14 x 0.4
});

test('calendar-year system: pro-rated, never less than anniversary', () => {
  // Hired 2024-03-15. 6-month grant 2024-09-15 (3 days over 2024-09-15..2025-03-14: 181 days)
  const d2024 = calendarYearDays('2024-03-15', 2024);
  assert.equal(d2024, Math.round(3 * 108 / 181 * 100) / 100); // 108 of 181 days in 2024
  // 2025: rest of the 3-day period + 7-day period from 2025-03-15
  const d2025 = calendarYearDays('2024-03-15', 2025);
  assert.equal(d2025, Math.round((3 * 73 / 181 + 7 * 292 / 365) * 100) / 100);
  const e = { id: 1, name: 'J', start_date: '2024-03-15', leave_system: 'calendar', daily_hours: 8, work_days: '1,2,3,4,5' };
  const p = leavePeriod(e, '2026-11-05');
  assert.deepEqual([p.from, p.to], ['2026-01-01', '2026-12-31']);
  assert.equal(p.days, Math.round((7 * 73 / 365 + 10 * 292 / 365) * 100) / 100); // 2026: 7-day period to 3/14, then 10-day period
  // over full years both systems give the same total
  let cal = 0, ann = 0;
  for (let y = 2024; y <= 2033; y++) cal += calendarYearDays('2024-03-15', y);
  for (const x of anniversaryPeriods('2024-03-15', '2033-12-31')) if (x.to <= '2033-12-31') ann += x.days;
  assert.ok(cal >= ann - 0.01);
});

test('carry-over, pay-out and manual adjustments', () => {
  const e = { id: 1, name: 'Vera', start_date: '2023-06-01', daily_hours: 8, work_days: '1,2,3,4,5' };
  const reqs = [{ type: 'annual', status: 'approved', start_date: '2026-02-02', end_date: '2026-02-06', half_day: 0 }]; // 5 days in the 2025-06..2026-05 year
  // Previous year (2025-06-01..2026-05-31): 10 days earned, 5 used -> 5 unused, needs a decision
  let b = leaveBalance(e, reqs, '2026-11-05');
  assert.deepEqual([b.previous.from, b.previous.earned, b.previous.used, b.previous.unused, b.previous.needs_decision], ['2025-06-01', 10, 5, 5, true]);
  // Carry 5 days into the current year (2026-06-01..), plus a manual +1 opening adjustment
  b = leaveBalance(e, reqs, '2026-11-05', new Set(),
    [{ id: 9, period_from: '2026-06-01', days: 1, note: 'opening balance' }],
    [{ period_from: '2025-06-01', action: 'carry', days: 5, target_from: '2026-06-01' }]);
  assert.equal(b.previous.needs_decision, false);
  assert.deepEqual([b.annual.earned, b.annual.carried, b.annual.adjusted, b.annual.remaining], [14, 5, 1, 20]);
  // Paying out instead leaves the current year untouched
  b = leaveBalance(e, reqs, '2026-11-05', new Set(), [], [{ period_from: '2025-06-01', action: 'payout', days: 5, payout_month: '2026-06' }]);
  assert.deepEqual([b.annual.carried, b.annual.remaining, b.previous.decision.action], [0, 14, 'payout']);
});
