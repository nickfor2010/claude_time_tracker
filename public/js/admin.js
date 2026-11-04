import { api, icons, esc, avatar, time, hm24, dur, hours, money, dayKey, dateLabel, worked, toast, setTimezone, clockNow } from './common.js';
import { t, translatePage, langButton, isZh } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const PAGES = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'timesheets', label: 'Timesheets', icon: 'sheet' },
  { id: 'team', label: 'Team', icon: 'users' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];
let state = { page: 'overview', data: null, month: null, empFilter: '', shifts: [] };
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
  const html = PAGES.map((p) => `<button data-page="${p.id}" class="${p.id === state.page ? 'active' : ''}">${icons[p.icon]}<span>${t(p.label)}</span></button>`).join('');
  $('#nav').innerHTML = html;
  $('#mnav').innerHTML = html;
  [$('#nav'), $('#mnav')].forEach((n) => (n.onclick = (ev) => { const b = ev.target.closest('button'); if (b) go(b.dataset.page); }));
}
async function go(page) {
  if (!PAGES.some((p) => p.id === page)) page = 'overview';
  state.page = page;
  if (location.hash.slice(1) !== page) history.replaceState(null, '', '#' + page);
  document.querySelectorAll('[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  await refresh();
  scrollTo({ top: 0 });
}
async function refresh() {
  try {
    state.data = await api('/api/admin/overview');
    if (state.page === 'timesheets') await loadShifts();
  } catch (e) { if (e.status === 401) return boot(); toast(e.message, true); }
  render();
}
// Open shifts that look like a forgotten clock-out: longer than the warning time, or started on an earlier day.
const isForgotten = (s, d = state.data) => !s.clock_out && (d.now - s.clock_in > d.alertHours * 3600e3 || dayKey(s.clock_in) !== d.today);

function render() {
  const d = state.data;
  const forgotten = d.onShift.filter((s) => isForgotten(s));
  $('#banner').innerHTML = forgotten.map((s) => `
    <div class="banner banner-warn" role="alert">${icons.alert}
      <span>${t('<b>{name}</b> has been clocked in for {dur} (since {since}). Forgot to clock out?', {
        name: esc(s.name), dur: `<b class="tnum" data-since="${s.clock_in}">${dur(d.now - s.clock_in)}</b>`,
        since: `${dayKey(s.clock_in) === d.today ? '' : dateLabel(dayKey(s.clock_in)) + ' '}${time(s.clock_in)}` })}</span>
      <button class="btn btn-sm btn-primary" data-fix="${s.id}">${t('Fix')}</button>
    </div>`).join('') + (d.adminDefaultPassword
    ? `<div class="banner">${icons.alert}<span>${t("You're using the default admin password. Please change it.")}</span><button class="btn btn-sm btn-ghost" data-goto="settings">${t('Change now')}</button></div>` : '');
  $('#banner').querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => openShift(d.onShift.find((s) => s.id === Number(b.dataset.fix)), { forgot: true })));
  $('#side-live').innerHTML = `${t('<b>{n}</b> of {total} on shift now', { n: d.onShift.length, total: d.employees.filter((e) => e.active).length })}<br>${dateLabel(d.today, { weekday: 'long', month: 'long', day: 'numeric' })}`;
  ({ overview: renderOverview, timesheets: renderTimesheets, team: renderTeam, settings: renderSettings })[state.page]();
  clearInterval(liveTimer);
  liveTimer = setInterval(tickLive, 1000);
}
document.addEventListener('click', (ev) => { const g = ev.target.closest('[data-goto]'); if (g) go(g.dataset.goto); });

function tickLive() {
  const skew = Date.now() - state.data.now;
  document.querySelectorAll('[data-since]').forEach((el) => (el.textContent = dur(Date.now() - skew - Number(el.dataset.since), { seconds: el.dataset.sec === '1' })));
}

// ---------- overview ----------
function greeting() {
  const h = Number(clockNow({ hour: 'numeric', hourCycle: 'h23' }).replace(/\D/g, ''));
  return t(h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera');
}
function renderOverview() {
  const d = state.data, tot = d.totals;
  const active = d.employees.filter((e) => e.active);
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>${t('{greet}, Chef', { greet: greeting() })}</h1><p>${t("Here's how the team is doing today.")}</p></div>
      <div class="toolbar"><button class="btn btn-ghost" data-goto="timesheets">${icons.sheet} ${t('Timesheets')}</button><button class="btn btn-primary" id="ov-add">${icons.plus} ${t('Add shift')}</button></div>
    </div>
    <div class="kpis">
      <div class="card kpi hero"><div class="k">${icons.clock} ${t('On shift now')}</div><div class="v">${d.onShift.length}<small>/ ${active.length}</small></div><div class="h">${d.onShift.length ? esc(d.onShift.map((s) => s.name.split(' ')[0]).join(', ')) : t('Nobody clocked in')}</div></div>
      <div class="card kpi"><div class="k">${icons.sun} ${t('Hours today')}</div><div class="v">${hours(tot.todayMs)}<small>${t('h')}</small></div><div class="h">${dateLabel(d.today, { weekday: 'long', month: 'short', day: 'numeric' })}</div></div>
      <div class="card kpi"><div class="k">${icons.cal} ${t('Hours this week')}</div><div class="v">${hours(tot.weekMs)}<small>${t('h')}</small></div><div class="h">${t('Since Monday')}</div></div>
      <div class="card kpi"><div class="k">${icons.coins} ${t('Payroll this month')}</div><div class="v" style="font-size:clamp(20px,2.4vw,30px)">${money(tot.monthPay)}</div><div class="h">${t('{h} h worked · estimate', { h: hours(tot.monthMs) })}</div></div>
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
          return `<div class="who-row">${avatar(e, open ? 'on' : '')}<div><div class="nm">${esc(e.name)}</div><div class="s">${open && isForgotten(open) ? `<span style="color:var(--clay);font-weight:600">${t('No clock-out since {since}', { since: (dayKey(open.clock_in) === d.today ? '' : dateLabel(dayKey(open.clock_in)) + ' ') + time(open.clock_in) })}</span>` : open ? t('In since {t}', { t: time(open.clock_in) }) : e.todayMs ? t('Worked {dur} today', { dur: dur(e.todayMs) }) : t('Not in today')}</div></div>
            <div class="live">${open ? `<span data-since="${open.clock_in}" data-sec="1">${dur(d.now - open.clock_in, { seconds: true })}</span>` : `<span class="muted">${e.todayMs ? hours(e.todayMs) + ' ' + t('h') : '—'}</span>`}</div></div>`;
        }).join('') : `<div class="empty">${t('Add your team to get started.')}<br><br><button class="btn btn-primary btn-sm" data-goto="team">${icons.plus} ${t('Add team member')}</button></div>`}</div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card panel">
        <div class="panel-head"><h2>${t('This week by person')}</h2><span class="muted">${t('Mon – today')}</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>${t('Employee')}</th><th class="num">${t('Today')}</th><th class="num">${t('Week')}</th><th class="num">${t('Month')}</th><th class="num">${t('Month pay')}</th></tr></thead><tbody>
        ${active.map((e) => `<tr><td><span class="emp">${avatar(e)}${esc(e.name)}</span></td><td class="num">${dur(e.todayMs)}</td><td class="num">${dur(e.weekMs)}</td><td class="num">${dur(e.monthMs)}</td><td class="num">${money(e.monthMs / 3600e3 * e.hourly_rate)}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">${t('No team members yet.')}</td></tr>`}
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
}
function renderTimesheets() {
  const d = state.data, shifts = state.shifts;
  const { from, to } = monthRange(state.month);
  const byEmp = {};
  for (const s of shifts) {
    const b = (byEmp[s.employee_id] ||= { e: { name: s.name, color: s.color }, ms: 0, n: 0, pay: 0, days: new Set() });
    const w = worked(s, d.now);
    b.ms += w; b.n++; b.pay += (w / 3600e3) * (s.hourly_rate || 0); b.days.add(s.day);
  }
  const monthName = dateLabel(from, { month: 'long', year: 'numeric' });
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>${t('Timesheets')}</h1><p>${t(shifts.length === 1 ? '{month} · 1 shift' : '{month} · {n} shifts', { month: monthName, n: shifts.length })}</p></div>
      <div class="toolbar">
        <input class="input" type="month" id="ts-month" value="${state.month}" aria-label="${t('Month')}">
        <select class="input" id="ts-emp" aria-label="${t('Employee')}"><option value="">${t('Everyone')}</option>${d.employees.map((e) => `<option value="${e.id}" ${String(e.id) === String(state.empFilter) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        <a class="btn btn-ghost" href="/api/admin/export.csv?from=${from}&to=${to}${state.empFilter ? `&employee=${state.empFilter}` : ''}&lang=${isZh() ? 'zh' : 'en'}">${icons.download} ${t('Export CSV')}</a>
        <button class="btn btn-primary" id="ts-add">${icons.plus} ${t('Add shift')}</button>
      </div>
    </div>
    <div class="sum-cards">${Object.values(byEmp).map((b) => `<div class="card sum-card">${avatar(b.e)}<div><div style="font-weight:600">${esc(b.e.name)}</div><div class="v">${dur(b.ms)}</div><div class="s">${t('{n} days · {pay}', { n: b.days.size, pay: money(b.pay) })}</div></div></div>`).join('')}</div>
    <div class="card panel" style="padding:6px 6px">
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>${t('Date')}</th><th>${t('Employee')}</th><th>${t('In')}</th><th>${t('Out')}</th><th class="num">${t('Break')}</th><th class="num">${t('Worked')}</th><th class="num">${t('Pay')}</th><th>${t('Note')}</th><th></th></tr></thead>
        <tbody>${shifts.length ? shifts.map((s) => {
          const w = worked(s, d.now);
          const loc = s.in_lat != null ? ` <a href="https://maps.google.com/?q=${s.in_lat},${s.in_lng}" target="_blank" rel="noopener" title="${t('Clock-in location')}" style="color:var(--ink-3)">${icons.pin.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"')}</a>` : '';
          return `<tr>
            <td>${dateLabel(s.day)}</td>
            <td><span class="emp">${avatar(s)}${esc(s.name)}</span></td>
            <td class="tnum">${time(s.clock_in)}${loc}</td>
            <td class="tnum">${s.clock_out ? time(s.clock_out) : isForgotten(s) ? `<span class="tag warn">${t('CHECK · NO CLOCK-OUT')}</span>` : `<span class="tag live">${t('ON SHIFT')}</span>`}</td>
            <td class="num">${s.break_min ? s.break_min + 'm' : '—'}</td>
            <td class="num"><b>${s.clock_out ? dur(w) : `<span data-since="${s.clock_in}">${dur(w)}</span>`}</b></td>
            <td class="num">${money((w / 3600e3) * (s.hourly_rate || 0))}</td>
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

// ---------- team ----------
function renderTeam() {
  const d = state.data;
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>${t('Team')}</h1><p>${t('{n} active members. Each person signs in on their phone with a personal PIN.', { n: d.employees.filter((e) => e.active).length })}</p></div>
      <div class="toolbar"><button class="btn btn-primary" id="tm-add">${icons.plus} ${t('Add team member')}</button></div>
    </div>
    <div class="team-cards">${d.employees.length ? d.employees.slice().sort((a, b) => b.active - a.active).map((e) => `
      <div class="card member ${e.active ? '' : 'inactive'}">
        <div class="member-top">${avatar(e, e.onShift ? 'on' : '')}<div style="min-width:0"><div class="nm">${esc(e.name)}</div><div class="rl">${esc(e.role || t('Team member'))} · ${money(e.hourly_rate)}/${t('h')}${e.active ? '' : ' · ' + t('inactive')}</div></div>
          <button class="btn btn-ghost btn-icon btn-sm" style="margin-left:auto" data-emp="${e.id}" aria-label="${t('Edit {name}', { name: esc(e.name) })}">${icons.edit}</button></div>
        <div class="member-stats"><div><div class="k">${t('Today')}</div><div class="v">${hours(e.todayMs)}h</div></div><div><div class="k">${t('Week')}</div><div class="v">${hours(e.weekMs)}h</div></div><div><div class="k">${t('Month')}</div><div class="v">${hours(e.monthMs)}h</div></div></div>
        ${e.onShift ? `<span class="pill pill-live" style="justify-self:start"><span class="dot"></span>${t('On shift now')}</span>` : ''}
      </div>`).join('') : `<div class="card empty" style="grid-column:1/-1">${t("No team members yet. Add your first one — they'll appear on the time clock right away.")}</div>`}</div>`;
  $('#tm-add').onclick = () => openEmp();
  $('#page').querySelectorAll('[data-emp]').forEach((b) => (b.onclick = () => openEmp(d.employees.find((e) => e.id === Number(b.dataset.emp)))));
}
function openEmp(e) {
  const dlg = $('#dlg-emp');
  $('#emp-title').textContent = e ? t('Edit {name}', { name: e.name }) : t('Add team member');
  $('#em-name').value = e?.name || '';
  $('#em-role').value = e?.role || '';
  $('#em-rate').value = e ? e.hourly_rate : 196;
  $('#em-pin').value = '';
  $('#em-pin').required = !e;
  $('#em-pin-label').textContent = e ? t('New PIN (leave empty to keep)') : t('PIN (4–6 digits)');
  $('#em-active-wrap').classList.toggle('hidden', !e);
  $('#em-active').checked = e ? e.active : true;
  $('#em-err').textContent = '';
  $('#form-emp').onsubmit = async (ev) => {
    if (ev.submitter?.value !== 'save') return;
    ev.preventDefault();
    const body = { name: $('#em-name').value, role: $('#em-role').value, hourly_rate: Number($('#em-rate').value) || 0, pin: $('#em-pin').value };
    if (e) body.active = $('#em-active').checked;
    try {
      await api(e ? `/api/admin/employees/${e.id}` : '/api/admin/employees', { method: e ? 'PATCH' : 'POST', body });
      dlg.close(); toast(e ? t('Saved') : t('{name} added — they can sign in now', { name: body.name })); refresh();
    } catch (err) { $('#em-err').textContent = err.message; }
  };
  dlg.showModal();
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
  buildNav();
  render();
});

addEventListener('hashchange', () => { const p = location.hash.slice(1); if (p && p !== state.page) go(p); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const c = document.getElementById('chart'); if (c && state.page === 'overview') drawChart(c, state.data); }, 150); });
setInterval(() => { if (!document.hidden && !$('#admin').classList.contains('hidden') && !document.querySelector('dialog[open]') && state.page === 'overview') refresh(); }, 60000);
boot();
