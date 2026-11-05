import { api, icons, esc, avatar, time, hm24, dur, hours, money, dayKey, dateLabel, worked, toast, setTimezone, clockNow, registerSW, pushStatus, enablePush, syncPush, leaveLabel, leaveRange, statusPill } from './common.js';
import { t, translatePage, langButton, isZh } from './i18n.js';
import { parseCSV, buildImport, TEMPLATE } from './csv-import.js';

const $ = (s, r = document) => r.querySelector(s);
const PAGES = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'timesheets', label: 'Timesheets', icon: 'sheet' },
  { id: 'timeoff', label: 'Time off', icon: 'plane' },
  { id: 'payroll', label: 'Payroll', icon: 'coins' },
  { id: 'team', label: 'Team', icon: 'users' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
  { id: 'history', label: 'History & import', icon: 'download', hidden: true },
];
let state = { page: 'overview', data: null, month: null, empFilter: '', shifts: [], leave: [] };
let liveTimer;

// ---------- auth ----------
async function boot() {
  try {
    state.data = await api('/api/admin/overview');
    setTimezone(state.data.timezone);
    state.month ||= state.data.today.slice(0, 7);
    $('#login').classList.add('hidden');
    $('#admin').classList.remove('hidden');
    buildNav();
    go(location.hash.slice(1) || 'overview');
  } catch (e) {
    if (e.status !== 401) toast(e.message, true);
    $('#admin').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#pw').focus();
  }
}
$('#login-form').onsubmit = async (ev) => {
  ev.preventDefault();
  $('#login-err').textContent = '';
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('#pw').value } });
    $('#pw').value = '';
    boot();
  } catch (e) { $('#login-err').textContent = e.message; }
};
const logout = async () => { await api('/api/admin/logout', { method: 'POST' }); location.hash = ''; boot(); };
$('#logout').onclick = logout;
$('#logout-m').onclick = logout;
$('#logout-m').innerHTML = icons.logout;
document.querySelectorAll('[data-icon]').forEach((b) => b.insertAdjacentHTML('afterbegin', icons[b.dataset.icon]));

function buildNav() {
  const pending = state.data?.pendingLeave || 0;
  const html = PAGES.filter((p) => !p.hidden).map((p) => `<button data-page="${p.id}" class="${p.id === state.page ? 'active' : ''}">${icons[p.icon]}<span>${t(p.label)}</span>${p.id === 'timeoff' && pending ? `<span class="badge" aria-label="${t('{n} waiting', { n: pending })}">${pending}</span>` : ''}</button>`).join('');
  $('#nav').innerHTML = html;
  $('#mnav').innerHTML = html;
  [$('#nav'), $('#mnav')].forEach((n) => (n.onclick = (ev) => { const b = ev.target.closest('button'); if (b) go(b.dataset.page); }));
}
async function go(page) {
  if (!PAGES.some((p) => p.id === page)) page = 'overview';
  state.page = page;
  if (location.hash.slice(1) !== page) history.replaceState(null, '', '#' + page);
  document.querySelectorAll('[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === (page === 'history' ? 'timesheets' : page)));
  await refresh();
  scrollTo({ top: 0 });
}
async function refresh() {
  try {
    state.data = await api('/api/admin/overview');
    if (state.page === 'timesheets') await loadShifts();
    if (state.page === 'timeoff') state.leave = (await api('/api/admin/leave')).requests;
    if (state.page === 'timeoff' || state.page === 'team') state.balances = (await api('/api/admin/balances')).balances;
    if (state.page === 'payroll') state.payroll = await api(`/api/admin/payroll?month=${state.month}`);
  } catch (e) { if (e.status === 401) return boot(); toast(e.message, true); }
  render();
}
// Open shifts that look like a forgotten clock-out: longer than the warning time, or started on an earlier day.
const isForgotten = (s, d = state.data) => !s.clock_out && (d.now - s.clock_in > d.alertHours * 3600e3 || dayKey(s.clock_in) !== d.today);

function render() {
  const d = state.data;
  const forgotten = d.onShift.filter((s) => isForgotten(s));
  buildNav();
  const leaveBanner = d.pendingLeave && state.page !== 'timeoff'
    ? `<div class="banner banner-leave">${icons.plane}<span>${t(d.pendingLeave === 1 ? '1 time-off request is waiting for you.' : '{n} time-off requests are waiting for you.', { n: d.pendingLeave })}</span><button class="btn btn-sm btn-primary" data-goto="timeoff">${t('Review')}</button></div>` : '';
  $('#banner').innerHTML = leaveBanner + forgotten.map((s) => `
    <div class="banner banner-warn" role="alert">${icons.alert}
      <span>${t('<b>{name}</b> has been clocked in for {dur} (since {since}). Forgot to clock out?', {
        name: esc(s.name), dur: `<b class="tnum" data-since="${s.clock_in}">${dur(d.now - s.clock_in)}</b>`,
        since: `${dayKey(s.clock_in) === d.today ? '' : dateLabel(dayKey(s.clock_in)) + ' '}${time(s.clock_in)}` })}</span>
      <button class="btn btn-sm btn-primary" data-fix="${s.id}">${t('Fix')}</button>
    </div>`).join('') + (d.adminDefaultPassword
    ? `<div class="banner">${icons.alert}<span>${t("You're using the default admin password. Please change it.")}</span><button class="btn btn-sm btn-ghost" data-goto="settings">${t('Change now')}</button></div>` : '');
  $('#banner').querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => openShift(d.onShift.find((s) => s.id === Number(b.dataset.fix)), { forgot: true })));
  $('#side-live').innerHTML = `${t('<b>{n}</b> of {total} on shift now', { n: d.onShift.length, total: d.employees.filter((e) => e.active).length })}<br>${dateLabel(d.today, { weekday: 'long', month: 'long', day: 'numeric' })}`;
  ({ overview: renderOverview, timesheets: renderTimesheets, timeoff: renderTimeoff, payroll: renderPayroll, team: renderTeam, settings: renderSettings, history: renderHistory })[state.page]();
  clearInterval(liveTimer);
  liveTimer = setInterval(tickLive, 1000);
}
document.addEventListener('click', (ev) => { const g = ev.target.closest('[data-goto]'); if (g) go(g.dataset.goto); });

function tickLive() {
  const skew = Date.now() - state.data.now;
  document.querySelectorAll('[data-since]').forEach((el) => (el.textContent = dur(Date.now() - skew - Number(el.dataset.since), { seconds: el.dataset.sec === '1' })));
}

// ---------- overview ----------
function holidayName(h) { return isZh() ? h.name_zh : (h.name_en || h.name_zh); }
function holidayLine(d) {
  const h = (d.nextHolidays || [])[0];
  if (!h) return '';
  if (h.date === d.today) return ` <b style="color:var(--orange-700)">🎉 ${t('Today is a national holiday: {name}', { name: esc(holidayName(h)) })}</b>`;
  return ` <span class="muted">· ${t('Next holiday: {name}, {date}', { name: esc(holidayName(h)), date: dateLabel(h.date, { weekday: 'short', month: 'short', day: 'numeric' }) })}</span>`;
}
function greeting() {
  const h = Number(clockNow({ hour: 'numeric', hourCycle: 'h23' }).replace(/\D/g, ''));
  return t(h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera');
}
function renderOverview() {
  const d = state.data, tot = d.totals;
  const active = d.employees.filter((e) => e.active);
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>${t('{greet}, Chef', { greet: greeting() })}</h1><p>${t("Here's how the team is doing today.")}${holidayLine(d)}${upcomingBirthdays(d.employees, d.today).map((b) => ` <span class="bday">🎂 ${b.days === 0 ? t("{name}'s birthday is today!", { name: esc(b.e.name) }) : t('{name} · {date}', { name: esc(b.e.name), date: dateLabel(b.next, { month: 'short', day: 'numeric' }) })}</span>`).join('')}</p></div>
      <div class="toolbar"><button class="btn btn-ghost" data-goto="timesheets">${icons.sheet} ${t('Timesheets')}</button><button class="btn btn-primary" id="ov-add">${icons.plus} ${t('Add shift')}</button></div>
    </div>
    <div class="kpis">
      <div class="card kpi hero"><div class="k">${icons.clock} ${t('On shift now')}</div><div class="v">${d.onShift.length}<small>/ ${active.length}</small></div><div class="h">${d.onShift.length ? esc(d.onShift.map((s) => s.name.split(' ')[0]).join(', ')) : t('Nobody clocked in')}</div></div>
      <div class="card kpi"><div class="k">${icons.sun} ${t('Hours today')}</div><div class="v">${hours(tot.todayMs)}<small>${t('h')}</small></div><div class="h">${dateLabel(d.today, { weekday: 'long', month: 'short', day: 'numeric' })}</div></div>
      <div class="card kpi"><div class="k">${icons.cal} ${t('Hours this week')}</div><div class="v">${hours(tot.weekMs)}<small>${t('h')}</small></div><div class="h">${t('Since Monday')}</div></div>
      <div class="card kpi"><div class="k">${icons.coins} ${t('Payroll this month')}</div><div class="v" style="font-size:clamp(20px,2.4vw,30px)">${money(tot.monthPay)}</div><div class="h">${t('{h} h worked · estimate', { h: hours(tot.monthMs) })}${tot.monthLeavePay ? ` · ${t('incl. {pay} paid leave', { pay: money(tot.monthLeavePay) })}` : ''}</div></div>
    </div>
    <div class="grid-2">
      <div class="card panel">
        <div class="panel-head"><h2>${t('Hours per day')}</h2><span class="muted">${t('Last 14 days')}</span></div>
        <div class="chart-wrap" id="chart"></div>
      </div>
      <div class="card panel">
        <div class="panel-head"><h2>${t('Team today')}</h2><span class="muted">${t('{n} working', { n: d.onShift.length })}</span></div>
        <div class="who">${active.length ? active.sort((a, b) => b.onShift - a.onShift || b.todayMs - a.todayMs).map((e) => {
          const open = d.onShift.find((s) => s.employee_id === e.id);
          const away = (d.leaveSoon || []).find((r) => r.employee_id === e.id && r.start_date <= d.today && r.end_date >= d.today);
          return `<div class="who-row">${avatar(e, open ? 'on' : '')}<div><div class="nm">${esc(e.name)}</div><div class="s">${open && isForgotten(open) ? `<span style="color:var(--clay);font-weight:600">${t('No clock-out since {since}', { since: (dayKey(open.clock_in) === d.today ? '' : dateLabel(dayKey(open.clock_in)) + ' ') + time(open.clock_in) })}</span>` : open ? t('In since {t}', { t: time(open.clock_in) }) : e.todayMs ? t('Worked {dur} today', { dur: dur(e.todayMs) }) : away ? `${icons.plane.replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')} ${t('On leave today')} · ${leaveLabel(away.type)}` : t('Not in today')}</div></div>
            <div class="live">${open ? `<span data-since="${open.clock_in}" data-sec="1">${dur(d.now - open.clock_in, { seconds: true })}</span>` : `<span class="muted">${e.todayMs ? hours(e.todayMs) + ' ' + t('h') : '—'}</span>`}</div></div>`;
        }).join('') : `<div class="empty">${t('Add your team to get started.')}<br><br><button class="btn btn-primary btn-sm" data-goto="team">${icons.plus} ${t('Add team member')}</button></div>`}</div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card panel">
        <div class="panel-head"><h2>${t('This week by person')}</h2><span class="muted">${t('Mon – today')}</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>${t('Employee')}</th><th class="num">${t('Today')}</th><th class="num">${t('Week')}</th><th class="num">${t('Month')}</th><th class="num">${t('Month pay')}</th></tr></thead><tbody>
        ${active.map((e) => `<tr><td><span class="emp">${avatar(e)}${esc(e.name)}</span></td><td class="num">${dur(e.todayMs)}</td><td class="num">${dur(e.weekMs)}</td><td class="num">${dur(e.monthMs)}</td><td class="num">${money(e.monthGross || 0)}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">${t('No team members yet.')}</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="card panel">
        <div class="panel-head"><h2>${t('Recent activity')}</h2></div>
        <div class="who">${d.activity.length ? d.activity.slice(0, 8).map((s) => {
          const out = !!s.clock_out;
          return `<div class="who-row">${avatar(s)}<div><div class="nm">${esc(s.name)} <span class="tag ${out ? '' : 'live'}">${out ? t('OUT') : t('IN')}</span></div><div class="s">${dateLabel(dayKey(out ? s.clock_out : s.clock_in))} · ${time(out ? s.clock_out : s.clock_in)}</div></div><div class="live muted" style="font-weight:600">${out ? dur(worked(s)) : ''}</div></div>`;
        }).join('') : `<div class="empty">${t('Punches will show up here.')}</div>`}</div>
      </div>
    </div>`;
  $('#ov-add').onclick = () => openShift();
  drawChart($('#chart'), d);
}

function drawChart(el, d) {
  const emps = d.employees; // creation order = stable colour order
  const used = emps.filter((e) => d.days.some((day) => day.byEmp[e.id]));
  const W = Math.max(300, Math.round(el.clientWidth || 640)), H = W < 500 ? 220 : 260, pad = { l: 34, r: 8, t: 10, b: 26 };
  const totals = d.days.map((day) => Object.values(day.byEmp).reduce((a, b) => a + b, 0) / 3600e3);
  const maxH = Math.max(8, Math.ceil(Math.max(...totals) / 4) * 4);
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const bw = iw / d.days.length, barW = Math.min(26, bw * 0.62);
  const y = (h) => pad.t + ih - (h / maxH) * ih;
  const ticks = Array.from({ length: 5 }, (_, i) => (maxH / 4) * i);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('Stacked bar chart of hours worked per day for the last 14 days')}">
    <g class="grid">${ticks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke-width="1"/>`).join('')}</g>
    <g class="axis">${ticks.map((v) => `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}h</text>`).join('')}</g>`;
  d.days.forEach((day, i) => {
    const cx = pad.l + bw * i + bw / 2, x = cx - barW / 2;
    let acc = 0, segs = '';
    const parts = emps.filter((e) => day.byEmp[e.id]).map((e) => ({ e, h: day.byEmp[e.id] / 3600e3 }));
    parts.forEach((p, j) => {
      const y0 = y(acc), y1 = y(acc + p.h);
      const top = j === parts.length - 1;
      const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
      const h = Math.max(0, y0 - y1 - gap);
      if (h > 0) {
        const r = top ? Math.min(4, h, barW / 2) : 0;
        const yy = y1, yb = yy + h;
        segs += `<path class="seg" fill="${p.e.color}" d="M${x},${yb} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${yb} Z"/>`;
      }
      acc += p.h;
    });
    const showLabel = d.days.length <= 7 || i % 2 === (d.days.length - 1) % 2;
    svg += `<g class="col" data-i="${i}"><rect class="hit" x="${pad.l + bw * i}" y="${pad.t}" width="${bw}" height="${ih}" rx="6"/>${segs}
      ${showLabel ? `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle" fill="var(--ink-3)" font-size="11" ${day.date === d.today ? 'font-weight="700" style="fill:var(--ink)"' : ''}>${dateLabel(day.date, { month: 'numeric', day: 'numeric' })}</text>` : ''}</g>`;
  });
  svg += '</svg>';
  el.innerHTML = svg + `<div class="legend">${used.map((e) => `<span><i style="--c:${e.color}"></i>${esc(e.name)}</span>`).join('') || `<span class="muted">${t('No hours recorded in the last 14 days.')}</span>`}</div><div class="tip hidden"></div>`;

  const tip = $('.tip', el), svgEl = $('svg', el);
  el.querySelectorAll('.col').forEach((g) => {
    const day = d.days[Number(g.dataset.i)];
    const show = () => {
      const rows = emps.filter((e) => day.byEmp[e.id]).map((e) => `<div class="r"><span><i style="--c:${e.color}"></i>${esc(e.name)}</span><b class="tnum">${dur(day.byEmp[e.id])}</b></div>`).join('');
      const total = Object.values(day.byEmp).reduce((a, b) => a + b, 0);
      tip.innerHTML = `<div class="tt">${dateLabel(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}</div>${rows || `<div class="muted">${t('No hours')}</div>`}${rows ? `<div class="r" style="margin-top:6px;border-top:1px solid var(--line);padding-top:6px"><span>${t('Total')}</span><b class="tnum">${dur(total)}</b></div>` : ''}`;
      const box = svgEl.getBoundingClientRect(), wrap = el.getBoundingClientRect();
      const i = Number(g.dataset.i);
      const cx = ((pad.l + (iw / d.days.length) * (i + 0.5)) / W) * box.width + (box.left - wrap.left);
      const top = (y(Object.values(day.byEmp).reduce((a, b) => a + b, 0) / 3600e3) / H) * box.height + (box.top - wrap.top);
      tip.style.left = `${Math.min(Math.max(cx, 90), wrap.width - 90)}px`;
      tip.style.top = `${Math.max(top, 70)}px`;
      tip.classList.remove('hidden');
    };
    g.addEventListener('mouseenter', show);
    g.addEventListener('click', show);
    g.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  });
}

// ---------- timesheets ----------
function monthRange(m) {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
}
async function loadShifts() {
  const { from, to } = monthRange(state.month);
  const r = await api(`/api/admin/shifts?from=${from}&to=${to}${state.empFilter ? `&employee=${state.empFilter}` : ''}`);
  state.shifts = r.shifts;
  state.leaveDays = r.leave || [];
}
function renderTimesheets() {
  const d = state.data, shifts = state.shifts;
  const { from, to } = monthRange(state.month);
  const byEmp = {};
  const newB = (x) => ({ e: { name: x.name, color: x.color }, ms: 0, n: 0, pay: 0, days: new Set(), leaveDays: 0, leavePay: 0 });
  for (const s of shifts) {
    const b = (byEmp[s.employee_id] ||= newB(s));
    const w = worked(s, d.now);
    b.ms += w; b.n++; b.pay += (w / 3600e3) * (s.hourly_rate || 0); b.days.add(s.day);
  }
  const leaveDays = state.leaveDays || [];
  for (const l of leaveDays) {
    const b = (byEmp[l.employee_id] ||= newB(l));
    b.leaveDays += l.half_day ? 0.5 : 1; b.leavePay += l.pay; b.pay += l.pay;
  }
  // Shifts and paid-leave days in one list, newest first
  const rowsAll = [...shifts.map((s) => ({ key: s.day, at: s.clock_in, s })), ...leaveDays.map((l) => ({ key: l.date, at: Date.parse(l.date + 'T23:59:59Z'), l }))]
    .sort((a, b) => b.key.localeCompare(a.key) || b.at - a.at);
  const monthName = dateLabel(from, { month: 'long', year: 'numeric' });
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>${t('Timesheets')}</h1><p>${t(shifts.length === 1 ? '{month} · 1 shift' : '{month} · {n} shifts', { month: monthName, n: shifts.length })}</p></div>
      <div class="toolbar">
        <input class="input" type="month" id="ts-month" value="${state.month}" aria-label="${t('Month')}">
        <select class="input" id="ts-emp" aria-label="${t('Employee')}"><option value="">${t('Everyone')}</option>${d.employees.map((e) => `<option value="${e.id}" ${String(e.id) === String(state.empFilter) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        <a class="btn btn-ghost" href="/api/admin/export.csv?from=${from}&to=${to}${state.empFilter ? `&employee=${state.empFilter}` : ''}&lang=${isZh() ? 'zh' : 'en'}">${icons.download} ${t('Export CSV')}</a>
        <button class="btn btn-ghost" data-goto="history">${icons.download} ${t('History & import')}</button>
        <button class="btn btn-primary" id="ts-add">${icons.plus} ${t('Add shift')}</button>
      </div>
    </div>
    <div class="sum-cards">${Object.values(byEmp).map((b) => `<div class="card sum-card">${avatar(b.e)}<div><div style="font-weight:600">${esc(b.e.name)}</div><div class="v">${dur(b.ms)}</div><div class="s">${t('{n} days · {pay}', { n: b.days.size, pay: money(b.pay) })}${b.leaveDays ? `<br>${t('incl. {n} days paid leave ({pay})', { n: b.leaveDays, pay: money(b.leavePay) })}` : ''}</div></div></div>`).join('')}</div>
    <div class="card panel" style="padding:6px 6px">
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>${t('Date')}</th><th>${t('Employee')}</th><th>${t('In')}</th><th>${t('Out')}</th><th class="num">${t('Break')}</th><th class="num">${t('Worked')}</th><th class="num">${t('Pay')}</th><th>${t('Note')}</th><th></th></tr></thead>
        <tbody>${rowsAll.length ? rowsAll.map(({ s, l }) => {
          if (l) return `<tr class="leave-row">
            <td>${dateLabel(l.date)}</td>
            <td><span class="emp">${avatar(l)}${esc(l.name)}</span></td>
            <td colspan="2"><span class="tag leave">${icons.plane.replace('<svg', '<svg width="12" height="12" style="vertical-align:-1px"')} ${leaveLabel(l.type)}${l.half_day ? ' · ' + t('half day') : ''}</span></td>
            <td class="num">—</td>
            <td class="num"><b>${dur(l.hours * 3600e3)}</b></td>
            <td class="num">${l.pay_type === 'monthly' ? `<span class="muted">${t('Salary')}</span>` : money(l.pay)}</td>
            <td class="muted">${t('Paid leave {pct}%', { pct: l.pct })}</td>
            <td class="acts"><button class="btn btn-ghost btn-icon btn-sm" data-goto="timeoff" aria-label="${t('Time off')}">${icons.plane}</button></td>
          </tr>`;
          const w = worked(s, d.now);
          const loc = s.in_lat != null ? ` <a href="https://maps.google.com/?q=${s.in_lat},${s.in_lng}" target="_blank" rel="noopener" title="${t('Clock-in location')}" style="color:var(--ink-3)">${icons.pin.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"')}</a>` : '';
          return `<tr>
            <td>${dateLabel(s.day)}</td>
            <td><span class="emp">${avatar(s)}${esc(s.name)}</span></td>
            <td class="tnum">${time(s.clock_in)}${loc}</td>
            <td class="tnum">${s.clock_out ? time(s.clock_out) : isForgotten(s) ? `<span class="tag warn">${t('CHECK · NO CLOCK-OUT')}</span>` : `<span class="tag live">${t('ON SHIFT')}</span>`}</td>
            <td class="num">${s.break_min ? s.break_min + 'm' : '—'}</td>
            <td class="num"><b>${s.clock_out ? dur(w) : `<span data-since="${s.clock_in}">${dur(w)}</span>`}</b></td>
            <td class="num">${s.pay_type === 'monthly' ? `<span class="muted">${t('Salary')}</span>` : money((w / 3600e3) * (s.hourly_rate || 0))}</td>
            <td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(s.note)}${s.edited ? `<span class="tag">${t('edited')}</span>` : ''}</td>
            <td class="acts"><button class="btn btn-ghost btn-icon btn-sm" data-edit="${s.id}" aria-label="${t('Edit shift')}">${icons.edit}</button></td>
          </tr>`;
        }).join('') : `<tr><td colspan="9"><div class="empty">${t('No shifts in {month}.', { month: monthName })}</div></td></tr>`}</tbody>
      </table></div>
    </div>`;
  $('#ts-month').onchange = async (e) => { if (!e.target.value) return; state.month = e.target.value; await refresh(); };
  $('#ts-emp').onchange = async (e) => { state.empFilter = e.target.value; await refresh(); };
  $('#ts-add').onclick = () => openShift();
  $('#page').querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openShift(shifts.find((s) => s.id === Number(b.dataset.edit)))));
}

// Shift dialog
function openShift(s, { forgot = false } = {}) {
  const dlg = $('#dlg-shift');
  $('#shift-title').textContent = forgot ? t('Add clock-out for {name}', { name: s.name }) : s ? t('Edit shift') : t('Add shift');
  $('#sh-emp').innerHTML = state.data.employees.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  $('#sh-emp').disabled = !!s;
  $('#sh-emp').value = s ? s.employee_id : state.empFilter || state.data.employees[0]?.id || '';
  $('#sh-date').value = s ? dayKey(s.clock_in) : state.data.today;
  $('#sh-in').value = s ? hm24(s.clock_in) : '09:00';
  $('#sh-out').value = s?.clock_out ? hm24(s.clock_out) : s ? '' : '17:00';
  $('#sh-break').value = s?.break_min || 0;
  $('#sh-note').value = s?.note || (forgot ? t('Forgot to clock out') : '');
  $('#sh-err').textContent = '';
  $('#sh-hint').textContent = forgot ? t('Clocked in {d} at {t}. Enter the time they really left.', { d: dateLabel(dayKey(s.clock_in)), t: time(s.clock_in) }) : '';
  $('#sh-del').classList.toggle('hidden', !s);
  $('#sh-del').onclick = async () => {
    if (!confirm(t('Delete this shift? This cannot be undone.'))) return;
    await api(`/api/admin/shifts/${s.id}`, { method: 'DELETE' });
    dlg.close(); toast(t('Shift deleted')); refresh();
  };
  $('#form-shift').onsubmit = async (ev) => {
    if (ev.submitter?.value !== 'save') return;
    ev.preventDefault();
    const body = { employee_id: Number($('#sh-emp').value), date: $('#sh-date').value, in: $('#sh-in').value, out: $('#sh-out').value, break_min: Number($('#sh-break').value) || 0, note: $('#sh-note').value };
    try {
      await api(s ? `/api/admin/shifts/${s.id}` : '/api/admin/shifts', { method: s ? 'PATCH' : 'POST', body });
      dlg.close(); toast(s ? t('Shift updated') : t('Shift added')); refresh();
    } catch (e) { $('#sh-err').textContent = e.message; }
  };
  if (!state.data.employees.length) return toast(t('Add a team member first'), true);
  dlg.showModal();
  if (forgot) $('#sh-out').focus();
}

// ---------- time off ----------
function renderTimeoff() {
  const d = state.data, all = state.leave, today = d.today;
  const pending = all.filter((r) => r.status === 'pending').sort((a, b) => a.start_date.localeCompare(b.start_date));
  const cancelReqs = all.filter((r) => r.status === 'approved' && r.cancel_requested).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const upcoming = all.filter((r) => r.status === 'approved' && r.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const history = all.filter((r) => !pending.includes(r) && !upcoming.includes(r));
  const ago = (ms) => dateLabel(dayKey(ms)) + ' ' + time(ms);
  $('#page').innerHTML = `
    <div class="page-head"><div><h1>${t('Time off')}</h1><p>${t('Requests from your team. Approve or decline — they get notified right away.')}</p></div>
      <div class="toolbar"><button class="btn btn-ghost" data-goto="history">${icons.plus} ${t('Add past leave')}</button></div></div>
    <div class="card notif-card" id="admin-notif" style="margin:0 0 18px"></div>
    ${cancelReqs.length ? `<div class="section-title">${t('Asked to cancel')} (${cancelReqs.length})</div>
    <div class="req-cards" style="margin-bottom:22px">${cancelReqs.map((r) => `
      <div class="card req req-cancel">
        <div class="req-top">${avatar(r)}<div><div class="nm">${esc(r.name)}</div><div class="s">${t('Asked {when}', { when: ago(r.cancel_requested_at) })}</div></div>
          <span class="pill st-cancelled" style="margin-left:auto"><span class="dot"></span>${t('Cancel request')}</span></div>
        <div class="when">${leaveLabel(r.type)} · ${leaveRange(r)}</div>
        ${r.cancel_reason ? `<div class="why">“${esc(r.cancel_reason)}”</div>` : ''}
        <input class="input" data-creply="${r.id}" maxlength="300" placeholder="${t('Reply (optional)')}">
        <div class="acts">
          <button class="btn btn-ghost" data-keep="${r.id}">${t('Keep the leave')}</button>
          <button class="btn btn-danger" data-revoke="${r.id}" data-from="req">${icons.x} ${t('Revoke leave')}</button>
        </div>
      </div>`).join('')}</div>` : ''}
    <div class="section-title">${t('Waiting for you')} (${pending.length})</div>
    <div class="req-cards">${pending.length ? pending.map((r) => `
      <div class="card req">
        <div class="req-top">${avatar(r)}<div><div class="nm">${esc(r.name)}</div><div class="s">${t('Asked {when}', { when: ago(r.created_at) })}</div></div>
          <span class="pill st-pending" style="margin-left:auto"><span class="dot"></span>${leaveLabel(r.type)}</span></div>
        <div class="when">${leaveRange(r)}</div>
        ${r.note ? `<div class="why">“${esc(r.note)}”</div>` : ''}
        <input class="input" data-reply="${r.id}" maxlength="300" placeholder="${t('Reply (optional)')}">
        <div class="acts">
          <button class="btn btn-danger" data-decide="rejected" data-id="${r.id}">${icons.x} ${t('Decline')}</button>
          <button class="btn btn-approve" data-decide="approved" data-id="${r.id}">${icons.check} ${t('Approve')}</button>
        </div>
      </div>`).join('') : `<div class="card empty" style="grid-column:1/-1">${t('No requests waiting. 🎉')}</div>`}</div>
    <div class="section-title" style="margin-top:28px">${t('Leave balances')}</div>
    ${balanceTable(state.balances || [])}
    <div class="section-title" style="margin-top:28px">${t('Coming up')}</div>
    ${leaveTable(upcoming, t('No approved time off coming up.'))}
    <div class="section-title" style="margin-top:28px">${t('History')}</div>
    ${leaveTable(history, t('Nothing yet.'))}`;
  $('#page').querySelectorAll('[data-decide]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.id, status = b.dataset.decide;
    const note = $(`[data-reply="${id}"]`).value;
    b.disabled = true;
    try {
      await api(`/api/admin/leave/${id}`, { method: 'POST', body: { status, manager_note: note } });
      toast(status === 'approved' ? t('Approved — {name} will be notified', { name: all.find((r) => String(r.id) === id).name }) : t('Declined — {name} will be notified', { name: all.find((r) => String(r.id) === id).name }));
      refresh();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  $('#page').querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = async () => {
    const r = all.find((x) => String(x.id) === b.dataset.revoke);
    let note = b.dataset.from === 'req' ? $(`[data-creply="${r.id}"]`).value : '';
    if (b.dataset.from !== 'req') { note = prompt(t('Revoke {name}\'s {type} ({dates})? The days go back to their balance and {name} is notified. Optional message:', { name: r.name, type: leaveLabel(r.type), dates: leaveRange(r) }), ''); if (note === null) return; }
    else if (!confirm(t('Revoke {name}\'s {type} ({dates})? The days go back to their balance and {name} is notified.', { name: r.name, type: leaveLabel(r.type), dates: leaveRange(r) }))) return;
    b.disabled = true;
    try { await api(`/api/admin/leave/${r.id}/revoke`, { method: 'POST', body: { manager_note: note } }); toast(t('Leave revoked — {name} will be notified', { name: r.name })); refresh(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  $('#page').querySelectorAll('[data-keep]').forEach((b) => (b.onclick = async () => {
    const r = all.find((x) => String(x.id) === b.dataset.keep);
    b.disabled = true;
    try { await api(`/api/admin/leave/${r.id}/keep`, { method: 'POST', body: { manager_note: $(`[data-creply="${r.id}"]`).value } }); toast(t('Leave kept — {name} will be notified', { name: r.name })); refresh(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  $('#page').querySelectorAll('[data-setstart]').forEach((b) => (b.onclick = () => openEmp(d.employees.find((e) => e.id === Number(b.dataset.setstart)), { focus: 'em-start' })));
  $('#page').querySelectorAll('[data-bal]').forEach((x) => (x.onclick = () => openBalance(state.balances.find((b) => b.employee_id === Number(x.dataset.bal)))));
  $('#page').querySelectorAll('[data-comppay]').forEach((x) => (x.onclick = async () => {
    const b = state.balances.find((y) => y.employee_id === Number(x.dataset.comppay));
    const month = prompt(t('{name}: {h} h of 補休 expired unused. By law they are paid at the overtime rate ({pay}). Add to which payroll month? (YYYY-MM)', { name: b.name, h: b.comp.balance.expired_unpaid.hours, pay: money(b.comp.balance.expired_unpaid.amount) }), d.today.slice(0, 7));
    if (!month) return;
    try { await api(`/api/admin/comp/${b.employee_id}/payout`, { method: 'POST', body: { month } }); toast(t('Added to the {month} payroll', { month })); refresh(); }
    catch (e) { toast(e.message, true); }
  }));
  renderAdminNotif();
}
// Seniority like "3 y 5 m" from a start date to today
function seniority(start, today) {
  if (!start || start > today) return '';
  const [y1, m1, d1] = start.split('-').map(Number), [y2, m2, d2] = today.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  const y = Math.floor(months / 12), m = months % 12;
  return t('{y} y {m} m', { y, m });
}
const d1 = (x) => (Math.round(x * 10) / 10).toLocaleString();
function annualBar(a) {
  const pctUsed = a.earned ? Math.min(100, (a.used / a.earned) * 100) : 0;
  const pctPend = a.earned ? Math.min(100 - pctUsed, (a.pending / a.earned) * 100) : 0;
  return `<div class="bal-bar" role="img" aria-label="${t('{used} of {earned} days used', { used: d1(a.used), earned: d1(a.earned) })}"><i style="width:${pctUsed}%"></i><i class="pend" style="width:${pctPend}%"></i></div>`;
}
function compCell(b) {
  const c = b.comp;
  if (!c || (!c.balance && c.status === 'off')) return '<span class="muted">—</span>';
  if (!c.balance) return `<span class="muted">${c.status === 'proposed' ? t('waiting for agreement') : c.status === 'declined' ? t('declined') : '—'}</span>`;
  const x = c.balance;
  return `<b>${t('{n} h', { n: x.available })}</b>${x.pending ? `<span class="sub">${t('{n} h pending', { n: x.pending })}</span>` : ''}
    ${x.expiring_soon ? `<span class="sub" style="color:var(--clay)">${t('{n} h expire within a month', { n: x.expiring_soon })}</span>` : ''}
    ${x.expired_unpaid.hours > 0 ? `<button class="btn btn-sm btn-warn" data-comppay="${b.employee_id}">⚠ ${t('Pay {h} h ({pay})', { h: x.expired_unpaid.hours, pay: money(x.expired_unpaid.amount) })}</button>` : ''}
    ${c.status !== 'active' ? `<span class="sub">${t('off')}</span>` : ''}`;
}
function prevCell(b) {
  const p = b.previous;
  if (!p) return '<span class="muted">—</span>';
  const dcs = p.decision;
  if (dcs) return `<span class="muted">${dcs.action === 'carry' ? t('Carried over {n}', { n: d1(dcs.days) }) : dcs.action === 'payout' ? t('Paid out {n} ({month})', { n: d1(dcs.days), month: dcs.payout_month }) : t('Closed')}</span>`;
  if (p.needs_decision) return `<button class="btn btn-sm btn-warn" data-bal="${b.employee_id}">⚠ ${t('{n} unused — settle', { n: d1(p.unused) })}</button>`;
  return `<span class="muted">${t('All used')}</span>`;
}
function openBalance(b) {
  const a = b.annual, p = b.previous;
  const fmt = (x) => dateLabel(x, { year: 'numeric', month: 'short', day: 'numeric' });
  $('#bal-title').textContent = t('特休 · {name}', { name: b.name });
  const line = (k, v, cls = '') => `<div class="bl ${cls}"><span>${k}</span><b>${v}</b></div>`;
  $('#bal-body').innerHTML = `
    <p class="muted" style="margin:0 0 10px;font-size:13px">${b.leave_system === 'calendar' ? t('Calendar year') : t('Anniversary year')} · ${fmt(a.from)} – ${fmt(a.to)}${b.ratio < 1 ? ' · ' + t('part-time {pct}%', { pct: Math.round(b.ratio * 100) }) : ''}</p>
    <div class="bal-lines">
      ${line(t('Earned this year'), d1(a.earned))}
      ${a.carried ? line(t('Carried over from last year'), '+' + d1(a.carried)) : ''}
      ${a.adjustments.map((x) => `<div class="bl"><span>${t('Adjustment')}${x.note ? ': ' + esc(x.note) : ''} <button class="btn btn-ghost btn-sm" data-deladj="${x.id}" aria-label="${t('Delete')}">${icons.x}</button></span><b>${x.days > 0 ? '+' : ''}${d1(x.days)}</b></div>`).join('')}
      ${line(t('Used'), '−' + d1(a.used))}
      ${line(t('Remaining'), d1(a.remaining) + ' ' + t('days'), 'total')}
      ${a.pending ? `<div class="muted" style="font-size:12.5px">${t('{n} more days are waiting for approval.', { n: d1(a.pending) })}</div>` : ''}
    </div>
    <form class="adj-form" id="adj-form">
      <div class="field"><label for="adj-days">${t('Adjust (days, + or −)')}</label><input class="input" type="number" step="0.5" min="-60" max="60" id="adj-days" required></div>
      <div class="field"><label for="adj-note">${t('Reason')}</label><input class="input" id="adj-note" maxlength="120" placeholder="${t('e.g. opening balance')}"></div>
      <button class="btn btn-ghost btn-sm">${icons.plus} ${t('Add')}</button>
    </form>
    ${p ? `<div class="prev-year">
      <h4>${t('Last year')} · ${fmt(p.from)} – ${fmt(p.to)}</h4>
      <div class="bal-lines">${line(t('Earned'), d1(p.earned + p.carried + p.adjusted))}${line(t('Used'), '−' + d1(p.used))}${line(t('Unused'), d1(p.unused) + ' ' + t('days'), 'total')}</div>
      ${p.decision ? `<div class="settled"><span>${p.decision.action === 'carry' ? t('Carried over {n} days into this year.', { n: d1(p.decision.days) }) : p.decision.action === 'payout' ? t('Paid out {n} days in the {month} payroll.', { n: d1(p.decision.days), month: p.decision.payout_month }) : t('Closed without carry-over or pay-out.')}</span>
          <button class="btn btn-ghost btn-sm" id="settle-undo">${t('Undo')}</button></div>`
        : p.unused > 0 ? `<p class="muted" style="font-size:12.5px;margin:6px 0">${t('By law, unused 特休 must be paid out at the end of the year, or carried over to the next year if you both agree (and paid out if still unused then).')}</p>
        <div class="row-2"><div class="field"><label for="st-days">${t('Days')}</label><input class="input" type="number" step="0.5" min="0.5" max="${p.unused}" id="st-days" value="${p.unused}"></div>
          <div class="field"><label for="st-month">${t('Pay-out month')}</label><input class="input" type="month" id="st-month" value="${state.data.today.slice(0, 7)}"></div></div>
        <div class="settle-acts">
          <button class="btn btn-primary btn-sm" data-settle="carry">${t('Carry over')}</button>
          <button class="btn btn-approve btn-sm" data-settle="payout">${t('Pay out')}</button>
          <button class="btn btn-ghost btn-sm" data-settle="none">${t('Close year')}</button>
        </div>` : `<p class="muted" style="font-size:12.5px">${t('All days were used.')}</p>`}
    </div>` : ''}`;
  const reload = async () => { state.balances = (await api('/api/admin/balances')).balances; render(); const nb = state.balances.find((x) => x.employee_id === b.employee_id); if (nb && $('#dlg-bal').open) openBalance(nb); };
  $('#adj-form').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api(`/api/admin/balances/${b.employee_id}/adjust`, { method: 'POST', body: { days: Number($('#adj-days').value), note: $('#adj-note').value } }); toast(t('Saved')); reload(); }
    catch (e) { toast(e.message, true); }
  };
  $('#bal-body').querySelectorAll('[data-deladj]').forEach((x) => (x.onclick = async () => { await api(`/api/admin/balances/${b.employee_id}/adjust/${x.dataset.deladj}`, { method: 'DELETE' }); reload(); }));
  $('#bal-body').querySelectorAll('[data-settle]').forEach((x) => (x.onclick = async () => {
    const action = x.dataset.settle;
    try {
      await api(`/api/admin/balances/${b.employee_id}/settle`, { method: 'POST', body: { action, days: Number($('#st-days')?.value), month: $('#st-month')?.value } });
      toast(action === 'payout' ? t('Added to the {month} payroll', { month: $('#st-month').value }) : t('Saved')); reload();
    } catch (e) { toast(e.message, true); }
  }));
  const undo = $('#settle-undo');
  if (undo) undo.onclick = async () => { try { await api(`/api/admin/balances/${b.employee_id}/settle/${p.from}`, { method: 'DELETE' }); reload(); } catch (e) { toast(e.message, true); } };
  $('#bal-close').onclick = () => $('#dlg-bal').close();
  if (!$('#dlg-bal').open) $('#dlg-bal').showModal();
}
function balanceTable(rows) {
  const today = state.data.today;
  if (!rows.length) return `<div class="card empty">${t('No team members yet.')}</div>`;
  return `<div class="card panel" style="padding:6px"><div class="table-wrap"><table class="tbl bal-table">
    <thead><tr><th>${t('Employee')}</th><th>${t('Seniority')}</th><th>${t('Annual leave (特休)')}</th><th class="num">${t('Left')}</th><th>${t('Next grant')}</th><th>${t('Last year')}</th><th>補休</th><th class="num">${t('Sick')}</th><th class="num">${t('Personal')}</th><th></th></tr></thead>
    <tbody>${rows.map((b) => {
      const a = b.annual || {};
      const active = a.status === 'active';
      const soon = active && a.remaining > 0 && Date.parse(a.to) - Date.parse(today) < 60 * 86400e3;
      return `<tr>
        <td><span class="emp">${avatar(b)}<span>${esc(b.name)}${b.ratio < 1 ? `<span class="sub">${t('part-time {pct}%', { pct: Math.round(b.ratio * 100) })}</span>` : ''}</span></span></td>
        <td>${b.start_date ? `${seniority(b.start_date, today)}<span class="sub">${t('since {date}', { date: dateLabel(b.start_date, { year: 'numeric', month: 'short', day: 'numeric' }) })}</span>` : `<button class="btn btn-ghost btn-sm" data-setstart="${b.employee_id}">${t('Set start date')}</button>`}</td>
        <td style="min-width:170px">${active ? `<span class="sub" style="margin-bottom:2px">${b.leave_system === 'calendar' ? t('Calendar year') : t('Anniversary year')}</span>${annualBar(a)}<span class="sub">${t('{used} used · {pending} pending · {earned} earned', { used: d1(a.used), pending: d1(a.pending), earned: d1(a.earned) })}</span>
          <span class="sub" ${soon ? 'style="color:var(--clay);font-weight:600"' : ''}>${t('use by {date}', { date: dateLabel(a.to, { year: 'numeric', month: 'short', day: 'numeric' }) })}${soon ? ' · ' + t('Unused days must be paid or carried over') : ''}</span>`
          : a.status === 'waiting' ? `<span class="muted">${t('Earns {n} days on {date}', { n: d1(a.next.days), date: dateLabel(a.next.date) })}</span>` : '<span class="muted">—</span>'}</td>
        <td class="num">${active ? `<b style="font-size:16px">${d1(a.remaining)}</b> <span class="muted">${t('days')}</span>${a.carried || a.adjusted ? `<span class="sub">${[a.carried ? t('+{n} carried', { n: d1(a.carried) }) : '', a.adjusted ? t('{n} adjusted', { n: (a.adjusted > 0 ? '+' : '') + d1(a.adjusted) }) : ''].filter(Boolean).join(' · ')}</span>` : ''}` : '—'}</td>
        <td>${a.next ? `${t('+{n} days', { n: d1(a.next.days) })}<span class="sub">${dateLabel(a.next.date, { year: 'numeric', month: 'short', day: 'numeric' })}</span>` : '—'}</td>
        <td>${prevCell(b)}</td>
        <td>${compCell(b)}</td>
        <td class="num">${d1(b.sick.used)}<span class="sub">/ ${b.sick.limit}</span></td>
        <td class="num">${d1(b.personal.used)}<span class="sub">/ ${b.personal.limit}</span></td>
        <td>${active ? `<button class="btn btn-ghost btn-sm" data-bal="${b.employee_id}">${t('Manage')}</button>` : ''}</td>
      </tr>`;
    }).join('')}</tbody></table></div></div>
    <p class="muted" style="font-size:12.5px;margin-top:10px">${t('特休 follows the Labor Standards Act art. 38 by seniority (6 months: 3 days, 1 year: 7, 2: 10, 3: 14, 5: 15, then +1 per year from 10 up to 30), per anniversary year. Part-time staff get a share by weekly hours (40 h = 100%). Sick and personal leave count this calendar year against the legal limits.')}</p>`;
}
function leaveTable(rows, empty) {
  if (!rows.length) return `<div class="card empty">${empty}</div>`;
  return `<div class="card panel" style="padding:6px"><div class="table-wrap"><table class="tbl">
    <thead><tr><th>${t('Employee')}</th><th>${t('Type')}</th><th>${t('Dates')}</th><th>${t('Status')}</th><th>${t('Note')}</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><span class="emp">${avatar(r)}${esc(r.name)}</span></td><td>${leaveLabel(r.type)}</td><td>${leaveRange(r)}</td><td>${statusPill(r.revoked ? 'revoked' : r.status)}${r.cancel_requested ? `<span class="sub" style="display:block;font-size:11.5px;color:var(--clay)">${t('asked to cancel')}</span>` : ''}</td>
      <td class="muted" style="white-space:normal;min-width:160px">${esc(r.note)}${r.manager_note ? `<br><b>${t('Reply')}:</b> ${esc(r.manager_note)}` : ''}</td>
      <td>${r.status === 'approved' ? `<button class="btn btn-ghost btn-sm" data-revoke="${r.id}">${t('Revoke')}</button>` : ''}</td></tr>`).join('')}</tbody>
  </table></div></div>`;
}
async function renderAdminNotif() {
  const card = $('#admin-notif');
  if (!card) return;
  const st = await pushStatus().catch(() => 'unsupported');
  card.innerHTML = st === 'on'
    ? `${icons.bell}<span>${t('Notifications are on for this device.')}</span><button class="btn btn-ghost btn-sm" id="notif-test">${t('Send a test')}</button>`
    : st === 'install'
    ? `${icons.bell}<span>${t('On iPhone: tap Share → Add to Home Screen, open the dashboard from there, then turn on notifications.')}</span>`
    : st === 'denied'
    ? `${icons.bell}<span>${t('Notifications are blocked. Allow them in your phone settings.')}</span>`
    : st === 'unsupported'
    ? `${icons.bell}<span>${t('This browser cannot show notifications. Check this page for new requests.')}</span>`
    : `${icons.bell}<span>${t('Get a notification on this device when someone asks for time off.')}</span><button class="btn btn-primary btn-sm" id="notif-on">${t('Turn on')}</button>`;
  const on = $('#notif-on');
  if (on) on.onclick = async () => {
    try { await enablePush('admin'); toast(t('Notifications are on')); }
    catch (e) { toast(e.message, true); }
    renderAdminNotif();
  };
  const test = $('#notif-test');
  if (test) test.onclick = () => api('/api/push/test?role=admin', { method: 'POST', body: {} }).then(() => toast(t('Test sent')), (e) => toast(e.message, true));
}

// ---------- payroll ----------
// 2026-11-02 was a Monday; used only to get localized weekday names.
const weekdayShort = (d) => dateLabel(`2026-11-0${d === 0 ? 8 : d + 1}`, { weekday: 'short' });
function workDaysLabel(wd) {
  const set = String(wd ?? '1,2,3,4,5').split(',').filter(Boolean).map(Number);
  if (!set.length) return t('No fixed days');
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => set.includes(d)).map(weekdayShort).join(' ');
}
const hrsLabel = (h) => (Math.round(h * 10) / 10).toLocaleString() + ' ' + t('h');

function renderPayroll() {
  const pr = state.payroll, d = state.data;
  if (!pr) return;
  const monthName = dateLabel(`${state.month}-01`, { month: 'long', year: 'numeric' });
  const paid = pr.rows.filter((r) => r.status === 'paid').length;
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>${t('Payroll')}</h1><p>${t('{month} · {paid} of {n} paid', { month: monthName, paid, n: pr.rows.length })}</p></div>
      <div class="toolbar">
        <input class="input" type="month" id="pr-month" value="${state.month}" aria-label="${t('Month')}">
        <a class="btn btn-ghost" href="/api/admin/payroll.csv?month=${state.month}&lang=${isZh() ? 'zh' : 'en'}">${icons.download} ${t('Export CSV')}</a>
      </div>
    </div>
    <div class="kpis" style="margin-bottom:14px">
      <div class="card kpi hero"><div class="k">${icons.coins} ${t('Total gross pay')}</div><div class="v">${money(pr.totals.gross)}</div><div class="h">${t('{n} people', { n: pr.rows.length })}</div></div>
      <div class="card kpi"><div class="k">${icons.check} ${t('Net to pay')}</div><div class="v">${money(pr.totals.net)}</div><div class="h">${t('after deductions')}</div></div>
      <div class="card kpi"><div class="k">${icons.clock} ${t('Hours worked')}</div><div class="v">${Math.round(pr.totals.hours)}<small>${t('h')}</small></div><div class="h">${t('{h} h overtime', { h: Math.round(pr.totals.overtime * 10) / 10 })}</div></div>
      <div class="card kpi"><div class="k">${icons.alert} ${t('Deductions')}</div><div class="v">${money(pr.totals.deductions)}</div><div class="h">${t('leave, insurance, other')}</div></div>
    </div>
    <div class="card panel" style="padding:6px">
      <div class="table-wrap"><table class="tbl pay-table">
        <thead><tr><th>${t('Employee')}</th><th class="num">${t('Hours')}</th><th class="num">${t('Overtime')}</th><th class="num">${t('Base')}</th><th class="num">${t('Extras')}</th><th class="num">${t('Deductions')}</th><th class="num">${t('Net')}</th><th></th></tr></thead>
        <tbody>${pr.rows.length ? pr.rows.map((r) => {
          const extras = r.earnings.overtime + r.earnings.leave + (r.earnings.holiday || 0) + (r.earnings.holiday_work || 0) + (r.earnings.leave_payout || 0) + (r.earnings.comp_payout || 0) + r.earnings.bonus;
          const warn = [
            r.open_shifts ? t('{n} shift(s) without clock-out', { n: r.open_shifts }) : '',
            r.missing_days.length ? t('{n} work day(s) with no punches', { n: r.missing_days.length }) : '',
            r.changed_since_paid ? t('Hours or rates changed after payment') : '',
          ].filter(Boolean);
          return `<tr>
            <td><span class="emp">${avatar(r)}<span>${esc(r.name)}<span class="sub"><span class="tag ${r.pay_type}">${r.pay_type === 'monthly' ? t('Monthly') : t('Hourly')}</span> ${r.pay_type === 'monthly' ? money(r.salary) : money(r.rate) + '/' + t('h')}</span></span></span>
              ${warn.map((w) => `<span class="warn-line">⚠ ${w}</span>`).join('')}</td>
            <td class="num">${hrsLabel(r.hours.worked)}<span class="sub">${t('{n} days', { n: r.days_worked })}</span></td>
            <td class="num">${r.hours.ot1 + r.hours.ot2 ? hrsLabel(r.hours.ot1 + r.hours.ot2) : '—'}${r.hours.comp ? `<span class="sub">${t('→ 補休 {h}', { h: hrsLabel(r.hours.comp) })}</span>` : ''}</td>
            <td class="num">${money(r.earnings.base)}</td>
            <td class="num">${extras ? '+' + money(extras) : '—'}${(r.earnings.holiday || 0) + (r.earnings.holiday_work || 0) ? `<span class="sub">${t('holiday')} ${money((r.earnings.holiday || 0) + (r.earnings.holiday_work || 0))}</span>` : ''}${r.earnings.leave_payout ? `<span class="sub">${t('unused 特休')} ${money(r.earnings.leave_payout)}</span>` : ''}${r.earnings.comp_payout ? `<span class="sub">${t('unused 補休')} ${money(r.earnings.comp_payout)}</span>` : ''}${r.earnings.bonus ? `<span class="sub">${t('bonus')} ${money(r.earnings.bonus)}</span>` : ''}</td>
            <td class="num">${r.total_deductions ? '−' + money(r.total_deductions) : '—'}</td>
            <td class="num"><b>${money(r.net)}</b><span class="sub">${r.status === 'paid' ? `<span class="tag paid">${t('Paid')}</span> ${dateLabel(dayKey(r.paid_at), { month: 'numeric', day: 'numeric' })}` : `<span class="tag draft">${t('Draft')}</span>`}</span></td>
            <td><div class="acts">
              <a class="btn btn-ghost btn-icon btn-sm" href="/payslip?month=${state.month}&emp=${r.employee_id}" target="_blank" rel="noopener" title="${t('Payslip')}" aria-label="${t('Payslip')}">${icons.sheet}</a>
              ${r.status === 'paid'
                ? `<button class="btn btn-ghost btn-sm" data-reopen="${r.employee_id}">${t('Reopen')}</button>`
                : `<button class="btn btn-ghost btn-sm" data-adjust="${r.employee_id}">${t('Adjust')}</button><button class="btn btn-primary btn-sm" data-paid="${r.employee_id}">${t('Mark paid')}</button>`}
            </div></td>
          </tr>`;
        }).join('') : `<tr><td colspan="9"><div class="empty">${t('No one to pay for {month}.', { month: monthName })}</div></td></tr>`}</tbody>
        ${pr.rows.length ? `<tfoot><tr><td>${t('Total')}</td><td class="num">${hrsLabel(pr.totals.hours)}</td><td class="num">${hrsLabel(pr.totals.overtime)}</td><td></td><td></td><td class="num">−${money(pr.totals.deductions)}</td><td class="num">${money(pr.totals.net)}</td><td></td></tr></tfoot>` : ''}
      </table></div>
    </div>
    <p class="muted" style="font-size:12.5px;margin-top:12px">${t('Overtime: hours beyond each person\'s daily hours (and all hours on a non-work day for monthly staff) are paid ×{r1} for the first {tier} h, then ×{r2}. Monthly staff\'s hourly value is salary ÷ {div}. Change these in Settings.', { r1: pr.cfg.ot_rate1, tier: pr.cfg.ot_tier, r2: pr.cfg.ot_rate2, div: pr.cfg.divisor })}</p>`;
  $('#pr-month').onchange = (e) => { if (e.target.value) { state.month = e.target.value; refresh(); } };
  $('#page').querySelectorAll('[data-adjust]').forEach((b) => (b.onclick = () => openPay(pr.rows.find((r) => r.employee_id === Number(b.dataset.adjust)))));
  $('#page').querySelectorAll('[data-paid]').forEach((b) => (b.onclick = async () => {
    const r = pr.rows.find((x) => x.employee_id === Number(b.dataset.paid));
    if (!confirm(t('Mark {name} as paid {net} for {month}? The payslip is then locked and {name} can see it in the app.', { name: r.name, net: money(r.net), month: monthName }))) return;
    try { await api(`/api/admin/payroll/${state.month}/${r.employee_id}/paid`, { method: 'POST' }); toast(t('{name} marked as paid', { name: r.name })); refresh(); }
    catch (e) { toast(e.message, true); }
  }));
  $('#page').querySelectorAll('[data-reopen]').forEach((b) => (b.onclick = async () => {
    if (!confirm(t('Reopen this payslip? It will be recalculated with the current hours and rates, and hidden from the employee until you mark it paid again.'))) return;
    try { await api(`/api/admin/payroll/${state.month}/${b.dataset.reopen}/reopen`, { method: 'POST' }); refresh(); }
    catch (e) { toast(e.message, true); }
  }));
}
function openPay(r) {
  $('#pay-title').textContent = t('Adjust pay for {name}', { name: r.name });
  $('#pay-hint').textContent = dateLabel(`${state.month}-01`, { month: 'long', year: 'numeric' });
  $('#pa-bonus').value = r.earnings.bonus || '';
  $('#pa-ins').value = r.deductions.insurance;
  $('#pa-ded').value = r.deductions.other || '';
  $('#pa-dednote').value = r.deductions.other_note || '';
  $('#pa-note').value = r.note || '';
  $('#pa-err').textContent = '';
  $('#form-pay').onsubmit = async (ev) => {
    if (ev.submitter?.value !== 'save') return;
    ev.preventDefault();
    try {
      await api(`/api/admin/payroll/${state.month}/${r.employee_id}`, { method: 'POST', body: { bonus: $('#pa-bonus').value, insurance: $('#pa-ins').value, deduction: $('#pa-ded').value, deduction_note: $('#pa-dednote').value, note: $('#pa-note').value } });
      $('#dlg-pay').close(); toast(t('Saved')); refresh();
    } catch (e) { $('#pa-err').textContent = e.message; }
  };
  $('#dlg-pay').showModal();
}

// ---------- holidays (in Settings) ----------
async function renderHolidays(year) {
  state.holYear = year;
  const card = $('#hol-card');
  if (!card) return;
  let list = [];
  try { list = (await api(`/api/admin/holidays?year=${year}`)).holidays; } catch (e) { toast(e.message, true); }
  card.innerHTML = `
    <div class="hol-head"><h2>${t('National holidays')}</h2>
      <div class="toolbar"><button class="btn btn-ghost btn-sm" data-y="${year - 1}" aria-label="${year - 1}">‹</button><b>${year}</b><button class="btn btn-ghost btn-sm" data-y="${year + 1}" aria-label="${year + 1}">›</button></div></div>
    <p>${t('Paid days off used by payroll. The official Taiwan calendar is pre-loaded; add company days off or remove dates.')}</p>
    <div class="hol-list">${list.length ? list.map((h) => `
      <div class="hol-row"><span class="d">${dateLabel(h.date, { month: 'short', day: 'numeric', weekday: 'short' })}</span>
        <span class="n">${esc(holidayName(h))}${h.source === 'custom' ? ` <span class="tag">${t('custom')}</span>` : ''}</span>
        <button class="btn btn-ghost btn-icon btn-sm" data-del="${h.date}" aria-label="${t('Delete')}">${icons.x}</button></div>`).join('')
      : `<div class="empty">${t('No holidays for {year} yet.', { year })}</div>`}</div>
    <form class="hol-add" id="hol-add">
      <input class="input" type="date" id="ho-date" min="${year}-01-01" max="${year}-12-31" required aria-label="${t('Date')}">
      <input class="input" id="ho-zh" placeholder="${t('Name (中文)')}" maxlength="40" required>
      <input class="input" id="ho-en" placeholder="${t('Name (English)')}" maxlength="60">
      <button class="btn btn-primary btn-sm">${icons.plus} ${t('Add')}</button>
    </form>
    <button class="btn btn-ghost btn-sm" id="hol-restore" style="justify-self:start">${t('Restore official {year} holidays', { year })}</button>`;
  card.querySelectorAll('[data-y]').forEach((b) => (b.onclick = () => renderHolidays(Number(b.dataset.y))));
  card.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm(t('Remove {date} from the holidays?', { date: dateLabel(b.dataset.del) }))) return;
    await api(`/api/admin/holidays/${b.dataset.del}`, { method: 'DELETE' }).catch((e) => toast(e.message, true));
    renderHolidays(year);
  }));
  $('#hol-add').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('/api/admin/holidays', { method: 'POST', body: { date: $('#ho-date').value, name_zh: $('#ho-zh').value, name_en: $('#ho-en').value } }); toast(t('Holiday added')); renderHolidays(year); }
    catch (e) { toast(e.message, true); }
  };
  $('#hol-restore').onclick = async () => { await api('/api/admin/holidays/restore', { method: 'POST', body: { year } }); toast(t('Official holidays restored')); renderHolidays(year); };
}

// ---------- history & import ----------
function empOptions(sel = '') {
  return state.data.employees.map((e) => `<option value="${e.id}" ${String(e.id) === String(sel) ? 'selected' : ''}>${esc(e.name)}${e.active ? '' : ' (' + t('inactive') + ')'}</option>`).join('');
}
let importState = null;
// Row errors from the CSV reader carry the bad value in quotes, e.g. Bad date "2025/10/32"
function importError(msg) {
  const m = String(msg).match(/^(Unknown employee|Bad date|Bad clock-in time|Bad clock-out time) "(.*)"$/);
  return m ? t(`${m[1]} "{v}"`, { v: m[2] }) : t(msg);
}
function renderHistory() {
  const d = state.data;
  const first = d.employees.find((e) => e.pay_type === 'monthly') || d.employees[0];
  const yesterday = new Date(Date.parse(d.today + 'T00:00:00Z') - 86400e3).toISOString().slice(0, 10);
  $('#page').innerHTML = `
    <div class="page-head"><div><h1>${t('History & import')}</h1><p>${t('Fill in the past for people who never punched in, add leave they took, or import shifts from another system.')}</p></div>
      <div class="toolbar"><button class="btn btn-ghost" data-goto="timesheets">← ${t('Timesheets')}</button></div></div>
    <div class="hist-grid">
      <form class="card hist-card" id="bf-form">
        <h2>1 · ${t('Fill standard schedule')}</h2>
        <p>${t('Creates a shift on every scheduled work day in the period, skipping days off, national holidays, approved leave and days that already have a shift.')}</p>
        <div class="field"><label for="bf-emp">${t('Employee')}</label><select class="input" id="bf-emp">${empOptions(first?.id)}</select></div>
        <div class="row-2">
          <div class="field"><label for="bf-from">${t('From')}</label><input class="input" type="date" id="bf-from" required></div>
          <div class="field"><label for="bf-to">${t('To')}</label><input class="input" type="date" id="bf-to" max="${d.today}" value="${yesterday}" required></div>
        </div>
        <div class="row-3">
          <div class="field"><label for="bf-in">${t('Clock in')}</label><input class="input" type="time" id="bf-in" value="09:00" required></div>
          <div class="field"><label for="bf-out">${t('Clock out')}</label><input class="input" type="time" id="bf-out" value="18:00" required></div>
          <div class="field"><label for="bf-break">${t('Break (min)')}</label><input class="input" type="number" min="0" step="5" id="bf-break" value="60"></div>
        </div>
        <p class="muted" id="bf-days" style="margin:0;font-size:12.5px"></p>
        <div class="hist-result" id="bf-result"></div>
        <div class="settle-acts"><button class="btn btn-ghost" value="preview">${t('Preview')}</button><button class="btn btn-primary hidden" id="bf-go" value="create"></button></div>
      </form>

      <form class="card hist-card" id="pl-form">
        <h2>2 · ${t('Add past leave')}</h2>
        <p>${t('Record leave someone already took. It is saved as approved and counts in leave balances and payroll.')}</p>
        <div class="field"><label for="pl-emp">${t('Employee')}</label><select class="input" id="pl-emp">${empOptions(first?.id)}</select></div>
        <div class="field"><label>${t('Type')}</label><select class="input" id="pl-type">${['annual', 'sick', 'personal', 'other', 'comp'].map((k) => `<option value="${k}">${leaveLabel(k)}</option>`).join('')}</select></div>
        <div class="field hidden" id="pl-hours-wrap"><label for="pl-hours">${t('Hours')}</label><input class="input" type="number" min="0.5" step="0.5" id="pl-hours" value="1" style="max-width:120px"></div>
        <div class="row-2">
          <div class="field"><label for="pl-from">${t('From')}</label><input class="input" type="date" id="pl-from" required></div>
          <div class="field"><label for="pl-to">${t('To')}</label><input class="input" type="date" id="pl-to" required></div>
        </div>
        <label class="check"><input type="checkbox" id="pl-half"> ${t('Half day only')}</label>
        <div class="field"><label for="pl-note">${t('Note')}</label><input class="input" id="pl-note" maxlength="300"></div>
        <button class="btn btn-primary" style="justify-self:start">${icons.plus} ${t('Add leave')}</button>
        <p class="muted" style="margin:0;font-size:12.5px">${t('Tip: add past leave before filling the schedule, so those days are skipped.')}</p>
      </form>

      <div class="card hist-card hist-wide">
        <h2>3 · ${t('Import from another system (CSV)')}</h2>
        <p>${t('Export your old records from Excel, Google Sheets or the old app as CSV. Recognised columns (English or Chinese): Employee, Date, Clock in, Clock out, Break, Hours, Note. Rows like TOTAL are ignored.')}</p>
        <div class="row-3">
          <div class="field"><label for="im-file">${t('CSV file')}</label><input class="input" type="file" id="im-file" accept=".csv,text/csv,text/plain"></div>
          <div class="field"><label for="im-emp">${t('Employee (if the file has no employee column)')}</label><select class="input" id="im-emp"><option value="">—</option>${empOptions()}</select></div>
          <div class="field"><label for="im-break">${t('Break column is in')}</label><select class="input" id="im-break"><option value="min">${t('minutes')}</option><option value="h">${t('hours')}</option></select></div>
        </div>
        <a class="muted" style="font-size:12.5px" download="parsley-import-example.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}">${icons.download.replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')} ${t('Download an example file')}</a>
        <div id="im-preview"></div>
      </div>
    </div>`;

  // 1. standard schedule
  const empById = (id) => d.employees.find((e) => e.id === Number(id));
  const syncBf = () => {
    const e = empById($('#bf-emp').value);
    if (e?.start_date && !$('#bf-from').dataset.touched) $('#bf-from').value = e.start_date;
    $('#bf-days').textContent = e ? t('Work days: {days} (change them in Team)', { days: workDaysLabel(e.work_days) }) : '';
    $('#bf-result').innerHTML = ''; $('#bf-go').classList.add('hidden');
  };
  $('#bf-emp').onchange = () => { $('#bf-from').dataset.touched = ''; syncBf(); };
  ['bf-from', 'bf-to', 'bf-in', 'bf-out', 'bf-break'].forEach((id) => ($('#' + id).oninput = () => { if (id === 'bf-from') $('#bf-from').dataset.touched = '1'; $('#bf-result').innerHTML = ''; $('#bf-go').classList.add('hidden'); }));
  syncBf();
  $('#bf-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const create = ev.submitter?.value === 'create';
    const body = { employee_id: Number($('#bf-emp').value), from: $('#bf-from').value, to: $('#bf-to').value, in: $('#bf-in').value, out: $('#bf-out').value, break_min: Number($('#bf-break').value) || 0, dry_run: !create };
    if (create && !confirm(t('Create {n} shifts for {name}?', { n: $('#bf-go').dataset.n, name: empById(body.employee_id).name }))) return;
    try {
      const r = await api('/api/admin/backfill', { method: 'POST', body });
      if (create) { toast(t('{n} shifts created', { n: r.created })); $('#bf-result').innerHTML = `<div class="ok-line">✓ ${t('{n} shifts created', { n: r.created })}</div>`; $('#bf-go').classList.add('hidden'); return; }
      $('#bf-result').innerHTML = `<div class="ok-line">${t('Will create {n} shifts.', { n: r.days })}</div>
        <div class="muted" style="font-size:12.5px">${t('Skipped: {off} days off, {hol} holidays, {leave} leave days, {ex} days that already have a shift.', { off: r.skipped.off, hol: r.skipped.holiday, leave: r.skipped.leave, ex: r.skipped.existing })}</div>
        ${r.years_without_holidays.length ? `<div class="warn-line" style="max-width:none">⚠ ${t('No national holidays are loaded for {years}, so those holidays would be filled as work days. Add them first in Settings → National holidays if you want them skipped.', { years: r.years_without_holidays.join(', ') })}</div>` : ''}`;
      $('#bf-go').dataset.n = r.days;
      $('#bf-go').textContent = t('Create {n} shifts', { n: r.days });
      $('#bf-go').classList.toggle('hidden', !r.days);
    } catch (e) { toast(e.message, true); }
  };

  // 2. past leave
  $('#pl-form').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const comp = $('#pl-type').value === 'comp';
      await api('/api/admin/leave', { method: 'POST', body: { employee_id: Number($('#pl-emp').value), type: $('#pl-type').value, start: $('#pl-from').value, end: comp ? $('#pl-from').value : $('#pl-to').value || $('#pl-from').value, half: !comp && $('#pl-half').checked, hours: comp ? Number($('#pl-hours').value) : undefined, note: $('#pl-note').value } });
      toast(t('Leave added')); $('#pl-from').value = ''; $('#pl-to').value = ''; $('#pl-note').value = ''; $('#pl-half').checked = false;
    } catch (e) { toast(e.message, true); }
  };
  $('#pl-type').onchange = () => { $('#pl-hours-wrap').classList.toggle('hidden', $('#pl-type').value !== 'comp'); };
  $('#pl-from').onchange = () => { if (!$('#pl-to').value || $('#pl-to').value < $('#pl-from').value) $('#pl-to').value = $('#pl-from').value; };

  // 3. CSV import
  const reparse = async () => {
    if (!importState?.rows) return;
    const built = buildImport(importState.rows, d.employees, { employeeId: Number($('#im-emp').value) || null, breakUnit: $('#im-break').value });
    importState.built = built;
    const good = built.items.filter((x) => x.row);
    let check = { results: [] };
    try { if (good.length) check = await api('/api/admin/import/shifts', { method: 'POST', body: { rows: good.slice(0, 1000).map((x) => x.row), dry_run: true } }); }
    catch (e) { toast(e.message, true); }
    good.slice(0, 1000).forEach((x, i) => { const r = check.results[i]; if (r?.status === 'duplicate') x.dup = true; else if (r?.status === 'error') x.error = r.error; });
    const ready = built.items.filter((x) => x.row && !x.error && !x.dup);
    const errs = built.items.filter((x) => x.error), dups = built.items.filter((x) => x.dup);
    const name = (id) => empById(id)?.name || '?';
    const missing = ['date', 'in', 'out'].filter((k) => built.columns[k] < 0);
    $('#im-preview').innerHTML = `
      <div class="im-summary">
        <span class="tag paid">✓ ${t('{n} ready', { n: ready.length })}</span>
        ${dups.length ? `<span class="tag">${t('{n} already imported', { n: dups.length })}</span>` : ''}
        ${errs.length ? `<span class="tag warn">⚠ ${t('{n} with problems', { n: errs.length })}</span>` : ''}
        ${built.columns.employee < 0 ? `<span class="muted">${t('No employee column: all rows go to the employee chosen above.')}</span>` : ''}
        ${missing.length && built.columns.hours < 0 ? `<span class="warn-line" style="max-width:none">${t('Columns not found: {cols}', { cols: missing.join(', ') })}</span>` : ''}
      </div>
      <div class="table-wrap im-table"><table class="tbl"><thead><tr><th>#</th><th>${t('Employee')}</th><th>${t('Date')}</th><th>${t('In')}</th><th>${t('Out')}</th><th class="num">${t('Break')}</th><th>${t('Note')}</th><th>${t('Status')}</th></tr></thead><tbody>
        ${built.items.slice(0, 300).map((x) => `<tr class="${x.error ? 'im-err' : x.dup ? 'im-dup' : ''}"><td class="muted">${x.line}</td>
          ${x.row ? `<td>${esc(name(x.row.employee_id))}</td><td>${x.row.date}</td><td>${x.row.in}</td><td>${x.row.out}</td><td class="num">${x.row.break_min || '—'}</td><td class="muted">${esc(x.row.note)}</td>` : `<td colspan="6" class="muted">${esc(x.raw.join(' · '))}</td>`}
          <td>${x.error ? `<span class="warn-line">${esc(importError(x.error))}</span>` : x.dup ? `<span class="muted">${t('already imported')}</span>` : '✓'}</td></tr>`).join('')}
      </tbody></table></div>
      ${built.items.length > 300 ? `<p class="muted" style="font-size:12.5px">${t('Showing the first 300 of {n} rows.', { n: built.items.length })}</p>` : ''}
      ${ready.length ? `<button class="btn btn-primary" id="im-go">${t('Import {n} shifts', { n: ready.length })}</button>` : ''}`;
    const go = $('#im-go');
    if (go) go.onclick = async () => {
      go.disabled = true;
      let total = 0;
      try {
        const rows = ready.map((x) => x.row);
        for (let i = 0; i < rows.length; i += 500) {
          go.textContent = t('Importing… {n}%', { n: Math.round((i / rows.length) * 100) });
          total += (await api('/api/admin/import/shifts', { method: 'POST', body: { rows: rows.slice(i, i + 500) } })).imported;
        }
        toast(t('{n} shifts imported', { n: total }));
        reparse();
      } catch (e) { toast(e.message, true); go.disabled = false; }
    };
  };
  $('#im-file').onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    importState = { rows: parseCSV(await f.text()) };
    reparse();
  };
  $('#im-emp').onchange = reparse;
  $('#im-break').onchange = reparse;
}

// ---------- personal details & install QR ----------
function contactLines(e) {
  const bits = [];
  if (e.phone) bits.push(`<a href="tel:${esc(e.phone.replace(/[^+\d]/g, ''))}">${icons.phone} ${esc(e.phone)}</a>`);
  if (e.email) bits.push(`<a href="mailto:${esc(e.email)}">${icons.mail} ${esc(e.email)}</a>`);
  if (e.birthday) bits.push(`<span>🎂 ${dateLabel(e.birthday, { month: 'long', day: 'numeric' })}</span>`);
  if (e.emergency_phone) bits.push(`<a href="tel:${esc(e.emergency_phone.replace(/[^+\d]/g, ''))}" class="ec">${icons.alert} ${t('Emergency')}: ${esc(e.emergency_name || '')}${e.emergency_relation ? ` (${esc(e.emergency_relation)})` : ''} ${esc(e.emergency_phone)}</a>`);
  return bits.length ? `<div class="contact">${bits.join('')}</div>` : '';
}
// Birthdays in the next 14 days, nearest first
function upcomingBirthdays(employees, today) {
  const [ty] = today.split('-').map(Number);
  return employees.filter((e) => e.active && e.birthday).map((e) => {
    let next = `${ty}-${e.birthday.slice(5)}`;
    if (next < today) next = `${ty + 1}-${e.birthday.slice(5)}`;
    return { e, next, days: Math.round((Date.parse(next) - Date.parse(today)) / 86400e3) };
  }).filter((x) => x.days <= 14).sort((a, b) => a.days - b.days);
}
function openQr() {
  const url = location.origin + '/';
  const qr = window.qrcode(0, 'M');
  qr.addData(url); qr.make();
  $('#qr-box').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true, alt: 'QR code: ' + url });
  $('#qr-url').textContent = url;
  $('#qr-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast(t('Link copied')); } catch { toast(url); } };
  $('#qr-close').onclick = () => $('#dlg-qr').close();
  $('#dlg-qr').showModal();
}

// ---------- team ----------
function renderTeam() {
  const d = state.data;
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>${t('Team')}</h1><p>${t('{n} active members. Each person signs in on their phone with a personal PIN.', { n: d.employees.filter((e) => e.active).length })}</p></div>
      <div class="toolbar"><button class="btn btn-ghost" id="tm-qr">${icons.qr} ${t('Install QR code')}</button><button class="btn btn-primary" id="tm-add">${icons.plus} ${t('Add team member')}</button></div>
    </div>
    <div class="team-cards">${d.employees.length ? d.employees.slice().sort((a, b) => b.active - a.active).map((e) => `
      <div class="card member ${e.active ? '' : 'inactive'}">
        <div class="member-top">${avatar(e, e.onShift ? 'on' : '')}<div style="min-width:0"><div class="nm">${esc(e.name)}</div><div class="rl">${esc(e.role || t('Team member'))} · ${e.pay_type === 'monthly' ? `${money(e.monthly_salary)}/${t('month')}` : `${money(e.hourly_rate)}/${t('h')}`} · ${workDaysLabel(e.work_days)}${e.active ? '' : ' · ' + t('inactive')}</div></div>
          <button class="btn btn-ghost btn-icon btn-sm" style="margin-left:auto" data-emp="${e.id}" aria-label="${t('Edit {name}', { name: esc(e.name) })}">${icons.edit}</button></div>
        <div class="member-stats"><div><div class="k">${t('Today')}</div><div class="v">${hours(e.todayMs)}h</div></div><div><div class="k">${t('Week')}</div><div class="v">${hours(e.weekMs)}h</div></div><div><div class="k">${t('Month')}</div><div class="v">${hours(e.monthMs)}h</div></div></div>
        ${(() => { const b = (state.balances || []).find((x) => x.employee_id === e.id); const a = b?.annual;
          return a?.status === 'active' ? `<div class="bal-mini">${annualBar(a)}<span>${t('特休 {left} of {earned} days left · until {date}', { left: d1(a.remaining), earned: d1(a.earned), date: dateLabel(a.to, { month: 'short', day: 'numeric' }) })}</span></div>`
            : e.active && !e.start_date ? `<span class="muted" style="font-size:12.5px">${t('Add a start date to track 特休')}</span>` : ''; })()}
        ${contactLines(e)}
        ${e.start_date ? `<span class="muted" style="font-size:12.5px">${t('Started {date}', { date: dateLabel(e.start_date, { year: 'numeric', month: 'short', day: 'numeric' }) })} · ${seniority(e.start_date, d.today)} · ${e.leave_system === 'calendar' ? t('Calendar year') : t('Anniversary year')}</span>` : ''}
        ${e.comp_status === 'proposed' ? `<span class="pill st-pending" style="justify-self:start"><span class="dot"></span>${t('補休: waiting for agreement')}</span>`
          : e.comp_status === 'active' ? `<span class="pill st-approved" style="justify-self:start"><span class="dot"></span>${t('補休: overtime banked')}${(() => { const c = (state.balances || []).find((x) => x.employee_id === e.id)?.comp?.balance; return c ? ' · ' + t('{n} h', { n: c.available }) : ''; })()}</span>` : ''}
        ${e.onShift ? `<span class="pill pill-live" style="justify-self:start"><span class="dot"></span>${t('On shift now')}</span>` : ''}
      </div>`).join('') : `<div class="card empty" style="grid-column:1/-1">${t("No team members yet. Add your first one — they'll appear on the time clock right away.")}</div>`}</div>`;
  $('#tm-add').onclick = () => openEmp();
  $('#tm-qr').onclick = openQr;
  $('#page').querySelectorAll('[data-emp]').forEach((b) => (b.onclick = () => openEmp(d.employees.find((e) => e.id === Number(b.dataset.emp)))));
}
function openEmp(e, { focus } = {}) {
  const dlg = $('#dlg-emp');
  $('#emp-title').textContent = e ? t('Edit {name}', { name: e.name }) : t('Add team member');
  $('#em-name').value = e?.name || '';
  $('#em-role').value = e?.role || '';
  $('#em-rate').value = e ? e.hourly_rate : 196;
  $('#em-leave').value = e ? (e.leave_hours ?? 8) : 8;
  $('#em-salary').value = e ? e.monthly_salary || '' : '';
  $('#em-start').value = e?.start_date || '';
  $('#em-bday').value = e?.birthday || ''; $('#em-phone').value = e?.phone || ''; $('#em-email').value = e?.email || '';
  $('#em-ec-name').value = e?.emergency_name || ''; $('#em-ec-rel').value = e?.emergency_relation || ''; $('#em-ec-phone').value = e?.emergency_phone || '';
  $('#em-personal').open = !e || !!(e.phone || e.email || e.birthday || e.emergency_phone);
  const cs = e?.comp_status || 'off';
  $('#em-comp').checked = cs === 'proposed' || cs === 'active';
  const compWhen = e?.comp_updated ? dateLabel(dayKey(e.comp_updated), { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  $('#em-comp-status').innerHTML = !e ? t('After saving, the employee is asked to agree in the app. Nothing changes until they agree.')
    : cs === 'proposed' ? `⏳ ${t('Waiting for {name} to agree (asked {date}).', { name: esc(e.name), date: compWhen })}`
    : cs === 'active' ? `✓ ${t('{name} agreed on {date}. Overtime is banked as 補休, not paid.', { name: esc(e.name), date: compWhen })}`
    : cs === 'declined' ? `✗ ${t('{name} declined on {date}. Tick again to ask again.', { name: esc(e.name), date: compWhen })}`
    : t('When ticked, {name} is asked to agree in the app. Nothing changes until they agree.', { name: esc(e.name) });
  let lsys = e?.leave_system || 'anniversary';
  const paintSys = () => { $('#em-lsys').innerHTML = ['anniversary', 'calendar'].map((k) => `<button type="button" role="radio" aria-checked="${k === lsys}" data-ls="${k}">${t(k === 'anniversary' ? '週年制 Anniversary' : '曆年制 Calendar')}</button>`).join(''); };
  $('#em-lsys').onclick = (ev) => { const b = ev.target.closest('[data-ls]'); if (b) { lsys = b.dataset.ls; paintSys(); } };
  paintSys();
  $('#em-daily').value = e ? (e.daily_hours ?? 8) : 8;
  $('#em-ins').value = e ? e.insurance || 0 : 0;
  let payType = e?.pay_type || 'hourly';
  const paintPay = () => {
    $('#em-paytype').innerHTML = ['hourly', 'monthly'].map((k) => `<button type="button" role="radio" aria-checked="${k === payType}" data-pt="${k}">${t(k === 'hourly' ? 'Hourly (part-time)' : 'Monthly salary (full-time)')}</button>`).join('');
    $('#form-emp').classList.toggle('is-hourly', payType === 'hourly');
    $('#form-emp').classList.toggle('is-monthly', payType === 'monthly');
    $('#em-salary').required = payType === 'monthly';
  };
  $('#em-paytype').onclick = (ev) => { const b = ev.target.closest('[data-pt]'); if (b) { payType = b.dataset.pt; paintPay(); } };
  paintPay();
  const days = new Set(String(e?.work_days ?? '1,2,3,4,5').split(',').filter(Boolean).map(Number));
  $('#em-days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" value="${d}" ${days.has(d) ? 'checked' : ''}><span>${weekdayShort(d)}</span></label>`).join('');
  $('#em-pin').value = '';
  $('#em-pin').required = !e;
  $('#em-pin-label').textContent = e ? t('New PIN (leave empty to keep)') : t('PIN (4–6 digits)');
  $('#em-active-wrap').classList.toggle('hidden', !e);
  $('#em-active').checked = e ? e.active : true;
  $('#em-err').textContent = '';
  $('#form-emp').onsubmit = async (ev) => {
    if (ev.submitter?.value !== 'save') return;
    ev.preventDefault();
    const body = { name: $('#em-name').value, role: $('#em-role').value, hourly_rate: Number($('#em-rate').value) || 0, leave_hours: Number($('#em-leave').value), pin: $('#em-pin').value,
      start_date: $('#em-start').value, leave_system: lsys, comp_time: $('#em-comp').checked,
      birthday: $('#em-bday').value, phone: $('#em-phone').value, email: $('#em-email').value,
      emergency_name: $('#em-ec-name').value, emergency_relation: $('#em-ec-rel').value, emergency_phone: $('#em-ec-phone').value, pay_type: payType, monthly_salary: Number($('#em-salary').value) || 0, daily_hours: Number($('#em-daily').value) || 8, insurance: Number($('#em-ins').value) || 0,
      work_days: [...$('#em-days').querySelectorAll('input:checked')].map((i) => i.value).join(',') };
    if (e) body.active = $('#em-active').checked;
    try {
      await api(e ? `/api/admin/employees/${e.id}` : '/api/admin/employees', { method: e ? 'PATCH' : 'POST', body });
      dlg.close();
      const askedComp = body.comp_time && !['proposed', 'active'].includes(e?.comp_status || 'off');
      toast(askedComp ? t('Saved — {name} has been asked to agree to 補休', { name: body.name }) : e ? t('Saved') : t('{name} added — they can sign in now', { name: body.name }));
      refresh();
    } catch (err) { $('#em-err').textContent = err.message; }
  };
  dlg.showModal();
  if (focus) $('#' + focus).focus();
}

// ---------- settings ----------
function renderSettings() {
  const d = state.data;
  $('#page').innerHTML = `
    <div class="page-head"><div><h1>${t('Settings')}</h1><p>${t('Business details and security.')}</p></div></div>
    <div class="settings-grid">
      <form class="card" id="f-company">
        <h2>${t('Business')}</h2><p>${t('Shown on the time clock.')}</p>
        <div class="field"><label for="s-company">${t('Business name')}</label><input class="input" id="s-company" value="${esc(d.company)}" maxlength="60"></div>
        <label class="check"><input type="checkbox" id="s-geo" ${d.geo ? 'checked' : ''}> ${t('Record location when employees punch')}</label>
        <div class="field"><label for="s-alert">${t('Warn me when someone is clocked in longer than (hours)')}</label><input class="input" type="number" min="1" max="24" step="1" id="s-alert" value="${d.alertHours}" style="max-width:120px"></div>
        <p class="muted" style="margin:0">${t('Timezone: <b>{tz}</b> (set with the APP_TIMEZONE variable on the server).', { tz: esc(d.timezone) })}</p>
        <button class="btn btn-primary" style="justify-self:start">${t('Save')}</button>
      </form>
      <div class="card hol-card" id="hol-card"></div>
      <form class="card" id="f-leavepay">
        <h2>${t('Paid leave')}</h2><p>${t('How much of the normal pay each type of approved leave earns. It is added to payroll and the CSV export.')}</p>
        <div class="row-2">${['annual', 'sick', 'personal', 'other'].map((k) => `
          <div class="field"><label for="lp-${k}">${leaveLabel(k)} (%)</label><input class="input" type="number" min="0" max="100" step="5" id="lp-${k}" value="${d.leavePay?.[k] ?? 0}"></div>`).join('')}</div>
        <p class="muted" style="margin:0;font-size:12.5px">${t('Common in Taiwan: annual leave 100%, sick leave 50%, personal leave unpaid. Paid hours per leave day are set for each person in Team.')}</p>
        <button class="btn btn-primary" style="justify-self:start">${t('Save')}</button>
      </form>
      <form class="card" id="f-payroll">
        <h2>${t('Overtime')}</h2><p>${t('Used for payroll. Defaults follow the Taiwan Labor Standards Act.')}</p>
        <label class="check"><input type="checkbox" id="pc-auto" ${d.payroll?.ot_auto !== false ? 'checked' : ''}> ${t('Pay overtime automatically')}</label>
        <div class="row-3">
          <div class="field"><label for="pc-r1">${t('Rate, first hours')}</label><input class="input" type="number" min="1" max="3" step="0.01" id="pc-r1" value="${d.payroll?.ot_rate1 ?? 1.34}"></div>
          <div class="field"><label for="pc-tier">${t('First hours')}</label><input class="input" type="number" min="0" max="12" step="0.5" id="pc-tier" value="${d.payroll?.ot_tier ?? 2}"></div>
          <div class="field"><label for="pc-r2">${t('Rate after')}</label><input class="input" type="number" min="1" max="3" step="0.01" id="pc-r2" value="${d.payroll?.ot_rate2 ?? 1.67}"></div>
        </div>
        <div class="field"><label for="pc-div">${t('Monthly salary ÷ hours = hourly value')}</label><input class="input" type="number" min="1" max="400" step="1" id="pc-div" value="${d.payroll?.divisor ?? 240}" style="max-width:120px"></div>
        <div class="field"><label for="pc-cexp">${t('補休 must be used within (months)')}</label><input class="input" type="number" min="1" max="24" step="1" id="pc-cexp" value="${d.payroll?.comp_expiry_months ?? 6}" style="max-width:120px"></div>
        <label class="check"><input type="checkbox" id="pc-hfull" ${d.payroll?.holiday_full_day !== false ? 'checked' : ''}> ${t('Working on a holiday earns a full extra day (even for fewer hours)')}</label>
        <label class="check"><input type="checkbox" id="pc-hpay" ${d.payroll?.holiday_pay_hourly !== false ? 'checked' : ''}> ${t('Pay hourly staff for holidays on their work days')}</label>
        <button class="btn btn-primary" style="justify-self:start">${t('Save')}</button>
      </form>
      <form class="card" id="f-pass">
        <h2>${t('Admin password')}</h2><p>${t('Used to open this dashboard.')}</p>
        <div class="field"><label for="s-cur">${t('Current password')}</label><input class="input" type="password" id="s-cur" autocomplete="current-password" required></div>
        <div class="field"><label for="s-new">${t('New password')}</label><input class="input" type="password" id="s-new" autocomplete="new-password" minlength="6" required></div>
        <div class="err" id="s-err"></div>
        <button class="btn btn-primary" style="justify-self:start">${t('Update password')}</button>
      </form>
    </div>`;
  $('#f-company').onsubmit = async (ev) => {
    ev.preventDefault();
    await api('/api/admin/settings', { method: 'POST', body: { company: $('#s-company').value, geo: $('#s-geo').checked, alert_hours: Number($('#s-alert').value) } }).then(() => { toast(t('Settings saved')); refresh(); }, (e) => toast(e.message, true));
  };
  renderHolidays(Number(state.holYear || d.today.slice(0, 4)));
  $('#f-payroll').onsubmit = (ev) => {
    ev.preventDefault();
    const payroll = { ot_auto: $('#pc-auto').checked, ot_rate1: Number($('#pc-r1').value), ot_tier: Number($('#pc-tier').value), ot_rate2: Number($('#pc-r2').value), divisor: Number($('#pc-div').value), holiday_full_day: $('#pc-hfull').checked, holiday_pay_hourly: $('#pc-hpay').checked, comp_expiry_months: Number($('#pc-cexp').value) };
    api('/api/admin/settings', { method: 'POST', body: { payroll } }).then(() => { toast(t('Settings saved')); refresh(); }, (e) => toast(e.message, true));
  };
  $('#f-leavepay').onsubmit = async (ev) => {
    ev.preventDefault();
    const leave_pay = Object.fromEntries(['annual', 'sick', 'personal', 'other'].map((k) => [k, Number($(`#lp-${k}`).value)]));
    api('/api/admin/settings', { method: 'POST', body: { leave_pay } }).then(() => { toast(t('Settings saved')); refresh(); }, (e) => toast(e.message, true));
  };
  $('#f-pass').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'POST', body: { currentPassword: $('#s-cur').value, newPassword: $('#s-new').value } });
      toast(t('Password updated')); refresh();
    } catch (e) { $('#s-err').textContent = e.message; }
  };
}

// ---------- language ----------
translatePage();
document.querySelectorAll('.lang-slot').forEach((el) => el.replaceWith(langButton()));
addEventListener('langchange', () => {
  if (!state.data || $('#admin').classList.contains('hidden')) return;
  syncPush('admin');
  buildNav();
  render();
});

addEventListener('hashchange', () => { const p = location.hash.slice(1); if (p && p !== state.page) go(p); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const c = document.getElementById('chart'); if (c && state.page === 'overview') drawChart(c, state.data); }, 150); });
setInterval(() => { if (!document.hidden && !$('#admin').classList.contains('hidden') && !document.querySelector('dialog[open]') && ['overview', 'timeoff'].includes(state.page)) refresh(); else if (!document.hidden && state.data) api('/api/admin/overview').then((d) => { if (d.pendingLeave !== state.data.pendingLeave) { state.data = d; render(); } }).catch(() => {}); }, 60000);
registerSW();
boot();
