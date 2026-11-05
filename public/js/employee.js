import { api, icons, esc, avatar, time, dur, dayKey, dateLabel, worked, money, toast, registerSW, setTimezone, clockNow, pushStatus, enablePush, syncPush, LEAVE_TYPES, leaveLabel, leaveRange, statusPill } from './common.js';
import { t, translatePage, langButton } from './i18n.js';

const $ = (s) => document.querySelector(s);
const views = ['team', 'pin', 'punch'];
const show = (v) => views.forEach((n) => $(`#view-${n}`).classList.toggle('hidden', n !== v));
const TARGET_MS = 8 * 3600e3; // ring fills over an 8-hour day
const RING = 691.15;

let me = null;          // /api/me payload
let leave = [];         // my time-off requests
let payslips = [];      // my paid payslips
let selected = null;    // employee chosen on the team screen
let pin = '';
let tick;

// ---------- live clock ----------
function paintClock() {
  const tm = clockNow({ hour: 'numeric', minute: '2-digit' });
  const d = clockNow({ weekday: 'long', month: 'long', day: 'numeric' });
  document.querySelectorAll('[data-clock]').forEach((el) => (el.textContent = tm));
  document.querySelectorAll('[data-date]').forEach((el) => (el.textContent = d));
  if (me) paintLive();
}

// ---------- team & PIN ----------
let team = [];
async function showTeam() {
  me = null;
  $('#top-right').innerHTML = '';
  const { employees, timezone } = await api('/api/team');
  setTimezone(timezone);
  team = employees;
  renderTeam();
  show('team');
  paintClock();
}
function renderTeam() {
  const employees = team;
  $('#team-grid').innerHTML = employees.length
    ? employees.map((e) => `<button class="team-btn" data-id="${e.id}">${avatar(e)}<span class="nm">${esc(e.name)}</span>${e.role ? `<span class="rl">${esc(e.role)}</span>` : ''}</button>`).join('')
    : `<div class="card empty" style="grid-column:1/-1">${t('No team members yet.<br>Ask your manager to add you in the <a href="/admin">dashboard</a>.')}</div>`;
  $('#team-grid').onclick = (ev) => {
    const b = ev.target.closest('.team-btn');
    if (!b) return;
    selected = employees.find((e) => e.id === Number(b.dataset.id));
    openPin();
  };
}

function openPin() {
  pin = '';
  $('#pin-back').innerHTML = `${icons.back} ${t('Not you?')}`;
  $('#pin-who').innerHTML = `${avatar(selected)}<b style="font-size:19px">${esc(selected.name)}</b>`;
  renderDots();
  show('pin');
}
function renderDots() {
  const n = Math.max(4, pin.length);
  $('#pin-dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('');
}
function buildPadKeys() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  $('#pinpad').innerHTML = keys.map((k) => k === 'del' ? `<button class="plain" data-k="del" aria-label="${t('Delete')}">⌫</button>`
    : k === 'ok' ? `<button class="plain" data-k="ok" style="color:var(--primary)">${t('Enter')}</button>` : `<button data-k="${k}">${k}</button>`).join('');
}
function buildPad() {
  buildPadKeys();
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
    [me, { requests: leave }, { payslips }] = await Promise.all([api('/api/me'), api('/api/leave'), api('/api/payslips')]);
    me.skew = Date.now() - me.now; // keep the timer honest if the phone clock is off
    setTimezone(me.timezone);
    renderPunch();
    show('punch');
    paintClock();
    if (location.hash === '#timeoff') { history.replaceState(null, '', '/'); $('#timeoff').scrollIntoView({ behavior: 'smooth' }); }
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
  $('#top-right').innerHTML = `<button class="btn btn-ghost btn-sm" id="signout" title="${t('Sign out')}">${avatar(e, '')}<span>${esc(e.name.split(' ')[0])}</span></button>`;
  $('#top-right .avatar').style.cssText += ';width:26px;height:26px;font-size:10px';
  $('#signout').onclick = async () => {
    if (!confirm(t('Sign out {name} from this phone?', { name: e.name }))) return;
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
      <div class="tl-main"><div class="t">${time(s.clock_in)} → ${s.clock_out ? time(s.clock_out) : t('now')}</div>
        <div class="s">${s.clock_out ? t('Completed') : t('In progress')}${s.break_min ? ` · ${t('{n} min break', { n: s.break_min })}` : ''}${s.edited ? ` · ${t('adjusted by manager')}` : ''}</div></div>
      <div class="tl-dur" ${s.clock_out ? '' : 'data-live-shift'}>${dur(worked(s, serverNow()))}</div>
    </div>`).join('') : `<div class="empty">${t('No punches yet today.')}</div>`;

  $('#recent').innerHTML = me.recent.length ? me.recent.map((s) => `
    <div class="tl-row">
      <div class="tl-ico">${icons.cal}</div>
      <div class="tl-main"><div class="t">${dateLabel(dayKey(s.clock_in))}</div><div class="s">${time(s.clock_in)} – ${time(s.clock_out)}</div></div>
      <div class="tl-dur">${dur(worked(s))}</div>
    </div>`).join('') : `<div class="empty">${t('Your past shifts will appear here.')}</div>`;

  renderLeave();
  renderPayslips();
  paintLive();
}

function renderPayslips() {
  $('#payslip-block').classList.toggle('hidden', !payslips.length);
  $('#payslip-list').innerHTML = payslips.map((p) => `
    <a class="tl-row" href="/payslip?month=${p.month}" style="color:inherit;text-decoration:none">
      <div class="tl-ico">${icons.coins}</div>
      <div class="tl-main"><div class="t">${dateLabel(p.month + '-01', { month: 'long', year: 'numeric' })}</div><div class="s">${t('Paid')} · ${dateLabel(dayKey(p.paid_at))}</div></div>
      <div class="tl-dur">${money(p.net)}</div>
    </a>`).join('');
}

// ---------- time off ----------
function renderLeave() {
  $('#leave-new').innerHTML = `${icons.plus} ${t('Request')}`;
  // Answers from the manager that this person hasn't seen yet
  $('#leave-notice').innerHTML = (me.leaveNotices || []).map((r) => {
    const ok = r.status === 'approved';
    return `<div class="notice ${ok ? 'ok' : 'no'}" role="status"><span class="ico">${ok ? icons.check : icons.x}</span>
      <div><b>${ok ? t('Your time off was approved') : t('Your time off was declined')}</b>
      <div class="s">${leaveLabel(r.type)} · ${leaveRange(r)}${r.manager_note ? `<br>“${esc(r.manager_note)}”` : ''}</div></div>
      <button class="btn btn-ghost btn-sm" data-seen>${t('OK')}</button></div>`;
  }).join('');
  $('#leave-notice').querySelectorAll('[data-seen]').forEach((b) => (b.onclick = async () => {
    await api('/api/leave/seen', { method: 'POST' }).catch(() => {});
    me.leaveNotices = [];
    $('#leave-notice').innerHTML = '';
  }));

  // My annual leave (特休) balance
  const a = me.balance?.annual;
  const box = $('#my-balance');
  if (a?.status === 'active') {
    const used = a.earned ? Math.min(100, (a.used / a.earned) * 100) : 0, pend = a.earned ? Math.min(100 - used, (a.pending / a.earned) * 100) : 0;
    box.innerHTML = `<div class="bal-top"><span>${t('Annual leave (特休)')}</span><b>${t('{n} days left', { n: a.remaining })}</b></div>
      <div class="bal-bar"><i style="width:${used}%"></i><i class="pend" style="width:${pend}%"></i></div>
      <div class="s">${t('{used} used · {pending} pending · {earned} earned', { used: a.used, pending: a.pending, earned: a.earned })} · ${t('use by {date}', { date: dateLabel(a.to, { year: 'numeric', month: 'short', day: 'numeric' }) })}</div>`;
    box.classList.remove('hidden');
  } else if (a?.status === 'waiting' && a.next) {
    box.innerHTML = `<div class="s">${t('You will earn {n} days of 特休 on {date}.', { n: a.next.days, date: dateLabel(a.next.date, { year: 'numeric', month: 'short', day: 'numeric' }) })}</div>`;
    box.classList.remove('hidden');
  } else box.classList.add('hidden');

  const visible = leave.filter((r) => r.status !== 'cancelled' || r.end_date >= me.today).slice(0, 8);
  $('#leave-list').innerHTML = visible.length ? visible.map((r) => `
    <div class="lv-row">
      <div class="tl-ico">${icons.plane}</div>
      <div class="tl-main"><div class="t">${leaveLabel(r.type)} ${statusPill(r.status)}</div>
        <div class="s">${leaveRange(r)}</div>
        ${r.note ? `<div class="s">${esc(r.note)}</div>` : ''}
        ${r.manager_note ? `<div class="reply">${t('Manager')}: ${esc(r.manager_note)}</div>` : ''}</div>
      ${r.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-cancel="${r.id}">${t('Cancel')}</button>` : ''}
    </div>`).join('') : `<div class="empty">${t('No time-off requests yet.')}</div>`;
  $('#leave-list').querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (!confirm(t('Cancel this request?'))) return;
    try { await api(`/api/leave/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast(t('Request cancelled')); loadMe(); }
    catch (e) { toast(e.message, true); }
  }));
  renderNotifCard();
}

async function renderNotifCard() {
  const card = $('#notif-card');
  const st = await pushStatus().catch(() => 'unsupported');
  const hasPending = leave.some((r) => r.status === 'pending');
  if (st === 'on' || st === 'unsupported' || (!hasPending && st !== 'off')) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  card.innerHTML = st === 'install'
    ? `${icons.bell}<span>${t('To get a notification when your manager replies, add this app to your Home Screen first.')}</span>`
    : st === 'denied'
    ? `${icons.bell}<span>${t('Notifications are blocked. Allow them in your phone settings.')}</span>`
    : `${icons.bell}<span>${t('Get a notification when your manager replies.')}</span><button class="btn btn-primary btn-sm" id="notif-on">${t('Turn on')}</button>`;
  const btn = $('#notif-on');
  if (btn) btn.onclick = async () => {
    try { await enablePush('emp'); toast(t('Notifications are on')); renderNotifCard(); }
    catch (e) { toast(e.message, true); renderNotifCard(); }
  };
}

function openLeave() {
  const tomorrow = new Date(Date.parse(me.today + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10);
  let type = 'annual';
  const paintTypes = () => {
    $('#lv-type').innerHTML = LEAVE_TYPES.map((k) => `<button type="button" role="radio" aria-checked="${k === type}" data-type="${k}">${leaveLabel(k)}</button>`).join('');
    const a = me.balance?.annual;
    $('#lv-bal').classList.toggle('hidden', !(type === 'annual' && a?.status === 'active'));
    if (type === 'annual' && a?.status === 'active') $('#lv-bal').textContent = t('You have {n} days of 特休 left (until {date}).', { n: a.remaining - a.pending, date: dateLabel(a.to, { month: 'short', day: 'numeric' }) });
  };
  paintTypes();
  $('#lv-type').onclick = (ev) => { const b = ev.target.closest('[data-type]'); if (b) { type = b.dataset.type; paintTypes(); } };
  $('#lv-start').value = tomorrow; $('#lv-end').value = tomorrow; $('#lv-start').min = me.today;
  $('#lv-half').checked = false; $('#lv-note').value = ''; $('#lv-err').textContent = '';
  const syncHalf = () => {
    if ($('#lv-end').value < $('#lv-start').value) $('#lv-end').value = $('#lv-start').value;
    $('#lv-end').min = $('#lv-start').value;
    $('#lv-half-wrap').classList.toggle('hidden', $('#lv-start').value !== $('#lv-end').value);
  };
  $('#lv-start').onchange = syncHalf; $('#lv-end').onchange = syncHalf; syncHalf();
  $('#form-leave').onsubmit = async (ev) => {
    if (ev.submitter?.value !== 'save') return;
    ev.preventDefault();
    try {
      await api('/api/leave', { method: 'POST', body: { type, start: $('#lv-start').value, end: $('#lv-end').value, half: $('#lv-half').checked, note: $('#lv-note').value } });
      $('#dlg-leave').close();
      toast(t('Request sent to your manager'));
      await loadMe();
    } catch (e) { $('#lv-err').textContent = e.message; }
  };
  $('#dlg-leave').showModal();
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
    ? `<span class="lbl">${t('On shift')}</span><span class="big">${dur(openMs, { seconds: true })}</span><span class="sub">${t('Tap to clock out')}</span>`
    : `${icons.in}<span class="big">${t('Clock in')}</span><span class="sub">${me.todayMs ? t('Start another shift') : t('Start your day')}</span>`;
  if (core.innerHTML !== html) core.innerHTML = html;
  btn.setAttribute('aria-label', open ? t('Clock out') : t('Clock in'));
  $('#status').innerHTML = open && isStale(open)
    ? `<span class="pill pill-warn"><span class="dot"></span>${t('Still clocked in since {d}, {t}. Forgot? Tell your manager.', { d: dateLabel(dayKey(open.clock_in)), t: time(open.clock_in) })}</span>`
    : open
    ? `<span class="pill pill-live"><span class="dot"></span>${t('Clocked in at {t}', { t: time(open.clock_in) })}</span>`
    : `<span class="pill"><span class="dot"></span>${t('Off the clock')}</span>`;
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
  if (me.open && worked(me.open, serverNow()) < 60e3 && !confirm(t('You clocked in less than a minute ago. Clock out anyway?'))) return;
  if (me.open && isStale(me.open) && !confirm(t("You've been clocked in since {d}, {t} ({dur}).\n\nIf you forgot to clock out, your manager can fix the time. Clock out now anyway?", { d: dateLabel(dayKey(me.open.clock_in)), t: time(me.open.clock_in), dur: dur(worked(me.open, serverNow())) }))) return;
  btn.classList.add('busy');
  try {
    const loc = await getLocation();
    const r = await api('/api/punch', { method: 'POST', body: loc });
    me = { ...r, skew: Date.now() - r.now };
    navigator.vibrate?.(r.action === 'in' ? 30 : [30, 60, 30]);
    toast(r.action === 'in' ? t('Clocked in at {t} — buon lavoro!', { t: time(r.at) }) : t('Clocked out at {t} — grazie, see you soon!', { t: time(r.at) }));
    renderPunch();
  } catch (e) {
    if (e.status === 401) return showTeam();
    toast(e.status ? e.message : t('No connection — please try again.'), true);
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
    $('#install-text').removeAttribute('data-i18n');
    $('#install-text').setAttribute('data-i18n-html', '');
    $('#install-text').dataset.i18nSrc = 'Tap <b>Share</b> then <b>Add to Home Screen</b> for one-tap punching.';
    translatePage();
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

// ---------- language ----------
function rerender() {
  buildPadKeys();
  if (!$('#view-team').classList.contains('hidden')) renderTeam();
  if (!$('#view-pin').classList.contains('hidden')) $('#pin-back').innerHTML = `${icons.back} ${t('Not you?')}`;
  if (me) renderPunch();
  paintClock();
}
addEventListener('langchange', () => { rerender(); if (me) syncPush('emp'); });

// ---------- boot ----------
translatePage();
$('#lang-slot').replaceWith(langButton());
buildPad();
setupInstall();
$('#punch').onclick = punch;
$('#leave-new').onclick = () => me && openLeave();
paintClock();
clearInterval(tick);
tick = setInterval(paintClock, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) loadMe(); });
loadMe();
registerSW();
