import { api, icons, esc, avatar, time, hm24, dur, hours, money, dayKey, dateLabel, worked, toast, setTimezone, TZ } from './common.js';

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
  const html = PAGES.map((p) => `<button data-page="${p.id}">${icons[p.icon]}<span>${p.label}</span></button>`).join('');
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
function render() {
  const d = state.data;
  $('#banner').innerHTML = d.adminDefaultPassword
    ? `<div class="banner">${icons.alert}<span>You're using the default admin password. Please change it.</span><button class="btn btn-sm btn-ghost" data-goto="settings">Change now</button></div>` : '';
  $('#side-live').innerHTML = `<b>${d.onShift.length}</b> of ${d.employees.filter((e) => e.active).length} on shift now<br>${dateLabel(d.today, { weekday: 'long', month: 'long', day: 'numeric' })}`;
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
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
}
function renderOverview() {
  const d = state.data, t = d.totals;
  const active = d.employees.filter((e) => e.active);
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>${greeting()}, Chef</h1><p>Here's how the team is doing today.</p></div>
      <div class="toolbar"><button class="btn btn-ghost" data-goto="timesheets">${icons.sheet} Timesheets</button><button class="btn btn-primary" id="ov-add">${icons.plus} Add shift</button></div>
    </div>
    <div class="kpis">
      <div class="card kpi hero"><div class="k">${icons.clock} On shift now</div><div class="v">${d.onShift.length}<small>/ ${active.length}</small></div><div class="h">${d.onShift.length ? esc(d.onShift.map((s) => s.name.split(' ')[0]).join(', ')) : 'Nobody clocked in'}</div></div>
      <div class="card kpi"><div class="k">${icons.sun} Hours today</div><div class="v">${hours(t.todayMs)}<small>h</small></div><div class="h">${dateLabel(d.today, { weekday: 'long', month: 'short', day: 'numeric' })}</div></div>
      <div class="card kpi"><div class="k">${icons.cal} Hours this week</div><div class="v">${hours(t.weekMs)}<small>h</small></div><div class="h">Since Monday</div></div>
      <div class="card kpi"><div class="k">${icons.coins} Payroll this month</div><div class="v" style="font-size:clamp(20px,2.4vw,30px)">${money(t.monthPay)}</div><div class="h">${hours(t.monthMs)} h worked · estimate</div></div>
    </div>
    <div class="grid-2">
      <div class="card panel">
        <div class="panel-head"><h2>Hours per day</h2><span class="muted">Last 14 days</span></div>
        <div class="chart-wrap" id="chart"></div>
      </div>
      <div class="card panel">
        <div class="panel-head"><h2>Team today</h2><span class="muted">${d.onShift.length} working</span></div>
        <div class="who">${active.length ? active.sort((a, b) => b.onShift - a.onShift || b.todayMs - a.todayMs).map((e) => {
          const open = d.onShift.find((s) => s.employee_id === e.id);
          return `<div class="who-row">${avatar(e, open ? 'on' : '')}<div><div class="nm">${esc(e.name)}</div><div class="s">${open ? `In since ${time(open.clock_in)}` : e.todayMs ? `Worked ${dur(e.todayMs)} today` : 'Not in today'}</div></div>
            <div class="live">${open ? `<span data-since="${open.clock_in}" data-sec="1">${dur(d.now - open.clock_in, { seconds: true })}</span>` : `<span class="muted">${e.todayMs ? hours(e.todayMs) + 'h' : '—'}</span>`}</div></div>`;
        }).join('') : `<div class="empty">Add your team to get started.<br><br><button class="btn btn-primary btn-sm" data-goto="team">${icons.plus} Add team member</button></div>`}</div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card panel">
        <div class="panel-head"><h2>This week by person</h2><span class="muted">Mon – today</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Employee</th><th class="num">Today</th><th class="num">Week</th><th class="num">Month</th><th class="num">Month pay</th></tr></thead><tbody>
        ${active.map((e) => `<tr><td><span class="emp">${avatar(e)}${esc(e.name)}</span></td><td class="num">${dur(e.todayMs)}</td><td class="num">${dur(e.weekMs)}</td><td class="num">${dur(e.monthMs)}</td><td class="num">${money(e.monthMs / 3600e3 * e.hourly_rate)}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">No team members yet.</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="card panel">
        <div class="panel-head"><h2>Recent activity</h2></div>
        <div class="who">${d.activity.length ? d.activity.slice(0, 8).map((s) => {
          const out = !!s.clock_out;
          return `<div class="who-row">${avatar(s)}<div><div class="nm">${esc(s.name)} <span class="tag ${out ? '' : 'live'}">${out ? 'OUT' : 'IN'}</span></div><div class="s">${dateLabel(dayKey(out ? s.clock_out : s.clock_in))} · ${time(out ? s.clock_out : s.clock_in)}</div></div><div class="live muted" style="font-weight:600">${out ? dur(worked(s)) : ''}</div></div>`;
        }).join('') : `<div class="empty">Punches will show up here.</div>`}</div>
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
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stacked bar chart of hours worked per day for the last 14 days">
    <g class="grid">${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke-width="1"/>`).join('')}</g>
    <g class="axis">${ticks.map((t) => `<text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}h</text>`).join('')}</g>`;
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
  el.innerHTML = svg + `<div class="legend">${used.map((e) => `<span><i style="--c:${e.color}"></i>${esc(e.name)}</span>`).join('') || '<span class="muted">No hours recorded in the last 14 days.</span>'}</div><div class="tip hidden"></div>`;

  const tip = $('.tip', el), svgEl = $('svg', el);
  el.querySelectorAll('.col').forEach((g) => {
    const day = d.days[Number(g.dataset.i)];
    const show = () => {
      const rows = emps.filter((e) => day.byEmp[e.id]).map((e) => `<div class="r"><span><i style="--c:${e.color}"></i>${esc(e.name)}</span><b class="tnum">${dur(day.byEmp[e.id])}</b></div>`).join('');
      const total = Object.values(day.byEmp).reduce((a, b) => a + b, 0);
      tip.innerHTML = `<div class="tt">${dateLabel(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}</div>${rows || '<div class="muted">No hours</div>'}${rows ? `<div class="r" style="margin-top:6px;border-top:1px solid var(--line);padding-top:6px"><span>Total</span><b class="tnum">${dur(total)}</b></div>` : ''}`;
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
      <div><h1>Timesheets</h1><p>${monthName} · ${shifts.length} shift${shifts.length === 1 ? '' : 's'}</p></div>
      <div class="toolbar">
        <input class="input" type="month" id="ts-month" value="${state.month}" aria-label="Month">
        <select class="input" id="ts-emp" aria-label="Employee"><option value="">Everyone</option>${d.employees.map((e) => `<option value="${e.id}" ${String(e.id) === String(state.empFilter) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        <a class="btn btn-ghost" href="/api/admin/export.csv?from=${from}&to=${to}${state.empFilter ? `&employee=${state.empFilter}` : ''}">${icons.download} Export CSV</a>
        <button class="btn btn-primary" id="ts-add">${icons.plus} Add shift</button>
      </div>
    </div>
    <div class="sum-cards">${Object.values(byEmp).map((b) => `<div class="card sum-card">${avatar(b.e)}<div><div style="font-weight:600">${esc(b.e.name)}</div><div class="v">${dur(b.ms)}</div><div class="s">${b.days.size} days · ${money(b.pay)}</div></div></div>`).join('')}</div>
    <div class="card panel" style="padding:6px 6px">
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Date</th><th>Employee</th><th>In</th><th>Out</th><th class="num">Break</th><th class="num">Worked</th><th class="num">Pay</th><th>Note</th><th></th></tr></thead>
        <tbody>${shifts.length ? shifts.map((s) => {
          const w = worked(s, d.now);
          const loc = s.in_lat != null ? ` <a href="https://maps.google.com/?q=${s.in_lat},${s.in_lng}" target="_blank" rel="noopener" title="Clock-in location" style="color:var(--ink-3)">${icons.pin.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"')}</a>` : '';
          return `<tr>
            <td>${dateLabel(s.day)}</td>
            <td><span class="emp">${avatar(s)}${esc(s.name)}</span></td>
            <td class="tnum">${time(s.clock_in)}${loc}</td>
            <td class="tnum">${s.clock_out ? time(s.clock_out) : '<span class="tag live">ON SHIFT</span>'}</td>
            <td class="num">${s.break_min ? s.break_min + 'm' : '—'}</td>
            <td class="num"><b>${s.clock_out ? dur(w) : `<span data-since="${s.clock_in}">${dur(w)}</span>`}</b></td>
            <td class="num">${money((w / 3600e3) * (s.hourly_rate || 0))}</td>
            <td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(s.note)}${s.edited ? '<span class="tag">edited</span>' : ''}</td>
            <td class="acts"><button class="btn btn-ghost btn-icon btn-sm" data-edit="${s.id}" aria-label="Edit shift">${icons.edit}</button></td>
          </tr>`;
        }).join('') : `<tr><td colspan="9"><div class="empty">No shifts in ${monthName}.</div></td></tr>`}</tbody>
      </table></div>
    </div>`;
  $('#ts-month').onchange = async (e) => { if (!e.target.value) return; state.month = e.target.value; await refresh(); };
  $('#ts-emp').onchange = async (e) => { state.empFilter = e.target.value; await refresh(); };
  $('#ts-add').onclick = () => openShift();
  $('#page').querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openShift(shifts.find((s) => s.id === Number(b.dataset.edit)))));
}

// Shift dialog
function openShift(s) {
  const dlg = $('#dlg-shift');
  $('#shift-title').textContent = s ? 'Edit shift' : 'Add shift';
  $('#sh-emp').innerHTML = state.data.employees.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  $('#sh-emp').disabled = !!s;
  $('#sh-emp').value = s ? s.employee_id : state.empFilter || state.data.employees[0]?.id || '';
  $('#sh-date').value = s ? dayKey(s.clock_in) : state.data.today;
  $('#sh-in').value = s ? hm24(s.clock_in) : '09:00';
  $('#sh-out').value = s?.clock_out ? hm24(s.clock_out) : s ? '' : '17:00';
  $('#sh-break').value = s?.break_min || 0;
  $('#sh-note').value = s?.note || '';
  $('#sh-err').textContent = '';
  $('#sh-del').classList.toggle('hidden', !s);
  $('#sh-del').onclick = async () => {
    if (!confirm('Delete this shift? This cannot be undone.')) return;
    await api(`/api/admin/shifts/${s.id}`, { method: 'DELETE' });
    dlg.close(); toast('Shift deleted'); refresh();
  };
  $('#form-shift').onsubmit = async (ev) => {
    if (ev.submitter?.value !== 'save') return;
    ev.preventDefault();
    const body = { employee_id: Number($('#sh-emp').value), date: $('#sh-date').value, in: $('#sh-in').value, out: $('#sh-out').value, break_min: Number($('#sh-break').value) || 0, note: $('#sh-note').value };
    try {
      await api(s ? `/api/admin/shifts/${s.id}` : '/api/admin/shifts', { method: s ? 'PATCH' : 'POST', body });
      dlg.close(); toast(s ? 'Shift updated' : 'Shift added'); refresh();
    } catch (e) { $('#sh-err').textContent = e.message; }
  };
  if (!state.data.employees.length) return toast('Add a team member first', true);
  dlg.showModal();
}

// ---------- team ----------
function renderTeam() {
  const d = state.data;
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>Team</h1><p>${d.employees.filter((e) => e.active).length} active member${d.employees.length === 1 ? '' : 's'}. Each person signs in on their phone with a personal PIN.</p></div>
      <div class="toolbar"><button class="btn btn-primary" id="tm-add">${icons.plus} Add team member</button></div>
    </div>
    <div class="team-cards">${d.employees.length ? d.employees.slice().sort((a, b) => b.active - a.active).map((e) => `
      <div class="card member ${e.active ? '' : 'inactive'}">
        <div class="member-top">${avatar(e, e.onShift ? 'on' : '')}<div style="min-width:0"><div class="nm">${esc(e.name)}</div><div class="rl">${esc(e.role || 'Team member')} · ${money(e.hourly_rate)}/h${e.active ? '' : ' · inactive'}</div></div>
          <button class="btn btn-ghost btn-icon btn-sm" style="margin-left:auto" data-emp="${e.id}" aria-label="Edit ${esc(e.name)}">${icons.edit}</button></div>
        <div class="member-stats"><div><div class="k">Today</div><div class="v">${hours(e.todayMs)}h</div></div><div><div class="k">Week</div><div class="v">${hours(e.weekMs)}h</div></div><div><div class="k">Month</div><div class="v">${hours(e.monthMs)}h</div></div></div>
        ${e.onShift ? `<span class="pill pill-live" style="justify-self:start"><span class="dot"></span>On shift now</span>` : ''}
      </div>`).join('') : `<div class="card empty" style="grid-column:1/-1">No team members yet. Add your first one — they'll appear on the time clock right away.</div>`}</div>`;
  $('#tm-add').onclick = () => openEmp();
  $('#page').querySelectorAll('[data-emp]').forEach((b) => (b.onclick = () => openEmp(d.employees.find((e) => e.id === Number(b.dataset.emp)))));
}
function openEmp(e) {
  const dlg = $('#dlg-emp');
  $('#emp-title').textContent = e ? `Edit ${e.name}` : 'Add team member';
  $('#em-name').value = e?.name || '';
  $('#em-role').value = e?.role || '';
  $('#em-rate').value = e ? e.hourly_rate : 196;
  $('#em-pin').value = '';
  $('#em-pin').required = !e;
  $('#em-pin-label').textContent = e ? 'New PIN (leave empty to keep)' : 'PIN (4–6 digits)';
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
      dlg.close(); toast(e ? 'Saved' : `${body.name} added — they can sign in now`); refresh();
    } catch (err) { $('#em-err').textContent = err.message; }
  };
  dlg.showModal();
}

// ---------- settings ----------
function renderSettings() {
  const d = state.data;
  $('#page').innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p>Business details and security.</p></div></div>
    <div class="settings-grid">
      <form class="card" id="f-company">
        <h2>Business</h2><p>Shown on the time clock.</p>
        <div class="field"><label for="s-company">Business name</label><input class="input" id="s-company" value="${esc(d.company)}" maxlength="60"></div>
        <label class="check"><input type="checkbox" id="s-geo" ${d.geo ? 'checked' : ''}> Record location when employees punch</label>
        <p class="muted" style="margin:0">Timezone: <b>${esc(d.timezone)}</b> (set with the APP_TIMEZONE variable on the server).</p>
        <button class="btn btn-primary" style="justify-self:start">Save</button>
      </form>
      <form class="card" id="f-pass">
        <h2>Admin password</h2><p>Used to open this dashboard.</p>
        <div class="field"><label for="s-cur">Current password</label><input class="input" type="password" id="s-cur" autocomplete="current-password" required></div>
        <div class="field"><label for="s-new">New password</label><input class="input" type="password" id="s-new" autocomplete="new-password" minlength="6" required></div>
        <div class="err" id="s-err"></div>
        <button class="btn btn-primary" style="justify-self:start">Update password</button>
      </form>
    </div>`;
  $('#f-company').onsubmit = async (ev) => {
    ev.preventDefault();
    await api('/api/admin/settings', { method: 'POST', body: { company: $('#s-company').value, geo: $('#s-geo').checked } });
    toast('Settings saved'); refresh();
  };
  $('#f-pass').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'POST', body: { currentPassword: $('#s-cur').value, newPassword: $('#s-new').value } });
      toast('Password updated'); refresh();
    } catch (e) { $('#s-err').textContent = e.message; }
  };
}

addEventListener('hashchange', () => { const p = location.hash.slice(1); if (p && p !== state.page) go(p); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const c = document.getElementById('chart'); if (c && state.page === 'overview') drawChart(c, state.data); }, 150); });
setInterval(() => { if (!document.hidden && !$('#admin').classList.contains('hidden') && !document.querySelector('dialog[open]') && state.page === 'overview') refresh(); }, 60000);
boot();
