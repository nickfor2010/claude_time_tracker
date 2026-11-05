// Bilingual payslip (中文 + English on every line), printable to A4 / PDF.
import { api, esc, dayKey } from './common.js';

const q = new URLSearchParams(location.search);
const month = q.get('month'), emp = q.get('emp');
const admin = !!emp;
const $ = (s) => document.querySelector(s);
const nt = (n) => 'NT$ ' + Math.round(n).toLocaleString('en-US');
const L = (zh, en) => `${zh} <small>${en}</small>`;
const leaveName = { annual: ['特休', 'Annual leave'], sick: ['病假', 'Sick leave'], personal: ['事假', 'Personal leave'], other: ['其他休假', 'Other leave'], comp: ['補休', 'Comp time off'] };
const h = (x) => (Math.round(x * 100) / 100).toLocaleString('en-US');

$('#back').href = admin ? '/admin#payroll' : '/';
$('#back').textContent = admin ? '← 薪資 Payroll' : '← 打卡 Time clock';
$('#print').onclick = () => print();

function render({ row: r, company }) {
  const [y, m] = r.month.split('-');
  const monthly = r.pay_type === 'monthly';
  const earn = [
    [L(monthly ? '月薪' : '本薪', monthly ? 'Monthly salary' : `Regular pay · ${h(r.hours.regular)} h × ${nt(r.rate)}`), r.earnings.base],
    r.earnings.overtime ? [L('加班費', `Overtime · ${h(r.hours.ot1)} h × ${r.rates.ot_rate1}${r.hours.ot2 ? ` + ${h(r.hours.ot2)} h × ${r.rates.ot_rate2}` : ''}`), r.earnings.overtime] : null,
    ...(!monthly ? r.leave.filter((l) => l.amount).map((l) => [L(`${leaveName[l.type][0]}（帶薪 ${l.pct}%）`, `${leaveName[l.type][1]} · ${l.days} d · paid ${l.pct}%`), l.amount]) : []),
    r.earnings.holiday ? [L('國定假日工資', `Holiday pay · ${(r.holidays || []).filter((x) => x.paid).length} d × ${h(r.daily_hours)} h`), r.earnings.holiday] : null,
    r.earnings.holiday_work ? [L('國定假日出勤加給', `Holiday work pay · ${h(r.hours.holiday)} h worked`), r.earnings.holiday_work] : null,
    r.earnings.leave_payout ? [L('特休未休折算工資', `Unused annual leave · ${h(r.leave_payout_days)} d`), r.earnings.leave_payout] : null,
    r.earnings.comp_payout ? [L('補休未休折發工資', `Unused comp time · ${h(r.comp_payout_hours)} h at overtime rate`), r.earnings.comp_payout] : null,
    r.earnings.bonus ? [L('獎金', 'Bonus'), r.earnings.bonus] : null,
  ].filter(Boolean);
  const ded = [
    ...(monthly ? r.leave.filter((l) => l.amount).map((l) => [L(`${leaveName[l.type][0]}扣薪`, `${leaveName[l.type][1]} · ${l.days} d · ${100 - l.pct}% unpaid`), -l.amount]) : []),
    r.deductions.insurance ? [L('勞健保自付額', 'Labour & health insurance'), r.deductions.insurance] : null,
    r.deductions.other ? [L(`其他扣款${r.deductions.other_note ? '：' + esc(r.deductions.other_note) : ''}`, 'Other deduction'), r.deductions.other] : null,
  ].filter(Boolean);
  const leaveDays = r.leave.reduce((a, l) => a + l.days, 0);
  const table = (rows, total, label) => `<table class="lines">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${nt(v)}</td></tr>`).join('') || '<tr><td>—</td><td>—</td></tr>'}
    <tr class="sum"><td>${label}</td><td>${nt(total)}</td></tr></table>`;
  $('#slip').innerHTML = `
    <article class="slip">
      <header class="slip-head">
        <div class="co"><img src="/icons/icon-192.png" alt=""><div><h1>${esc(company || 'Parsley 帕斯里')}</h1></div></div>
        <div class="title"><b>薪資單 PAYSLIP</b><span>${y} 年 ${Number(m)} 月 · ${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(r.month + '-01T00:00:00Z'))}</span></div>
      </header>
      <section class="who">
        <div><small>員工 Employee</small><b>${esc(r.name)}</b></div>
        <div><small>計薪方式 Pay type</small><b>${monthly ? `月薪 Monthly · ${nt(r.salary)}` : `時薪 Hourly · ${nt(r.rate)}`}</b></div>
        <div><small>狀態 Status</small><b>${r.status === 'paid' ? `已發放 Paid · ${dayKey(r.paid_at).replace(/-/g, '/')}` : '<span class="draft-mark">草稿 Draft</span>'}</b></div>
      </section>
      <div class="cols">
        <section><h2>應發項目 Earnings</h2>${table(earn, r.gross, '應發合計 Gross')}</section>
        <section><h2>應扣項目 Deductions</h2>${table(ded, r.total_deductions, '應扣合計 Total')}</section>
      </div>
      <div class="net"><span>實發金額 Net pay</span><b>${nt(r.net)}</b></div>
      <section class="hours">
        <div><small>出勤天數 Days worked</small><b>${r.days_worked}</b></div>
        <div><small>工時 Hours</small><b>${h(r.hours.worked)}</b></div>
        <div><small>加班 Overtime</small><b>${h(r.hours.ot1 + r.hours.ot2)}</b></div>
        <div><small>休假天數 Leave days</small><b>${h(leaveDays)}</b></div>
      </section>
      ${r.hours.comp ? `<div class="note"><b>加班轉補休 Overtime banked as comp time：</b>${h(r.hours.comp)} h（不另計加班費 · not paid as overtime）</div>` : ''}
      ${(r.holidays || []).length ? `<div class="note"><b>國定假日 Holidays：</b>${r.holidays.map((x) => `${x.date.slice(5).replace('-', '/')} ${esc(x.name)}${x.worked ? `（出勤 worked ${h(x.worked)} h）` : ''}`).join('、')}</div>` : ''}
      ${r.note ? `<div class="note"><b>備註 Note：</b>${esc(r.note)}</div>` : ''}
      <div class="sign"><div>員工簽名 Employee signature</div><div>雇主簽章 Employer</div></div>
      <div class="foot-meta"><span>${esc(company || 'Parsley')}</span><span>${r.status === 'paid' ? '' : '此為草稿，金額可能變動 · Draft, amounts may change'}</span></div>
    </article>`;
}

(async () => {
  try {
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('Missing month 缺少月份');
    render(await api(admin ? `/api/admin/payroll/${month}/${encodeURIComponent(emp)}` : `/api/payslips/${month}`));
  } catch (e) {
    $('#slip').innerHTML = `<div class="card empty">${e.status === 401 ? '請先登入 Please sign in first. <a href="' + (admin ? '/admin' : '/') + '">→</a>' : esc(e.message)}</div>`;
  }
})();
