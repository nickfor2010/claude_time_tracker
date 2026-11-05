import { test } from 'node:test';
import assert from 'node:assert';
import { annualPeriod, daysForYears, addMonths, leaveBalance, partTimeRatio } from '../src/leave-balance.js';

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
