// Payroll maths for one employee and one month. Pure functions: no database, easy to test.
//
// Hourly staff:  regular hours x rate + overtime + paid leave + bonus − deductions
// Monthly staff: salary + overtime − unpaid part of leave + bonus − deductions
// Overtime: hours beyond the person's daily hours on a day (for monthly staff, every hour on a
// non-working day). The first `ot_tier` overtime hours pay `ot_rate1`, the rest `ot_rate2`.
// Monthly staff's hourly value = salary / `divisor` (Taiwan practice: 30 days x 8 h = 240).
// National holidays (Labor Standards Act art. 37/39): a paid day off. Working on one earns an extra
// day's wage (`holiday_full_day`: a full day even for fewer hours, otherwise the hours worked), and
// hours beyond the daily hours are overtime. Hourly staff get their daily hours paid for a holiday
// that falls on one of their work days (`holiday_pay_hourly`); monthly staff already have it in salary.
// 補休 (comp time, LSA art. 32-1): while the employee has agreed, overtime on those dates is not paid but
// banked hour-for-hour (see comp.js). Taking 補休 is paid time: hourly staff are paid the hours, monthly
// staff keep their salary.

export const DEFAULT_PAYROLL = { ot_auto: true, ot_rate1: 1.34, ot_tier: 2, ot_rate2: 1.67, divisor: 240, holiday_full_day: true, holiday_pay_hourly: true };
export const DEFAULT_LEAVE_PAY = { annual: 100, sick: 50, personal: 0, other: 0 };

const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
export const weekday = (d) => new Date(d + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
export function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
export const workDaySet = (e) => new Set(String(e.work_days ?? '1,2,3,4,5').split(',').filter((x) => x !== '').map(Number));
const money = (n) => Math.round(n);
const hrs = (n) => Math.round(n * 100) / 100;

// Hours worked per business day: { 'YYYY-MM-DD': hours }
export function hoursPerDay(shifts, dayKey, now = Date.now()) {
  const perDay = {};
  for (const s of shifts) {
    const ms = Math.max(0, (s.clock_out ?? now) - s.clock_in - (s.break_min || 0) * 60000);
    const d = dayKey(s.clock_in);
    perDay[d] = (perDay[d] || 0) + ms / 3600e3;
  }
  return perDay;
}
// Splits one day's hours into regular and overtime (first `ot_tier` hours, then the rest)
export function splitDay(e, d, h, holidays, cfg) {
  cfg = { ...DEFAULT_PAYROLL, ...cfg };
  const daily = Number(e.daily_hours) > 0 ? Number(e.daily_hours) : 8;
  const tier = Number(cfg.ot_tier) >= 0 ? Number(cfg.ot_tier) : 2;
  const threshold = holidays.has(d) ? daily : e.pay_type === 'monthly' && !workDaySet(e).has(weekday(d)) ? 0 : daily;
  const over = cfg.ot_auto ? Math.max(0, h - threshold) : 0;
  return { regular: h - over, ot1: Math.min(over, tier), ot2: Math.max(0, over - tier) };
}
// Is this date covered by an agreed 補休 period? periods: [{ from_date, to_date|null }]
export const inComp = (periods, d) => periods.some((p) => p.from_date <= d && (!p.to_date || d <= p.to_date));

/**
 * @param e        employee row (pay_type, hourly_rate, monthly_salary, daily_hours, work_days, leave_hours, insurance)
 * @param month    'YYYY-MM'
 * @param shifts   that employee's shifts that started in the month
 * @param leave    that employee's approved leave requests overlapping the month
 * @param adj      saved adjustments { bonus, deduction, deduction_note, insurance, note } or null
 * @param leavePay percentage paid per leave type
 * @param cfg      payroll settings (DEFAULT_PAYROLL shape)
 * @param dayKey   ms -> 'YYYY-MM-DD' in the business timezone
 * @param today    'YYYY-MM-DD' (for "days without punches", only days up to today count)
 * @param now      ms, used for shifts still open
 * @param holidays Map of 'YYYY-MM-DD' -> holiday name (national holidays in this month)
 * @param payoutDays unused annual-leave days paid out this month (特休未休工資), at one day's wage each
 * @param compPeriods agreed 補休 periods [{ from_date, to_date }]: overtime on those dates is banked, not paid
 * @param compPayout  amount paid this month for expired, unused 補休 hours (and how many hours)
 */
export function computePay({ e, month, shifts, leave, adj, leavePay = DEFAULT_LEAVE_PAY, cfg = DEFAULT_PAYROLL, dayKey, today, now = Date.now(), holidays = new Map(), payoutDays = 0, compPeriods = [], compPayout = { hours: 0, amount: 0 } }) {
  cfg = { ...DEFAULT_PAYROLL, ...cfg };
  const monthly = e.pay_type === 'monthly';
  const daily = Number(e.daily_hours) > 0 ? Number(e.daily_hours) : 8;
  const salary = Number(e.monthly_salary) || 0;
  const rate = monthly ? salary / (Number(cfg.divisor) || 240) : Number(e.hourly_rate) || 0;
  const wd = workDaySet(e);
  const tier = Number(cfg.ot_tier) >= 0 ? Number(cfg.ot_tier) : 2;

  // Hours per day
  const perDay = hoursPerDay(shifts, dayKey, now);
  const openShifts = shifts.filter((s) => !s.clock_out).length;
  let worked = 0, regular = 0, ot1 = 0, ot2 = 0, compOt = 0, holidayWorked = 0, holidayExtraHours = 0;
  for (const [d, h] of Object.entries(perDay)) {
    worked += h;
    const holiday = holidays.has(d);
    const sp = splitDay(e, d, h, holidays, cfg);
    regular += sp.regular;
    if (inComp(compPeriods, d)) compOt += sp.ot1 + sp.ot2; // banked as 補休, not paid now
    else { ot1 += sp.ot1; ot2 += sp.ot2; }
    if (holiday && h > 0) {
      holidayWorked += h;
      holidayExtraHours += cfg.holiday_full_day ? daily : Math.min(h, daily);
    }
  }

  // Leave: only scheduled working days inside the month count
  const days = monthDays(month);
  const leaveDays = new Set();
  const leaveByType = {};
  let leaveAdd = 0, leaveDeduct = 0;
  for (const r of leave) {
    for (let d = r.start_date > days[0] ? r.start_date : days[0]; d <= r.end_date && d <= days[days.length - 1]; d = addDays(d, 1)) {
      if (!wd.has(weekday(d)) || holidays.has(d)) continue; // holidays are already paid days off
      const share = r.half_day ? 0.5 : 1;
      const comp = r.type === 'comp';
      const h = comp ? Number(r.hours) || daily * share : (monthly ? daily : Number(e.leave_hours ?? 8)) * share;
      const pct = comp ? 100 : Number(leavePay[r.type]) || 0; // 補休 is always paid time
      const t = (leaveByType[r.type] ||= { type: r.type, days: 0, hours: 0, pct, amount: 0 });
      t.days += comp ? h / daily : share; t.hours += h;
      if (monthly) { const cut = h * rate * (1 - pct / 100); t.amount -= cut; leaveDeduct += cut; }
      else { const pay = h * rate * pct / 100; t.amount += pay; leaveAdd += pay; }
      leaveDays.add(d);
    }
  }

  // Holidays on this person's work days
  const holidayDays = days.filter((d) => holidays.has(d) && wd.has(weekday(d)));
  // Hourly staff: a holiday on a work day they didn't work is paid at their daily hours
  const paidHolidays = !monthly && cfg.holiday_pay_hourly ? holidayDays.filter((d) => !perDay[d]) : [];
  const holidayPay = paidHolidays.length * daily * rate;
  const holidayWork = holidayExtraHours * rate;
  // One day's wage: monthly salary / 30, or daily hours x hourly rate
  const dayWage = monthly ? salary / 30 : daily * rate;
  const leavePayout = (Number(payoutDays) || 0) * dayWage;

  // Scheduled days with no punches, no leave and no holiday (monthly staff, information only)
  const missing = monthly ? days.filter((d) => d <= today && wd.has(weekday(d)) && !perDay[d] && !leaveDays.has(d) && !holidays.has(d)) : [];

  const bonus = Number(adj?.bonus) || 0;
  const insurance = adj && adj.insurance != null ? Number(adj.insurance) || 0 : Number(e.insurance) || 0;
  const other = Number(adj?.deduction) || 0;
  const base = monthly ? salary : regular * rate;
  const otPay = ot1 * rate * (Number(cfg.ot_rate1) || 1) + ot2 * rate * (Number(cfg.ot_rate2) || 1);
  const compPay = Number(compPayout?.amount) || 0;
  const gross = money(base) + money(otPay) + money(leaveAdd) + money(holidayPay) + money(holidayWork) + money(leavePayout) + money(compPay) + money(bonus);
  const deductions = money(leaveDeduct) + money(insurance) + money(other);

  return {
    employee_id: e.id, name: e.name, color: e.color, pay_type: monthly ? 'monthly' : 'hourly', month,
    rate: hrs(rate), salary: money(salary), daily_hours: daily,
    hours: { worked: hrs(worked), regular: hrs(regular), ot1: hrs(ot1), ot2: hrs(ot2), holiday: hrs(holidayWorked), holiday_extra: hrs(holidayExtraHours), comp: hrs(compOt) },
    holidays: holidayDays.map((d) => ({ date: d, name: holidays.get(d), worked: hrs(perDay[d] || 0), paid: paidHolidays.includes(d) })),
    days_worked: Object.keys(perDay).length, open_shifts: openShifts, missing_days: missing,
    leave: Object.values(leaveByType).map((l) => ({ ...l, hours: hrs(l.hours), amount: money(l.amount) })),
    earnings: { base: money(base), overtime: money(otPay), leave: money(leaveAdd), holiday: money(holidayPay), holiday_work: money(holidayWork), leave_payout: money(leavePayout), comp_payout: money(compPay), bonus: money(bonus) },
    comp_payout_hours: hrs(Number(compPayout?.hours) || 0),
    leave_payout_days: Number(payoutDays) || 0,
    deductions: { leave: money(leaveDeduct), insurance: money(insurance), other: money(other), other_note: adj?.deduction_note || '' },
    gross, total_deductions: deductions, net: gross - deductions,
    note: adj?.note || '',
    rates: { ot_rate1: Number(cfg.ot_rate1), ot_rate2: Number(cfg.ot_rate2), ot_tier: tier },
  };
}
