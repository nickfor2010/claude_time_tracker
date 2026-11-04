import { api, icons, esc, avatar, time, dur, dayKey, dateLabel, worked, toast, registerSW, setTimezone, TZ } from './common.js';

const $ = (s) => document.querySelector(s);
const views = ['team', 'pin', 'punch'];
const show = (v) => views.forEach((n) => $(`#view-${n}`).classList.toggle('hidden', n !== v));
const TARGET_MS = 8 * 3600e3; // ring fills over an 8-hour day
const RING = 691.15;

let me = null;          // /api/me payload
let selected = null;    // employee chosen on the team screen
let pin = '';
let tick;

// ---------- live clock ----------
function paintClock() {
  const now = new Date();
  const t = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(now);
  const d = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  document.querySelectorAll('[data-clock]').forEach((el) => (el.textContent = t));
  document.querySelectorAll('[data-date]').forEach((el) => (el.textContent = d));
  if (me) paintLive();
}

// ---------- team & PIN ----------
async function showTeam() {
  me = null;
  $('#top-right').innerHTML = '';
  const { employees, company, timezone } = await api('/api/team');
  setTimezone(timezone);
  $('#team-grid').innerHTML = employees.length
    ? employees.map((e) => `<button class="team-btn" data-id="${e.id}">${avatar(e)}<span class="nm">${esc(e.name)}</span>${e.role ? `<span class="rl">${esc(e.role)}</span>` : ''}</button>`).join('')
    : `<div class="card empty" style="grid-column:1/-1">No team members yet.<br>Ask your manager to add you in the <a href="/admin">dashboard</a>.</div>`;
  $('#team-grid').onclick = (ev) => {
    const b = ev.target.closest('.team-btn');
    if (!b) return;
    selected = employees.find((e) => e.id === Number(b.dataset.id));
    openPin();
  };
  show('team');
  paintClock();
}

function openPin() {
  pin = '';
  $('#pin-back').innerHTML = `${icons.back} Not you?`;
  $('#pin-who').innerHTML = `${avatar(selected)}<b style="font-size:19px">${esc(selected.name)}</b>`;
  renderDots();
  show('pin');
}
function renderDots() {
  const n = Math.max(4, pin.length);
  $('#pin-dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('');
}
function buildPad() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  $('#pinpad').innerHTML = keys.map((k) => k === 'del' ? `<button class="plain" data-k="del" aria-label="Delete">⌫</button>`
    : k === 'ok' ? `<button class="plain" data-k="ok" style="color:var(--primary)">Enter</button>` : `<button data-k="${k}">${k}</button>`).join('');
  $('#pinpad').onclick = (ev) => { const k = ev.target.closest('button')?.dataset.k; if (k) press(k); };
  document.addEventListener('keydown', (ev) => {
    if ($('#view-pin').classList.contains('hidden')) return;
    if (/^\d$/.test(ev.key)) press(ev.key);
    else if (ev.key === 'Backspace') press('del');
    else if (ev.key === 'Enter') press('ok');
  });
  $('#pin-back').onclick = () => show('team');
}
async function press(k) {
  if (k === 'del') pin = pin.slice(0, -1);
  else if (k === 'ok') return submitPin();
  else if (pin.length < 6) pin += k;
  renderDots();
  if (pin.length === 6) submitPin();
}
async function submitPin() {
  if (pin.length < 4) return;
  try {
    await api('/api/login', { method: 'POST', body: { employeeId: selected.id, pin } });
    navigator.vibrate?.(20);
    await loadMe();
  } catch (e) {
    pin = '';
    renderDots();
    const dots = $('#pin-dots');
    dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
    navigator.vibrate?.([40, 40, 40]);
    toast(e.message, true);
  }
}

// ---------- punch screen ----------
async function loadMe() {
  try {
    me = await api('/api/me');
    me.skew = Date.now() - me.now; // keep the timer honest if the phone clock is off
    setTimezone(me.timezone);
    renderPunch();
    show('punch');
    paintClock();
  } catch (e) {
    if (e.status === 401) return showTeam();
    toast(e.message, true);
  }
}

const serverNow = () => Date.now() - (me?.skew || 0);
// An open shift from an earlier day, or longer than 12 hours, is probably a forgotten clock-out.
const isStale = (s) => !s.clock_out && (dayKey(s.clock_in) !== me.today || serverNow() - s.clock_in > 12 * 3600e3);

function renderPunch() {
  const e = me.employee;
  $('#top-right').innerHTML = `<button class="btn btn-ghost btn-sm" id="signout" title="Sign out">${avatar(e, '')}<span>${esc(e.name.split(' ')[0])}</span></button>`;
  $('#top-right .avatar').style.cssText += ';width:26px;height:26px;font-size:10px';
  $('#signout').onclick = async () => {
    if (!confirm(`Sign out ${e.name} from this phone?`)) return;
    await api('/api/logout', { method: 'POST' });
    showTeam();
  };

  // Week bars
  const max = Math.max(TARGET_MS, ...me.week.map((d) => d.ms));
  $('#week').innerHTML = me.week.map((d) => `
    <div class="b ${d.date === me.today ? 'today' : ''}" title="${dateLabel(d.date)} · ${dur(d.ms)}">
      <div class="bar-track"><div class="bar" data-day="${d.date}" style="height:${(d.ms / max) * 100}%"></div></div>
      <div class="d">${dateLabel(d.date, { weekday: 'narrow' })}</div>
    </div>`).join('');

  // Today timeline
  $('#today').innerHTML = me.todayShifts.length ? me.todayShifts.map((s) => `
    <div class="tl-row">
      <div class="tl-ico">${s.clock_out ? icons.clock : icons.in}</div>
      <div class="tl-main"><div class="t">${time(s.clock_in)} → ${s.clock_out ? time(s.clock_out) : 'now'}</div>
        <div class="s">${s.clock_out ? 'Completed' : 'In progress'}${s.break_min ? ` · ${s.break_min} min break` : ''}${s.edited ? ' · adjusted by manager' : ''}</div></div>
      <div class="tl-dur" ${s.clock_out ? '' : 'data-live-shift'}>${dur(worked(s, serverNow()))}</div>
    </div>`).join('') : `<div class="empty">No punches yet today.</div>`;

  $('#recent').innerHTML = me.recent.length ? me.recent.map((s) => `
    <div class="tl-row">
      <div class="tl-ico">${icons.cal}</div>
      <div class="tl-main"><div class="t">${dateLabel(dayKey(s.clock_in))}</div><div class="s">${time(s.clock_in)} – ${time(s.clock_out)}</div></div>
      <div class="tl-dur">${dur(worked(s))}</div>
    </div>`).join('') : `<div class="empty">Your past shifts will appear here.</div>`;

  paintLive();
}

function paintLive() {
  const now = serverNow();
  const open = me.open;
  const openMs = open ? worked(open, now) : 0;
  // Totals from server were computed at me.now; add time elapsed since then for an open shift.
  const extra = open ? now - me.now : 0;
  const todayMs = me.todayMs + extra;
  $('#st-today').textContent = dur(todayMs);
  $('#st-week').textContent = dur(me.week.reduce((a, d) => a + d.ms, 0) + extra);
  $('#st-month').textContent = dur(me.monthMs + extra);
  $('#ring').style.strokeDashoffset = RING * (1 - Math.min(1, todayMs / TARGET_MS));
  document.querySelectorAll('[data-live-shift]').forEach((el) => (el.textContent = dur(openMs)));
  if (open) {
    const bar = document.querySelector(`.bar[data-day="${me.today}"]`);
    const max = Math.max(TARGET_MS, ...me.week.map((d) => d.ms + (d.date === me.today ? extra : 0)));
    if (bar) bar.style.height = `${((me.week.find((d) => d.date === me.today)?.ms || 0) + extra) / max * 100}%`;
  }

  const btn = $('#punch');
  btn.classList.toggle('is-in', !!open);
  const core = $('#punch-core');
  const html = open
    ? `<span class="lbl">On shift</span><span class="big">${dur(openMs, { seconds: true })}</span><span class="sub">Tap to clock out</span>`
    : `${icons.in}<span class="big">Clock in</span><span class="sub">${me.todayMs ? 'Start another shift' : 'Start your day'}</span>`;
  if (core.innerHTML !== html) core.innerHTML = html;
  btn.setAttribute('aria-label', open ? 'Clock out' : 'Clock in');
  $('#status').innerHTML = open && isStale(open)
    ? `<span class="pill pill-warn"><span class="dot"></span>Still clocked in since ${dateLabel(dayKey(open.clock_in))}, ${time(open.clock_in)}. Forgot? Tell your manager.</span>`
    : open
    ? `<span class="pill pill-live"><span class="dot"></span>Clocked in at ${time(open.clock_in)}</span>`
    : `<span class="pill"><span class="dot"></span>Off the clock</span>`;
}

function getLocation() {
  if (!me?.geo || !navigator.geolocation) return Promise.resolve({});
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}), { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 });
  });
}

async function punch() {
  const btn = $('#punch');
  if (btn.classList.contains('busy')) return;
  if (me.open && worked(me.open, serverNow()) < 60e3 && !confirm('You clocked in less than a minute ago. Clock out anyway?')) return;
  if (me.open && isStale(me.open) && !confirm(`You've been clocked in since ${dateLabel(dayKey(me.open.clock_in))}, ${time(me.open.clock_in)} (${dur(worked(me.open, serverNow()))}).\n\nIf you forgot to clock out, your manager can fix the time. Clock out now anyway?`)) return;
  btn.classList.add('busy');
  try {
    const loc = await getLocation();
    const r = await api('/api/punch', { method: 'POST', body: loc });
    me = { ...r, skew: Date.now() - r.now };
    navigator.vibrate?.(r.action === 'in' ? 30 : [30, 60, 30]);
    toast(r.action === 'in' ? `Clocked in at ${time(r.at)} — buon lavoro!` : `Clocked out at ${time(r.at)} — grazie, see you soon!`);
    renderPunch();
  } catch (e) {
    if (e.status === 401) return showTeam();
    toast(e.status ? e.message : 'No connection — please try again.', true);
  } finally {
    btn.classList.remove('busy');
  }
}

// ---------- install prompt ----------
let deferredPrompt;
function setupInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios) {
    $('#install-text').innerHTML = 'Tap <b>Share</b> then <b>Add to Home Screen</b> for one-tap punching.';
    $('#install-hint').classList.remove('hidden');
  }
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#install-hint').classList.remove('hidden');
    $('#install-btn').classList.remove('hidden');
  });
  $('#install-btn').onclick = async () => {
    deferredPrompt?.prompt();
    await deferredPrompt?.userChoice;
    $('#install-hint').classList.add('hidden');
  };
}

// ---------- boot ----------
buildPad();
setupInstall();
$('#punch').onclick = punch;
paintClock();
clearInterval(tick);
tick = setInterval(paintClock, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) loadMe(); });
loadMe();
registerSW();
