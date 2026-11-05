// Annual leave (特休) by seniority, Taiwan Labor Standards Act art. 38 (2017):
//   6 months – 1 year: 3 days · 1–2 years: 7 · 2–3 years: 10 · 3–5 years: 14 · 5–10 years: 15
//   from 10 years: +1 day per extra year, up to 30 days.
// Anniversary-based periods (週年制). Part-time staff get a share in proportion to their weekly hours
// compared with a 40-hour week. Pure functions: no database.
import { workDaySet, weekday } from './payroll.js';

const pad = (n) => String(n).padStart(2, '0');
// Adds months to a 'YYYY-MM-DD' date, clamping to the end of the month (e.g. Aug 31 + 6 months = Feb 28/29).
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
}
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };

export function daysForYears(years) {
  if (years < 1) return 3;
  if (years < 2) return 7;
  if (years < 3) return 10;
  if (years < 5) return 14;
  if (years < 10) return 15;
  return Math.min(30, 15 + (years - 9));
}

// The annual-leave period that contains `today`, and the next grant.
export function annualPeriod(startDate, today) {
  if (!startDate || startDate > today) return { status: startDate ? 'future' : 'no_start', nextGrant: startDate ? { date: addMonths(startDate, 6), days: 3 } : null };
  const sixMonths = addMonths(startDate, 6);
  if (today < sixMonths) return { status: 'waiting', nextGrant: { date: sixMonths, days: 3 } };
  const oneYear = addMonths(startDate, 12);
  if (today < oneYear) return { status: 'active', from: sixMonths, to: addDays(oneYear, -1), days: 3, years: 0.5, nextGrant: { date: oneYear, days: 7 } };
  let years = 1;
  while (addMonths(startDate, 12 * (years + 1)) <= today) years++;
  const from = addMonths(startDate, 12 * years), next = addMonths(startDate, 12 * (years + 1));
  return { status: 'active', from, to: addDays(next, -1), days: daysForYears(years), years, nextGrant: { date: next, days: daysForYears(years + 1) } };
}

// Full-time = 40 h/week. Part-time staff get a proportional share (never more than full).
export function partTimeRatio(e) {
  const weekly = (Number(e.daily_hours) > 0 ? Number(e.daily_hours) : 8) * workDaySet(e).size;
  return Math.min(1, weekly / 40);
}

// Leave days taken from approved/pending requests between from..to (inclusive), on the person's work days, skipping holidays.
export function countLeaveDays(requests, e, from, to, holidays = new Set()) {
  const wd = workDaySet(e);
  let n = 0;
  for (const r of requests) {
    for (let d = r.start_date > from ? r.start_date : from; d <= r.end_date && d <= to; d = addDays(d, 1)) {
      if (wd.has(weekday(d)) && !holidays.has(d)) n += r.half_day ? 0.5 : 1;
    }
  }
  return n;
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Balance overview for one employee.
 * @param requests this employee's leave requests (any status)
 * @param holidays Set of holiday dates
 */
export function leaveBalance(e, requests, today, holidays = new Set()) {
  const ratio = partTimeRatio(e);
  const period = annualPeriod(e.start_date, today);
  const by = (type, status) => requests.filter((r) => r.type === type && r.status === status);
  const out = { employee_id: e.id, name: e.name, color: e.color, pay_type: e.pay_type || 'hourly', start_date: e.start_date || null, ratio: round1(ratio * 100) / 100, annual: null };
  if (period.status === 'active') {
    const earned = round1(period.days * ratio);
    const used = countLeaveDays(by('annual', 'approved'), e, period.from, period.to, holidays);
    const pending = countLeaveDays(by('annual', 'pending'), e, period.from, period.to, holidays);
    out.annual = { ...period, legal_days: period.days, earned, used, pending, remaining: round1(earned - used), next: { ...period.nextGrant, days: round1(period.nextGrant.days * ratio) } };
  } else {
    out.annual = { status: period.status, next: period.nextGrant ? { ...period.nextGrant, days: round1(period.nextGrant.days * ratio) } : null };
  }
  // Calendar-year counters against the legal limits (sick 30 days half-paid, personal 14 days)
  const yFrom = `${today.slice(0, 4)}-01-01`, yTo = `${today.slice(0, 4)}-12-31`;
  out.sick = { used: countLeaveDays(by('sick', 'approved'), e, yFrom, yTo, holidays), limit: 30 };
  out.personal = { used: countLeaveDays(by('personal', 'approved'), e, yFrom, yTo, holidays), limit: 14 };
  out.other = { used: countLeaveDays(by('other', 'approved'), e, yFrom, yTo, holidays) };
  return out;
}
