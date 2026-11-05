// Annual leave (特休) by seniority, Taiwan Labor Standards Act art. 38 (2017):
//   6 months – 1 year: 3 days · 1–2 years: 7 · 2–3 years: 10 · 3–5 years: 14 · 5–10 years: 15
//   from 10 years: +1 day per extra year, up to 30 days.
// Two systems, chosen per employee:
//   週年制 anniversary: each year runs from the hire anniversary.
//   曆年制 calendar year: Jan 1 – Dec 31; days are the anniversary entitlements pro-rated by how much of
//   each anniversary period falls in that calendar year (Ministry of Labor proportional method), so the
//   total is never less than under the anniversary system.
// Part-time staff get a share in proportion to their weekly hours compared with a 40-hour week.
// Carry-over (遞延): unused days of a closed year can be carried into the next one, paid out, or closed.
// Pure functions: no database.
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

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3) + 1; // inclusive

// All anniversary periods (from, to, days) up to a date
export function anniversaryPeriods(startDate, until) {
  const out = [];
  if (!startDate) return out;
  out.push({ from: addMonths(startDate, 6), to: addDays(addMonths(startDate, 12), -1), days: 3 });
  for (let n = 1; addMonths(startDate, 12 * n) <= until; n++) {
    out.push({ from: addMonths(startDate, 12 * n), to: addDays(addMonths(startDate, 12 * (n + 1)), -1), days: daysForYears(n) });
  }
  return out;
}
// 曆年制: entitlement for calendar year `year`
export function calendarYearDays(startDate, year) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  let total = 0;
  for (const p of anniversaryPeriods(startDate, to)) {
    const a = p.from > from ? p.from : from, b = p.to < to ? p.to : to;
    if (a <= b) total += p.days * daysBetween(a, b) / daysBetween(p.from, p.to);
  }
  return Math.round(total * 100) / 100;
}

// The leave year containing `date` for this employee's system: { status, from, to, days, nextGrant }
export function leavePeriod(e, date) {
  if ((e.leave_system || 'anniversary') !== 'calendar') return annualPeriod(e.start_date, date);
  const s = e.start_date;
  if (!s || s > date) return { status: s ? 'future' : 'no_start', nextGrant: s ? { date: addMonths(s, 6), days: 3 } : null };
  const y = Number(date.slice(0, 4));
  const days = calendarYearDays(s, y);
  const next = { date: `${y + 1}-01-01`, days: calendarYearDays(s, y + 1) };
  if (days <= 0) return { status: 'waiting', nextGrant: addMonths(s, 6) > `${y}-12-31` ? next : { date: addMonths(s, 6), days: 3 } };
  return { status: 'active', from: `${y}-01-01`, to: `${y}-12-31`, days, years: y, nextGrant: next };
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
 * @param requests  this employee's leave requests (approved and pending)
 * @param holidays  Set of holiday dates
 * @param adjusts   manual adjustments [{ id, period_from, days, note }]
 * @param settles   decisions on closed years [{ period_from, action: 'carry'|'payout'|'none', days, target_from, payout_month }]
 */
export function leaveBalance(e, requests, today, holidays = new Set(), adjusts = [], settles = []) {
  const ratio = partTimeRatio(e);
  const period = leavePeriod(e, today);
  const by = (type, status) => requests.filter((r) => r.type === type && r.status === status);
  const out = { employee_id: e.id, name: e.name, color: e.color, pay_type: e.pay_type || 'hourly', start_date: e.start_date || null,
    leave_system: e.leave_system === 'calendar' ? 'calendar' : 'anniversary', ratio: round1(ratio * 100) / 100, annual: null, previous: null };
  // Balance of one leave year (earned + carried in + adjustments − used)
  const yearBalance = (p) => {
    const earned = round1(p.days * ratio);
    const carried = round1(settles.filter((x) => x.action === 'carry' && x.target_from === p.from).reduce((a, x) => a + Number(x.days), 0));
    const adj = adjusts.filter((x) => x.period_from === p.from);
    const adjusted = round1(adj.reduce((a, x) => a + Number(x.days), 0));
    const used = countLeaveDays(by('annual', 'approved'), e, p.from, p.to, holidays);
    const pending = countLeaveDays(by('annual', 'pending'), e, p.from, p.to, holidays);
    return { from: p.from, to: p.to, legal_days: p.days, earned, carried, adjusted, adjustments: adj, used, pending, remaining: round1(earned + carried + adjusted - used) };
  };
  if (period.status === 'active') {
    out.annual = { status: 'active', years: period.years, ...yearBalance(period), next: { ...period.nextGrant, days: round1(period.nextGrant.days * ratio) } };
    // The year that just closed, and what was decided about its unused days
    const prev = leavePeriod(e, addDays(period.from, -1));
    if (prev.status === 'active') {
      const pb = yearBalance(prev);
      const decision = settles.find((x) => x.period_from === prev.from) || null;
      out.previous = { ...pb, unused: Math.max(0, pb.remaining), decision, needs_decision: !decision && pb.remaining > 0 };
    }
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
