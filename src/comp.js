// 補休 (compensatory time off for overtime), Labor Standards Act art. 32-1.
// With the employee's agreement, overtime is banked hour-for-hour instead of paid. Banked hours are used
// oldest-first. Hours not used within the agreed period (`expiry_months`) must be paid at the overtime
// rate of when they were worked. Pure functions: no database.
import { DEFAULT_PAYROLL, hoursPerDay, splitDay, inComp } from './payroll.js';
import { addMonths } from './leave-balance.js';

const hrs = (n) => Math.round(n * 100) / 100;

/**
 * @param e          employee (pay_type, hourly_rate, monthly_salary, daily_hours, work_days)
 * @param shifts     this employee's shifts since the first 補休 period started
 * @param periods    agreed periods [{ from_date, to_date|null }]
 * @param requests   this employee's 補休 leave requests (approved and pending), with `hours`
 * @param payouts    hours already paid out for expired 補休 [{ hours }]
 * @param holidays   Set of holiday dates
 * @param today      'YYYY-MM-DD'
 * @param cfg        payroll settings (overtime rates, divisor) plus comp_expiry_months
 */
export function compBalance({ e, shifts, periods, requests = [], payouts = [], holidays = new Set(), today, cfg = DEFAULT_PAYROLL, dayKey, now = Date.now() }) {
  cfg = { ...DEFAULT_PAYROLL, ...cfg };
  const expiryMonths = Number(cfg.comp_expiry_months) > 0 ? Number(cfg.comp_expiry_months) : 6;
  const monthly = e.pay_type === 'monthly';
  const rate = monthly ? (Number(e.monthly_salary) || 0) / (Number(cfg.divisor) || 240) : Number(e.hourly_rate) || 0;
  const hol = holidays instanceof Map ? holidays : new Map([...holidays].map((d) => [d, '']));

  // Earned: overtime on agreed dates, one entry per day (oldest first)
  const entries = [];
  for (const [d, h] of Object.entries(hoursPerDay(shifts.filter((s) => s.clock_out), dayKey, now)).sort()) {
    if (d > today || !inComp(periods, d)) continue;
    const sp = splitDay(e, d, h, hol, cfg);
    if (sp.ot1 + sp.ot2 > 0) entries.push({ date: d, ot1: sp.ot1, ot2: sp.ot2, expires: addMonths(d, expiryMonths) });
  }
  const earned = entries.reduce((a, x) => a + x.ot1 + x.ot2, 0);
  const used = requests.filter((r) => r.status === 'approved').reduce((a, r) => a + (Number(r.hours) || 0), 0);
  const pending = requests.filter((r) => r.status === 'pending').reduce((a, r) => a + (Number(r.hours) || 0), 0);
  const paid = payouts.reduce((a, p) => a + (Number(p.hours) || 0), 0);

  // Use banked hours oldest-first (1.34-rate hours before 1.67-rate hours within a day)
  let consume = used + paid;
  const left = entries.map((x) => {
    const a = Math.min(x.ot1, consume); consume -= a;
    const b = Math.min(x.ot2, consume); consume -= b;
    return { ...x, ot1: x.ot1 - a, ot2: x.ot2 - b };
  });
  const expiredEntries = left.filter((x) => x.expires <= today && x.ot1 + x.ot2 > 0.001);
  const expiredHours = expiredEntries.reduce((a, x) => a + x.ot1 + x.ot2, 0);
  const expiredValue = expiredEntries.reduce((a, x) => a + rate * (x.ot1 * cfg.ot_rate1 + x.ot2 * cfg.ot_rate2), 0);
  const soonLimit = addMonths(today, 1);
  const expiringSoon = left.filter((x) => x.expires > today && x.expires <= soonLimit).reduce((a, x) => a + x.ot1 + x.ot2, 0);
  const nextExpiry = left.find((x) => x.expires > today && x.ot1 + x.ot2 > 0.001)?.expires || null;
  const available = Math.max(0, earned - used - paid - expiredHours);

  return {
    earned: hrs(earned), used: hrs(used), pending: hrs(pending), paid_out: hrs(paid),
    available: hrs(available), requestable: hrs(Math.max(0, available - pending)),
    expired_unpaid: { hours: hrs(expiredHours), amount: Math.round(expiredValue) },
    expiring_soon: hrs(expiringSoon), next_expiry: nextExpiry, expiry_months: expiryMonths,
    entries: entries.map((x) => ({ date: x.date, hours: hrs(x.ot1 + x.ot2), expires: x.expires })),
  };
}
