import { t, locale, isZh } from './i18n.js';
// Shared helpers for the employee app and the admin dashboard.
export let TZ = 'Asia/Taipei';

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  in: I('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>'),
  out: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  home: I('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  sheet: I('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 4v17"/>'),
  users: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plane: I('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>'),
  bell: I('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  check: I('<path d="M20 6 9 17l-5-5"/>'),
  x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  qr: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
  phone: I('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  mail: I('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
  key: I('<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  download: I('<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  coins: I('<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M15 11.2c3.2.2 6 1.4 6 2.8v4c0 1.7-2.7 3-6 3-2 0-3.8-.5-4.9-1.2"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  cal: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  alert: I('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  pin: I('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  back: I('<path d="m15 18-6-6 6-6"/>'),
  doc: I('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  printer: I('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
  trash: I('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
};

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(t(data.error || `Error ${res.status}`)); e.status = res.status; throw e; }
  return data;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const initials = (name) => (name || '?').trim().split(/\s+/).map((w) => [...w][0]).slice(0, 2).join('').toUpperCase();
export const avatar = (e, cls = '') => `<span class="avatar ${cls}" style="--c:${esc(e.color)}">${esc(initials(e.name))}</span>`;

let fmtTime, fmtDay, fmtKey, fmtHM;
// Rebuilds formatters; call again after the timezone or the language changes.
export function setTimezone(tz) {
  if (tz) TZ = tz;
  fmtTime = new Intl.DateTimeFormat(locale(), { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  fmtDay = new Intl.DateTimeFormat(locale(), { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
  fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  fmtHM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
setTimezone();
addEventListener('langchange', () => setTimezone());
export const time = (ms) => fmtTime.format(ms);
export const hm24 = (ms) => fmtHM.format(ms);
export const dayLabel = (ms) => fmtDay.format(ms);
export const dayKey = (ms) => fmtKey.format(ms);
export const dateLabel = (key, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...opts }).format(new Date(key + 'T00:00:00Z'));
// Formats a clock time in the business timezone with the current language (e.g. "9:00 PM" / "下午9:00").
export const clockNow = (opts) => new Intl.DateTimeFormat(locale(), { timeZone: TZ, ...opts }).format(new Date());

export function dur(ms, { seconds = false } = {}) {
  const x = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = x % 60;
  if (seconds) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return isZh() ? `${h}小時${String(m).padStart(2, '0')}分` : `${h}h ${String(m).padStart(2, '0')}m`;
}
export const hours = (ms, d = 1) => (ms / 3600e3).toFixed(d);
export const money = (n) => 'NT$ ' + Math.round(n).toLocaleString('en-US');
export const worked = (s, now = Date.now()) => Math.max(0, (s.clock_out ?? now) - s.clock_in - (s.break_min || 0) * 60000);

let toastTimer;
export function toast(msg, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------- push notifications ----------
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const keyBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// 'install' (iPhone: add to Home Screen first) | 'unsupported' | 'denied' | 'off' | 'on'
export async function pushStatus() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIOS() && !standalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}
const subscribeUrl = (role) => `/api/push/subscribe${role === 'admin' ? '?role=admin' : ''}`;
// Must be called straight from a tap (browsers only show the permission prompt then).
export async function enablePush(role) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(t('Notifications are blocked. Allow them in your phone settings.'));
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }); }
    catch { const old = await reg.pushManager.getSubscription(); await old?.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }); }
  }
  await api(subscribeUrl(role), { method: 'POST', body: { subscription: sub.toJSON(), lang: isZh() ? 'zh' : 'en' } });
  await api(`/api/push/test${role === 'admin' ? '?role=admin' : ''}`, { method: 'POST', body: {} });
}
// Keeps the server copy current (e.g. after a language change). Silent if notifications are off.
export async function syncPush(role) {
  try {
    if ((await pushStatus()) !== 'on') return;
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    await api(subscribeUrl(role), { method: 'POST', body: { subscription: sub.toJSON(), lang: isZh() ? 'zh' : 'en' } });
  } catch {}
}
export async function disablePush(role) {
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  if (sub) await api(`/api/push/unsubscribe${role === 'admin' ? '?role=admin' : ''}`, { method: 'POST', body: { endpoint: sub.endpoint } });
}

export const LEAVE_TYPES = ['annual', 'personal', 'sick', 'other'];
export const leaveLabel = (type) => t({ annual: 'Annual leave', personal: 'Personal leave', sick: 'Sick leave', other: 'Other leave', comp: 'Comp time off' }[type] || type);
export function leaveRange(r) {
  const o = { month: 'short', day: 'numeric' };
  if (r.type === 'comp') return `${dateLabel(r.start_date, { weekday: 'short', ...o })} · ${t('{n} h', { n: r.hours })}`;
  const days = r.half_day ? t('half day') : r.days === 1 ? t('1 day') : t('{n} days', { n: r.days });
  return `${r.start_date === r.end_date ? dateLabel(r.start_date, { weekday: 'short', ...o }) : `${dateLabel(r.start_date, o)} – ${dateLabel(r.end_date, o)}`} · ${days}`;
}
export const statusPill = (st) => `<span class="pill st-${st === 'revoked' ? 'rejected' : st}"><span class="dot"></span>${t({ pending: 'Waiting for approval', approved: 'Approved', rejected: 'Declined', cancelled: 'Cancelled', revoked: 'Revoked by manager' }[st])}</span>`;

// ---------- shop agreement text ----------
// Renders the small text format used by the agreement: "## " headings, "1. " numbered items, "- " bullets
// (indented bullets nest under the item above), blank-line paragraphs, **bold**.
export function renderDoc(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const out = [];
  let list = null; // { tag: 'ol'|'ul', items: [{ html, sub: [] }] }
  const flush = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((i) => `<li>${i.html}${i.sub.length ? `<ul>${i.sub.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of String(src || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^[-•*]\s+(.*)$/), num = line.match(/^\d+(?:[.)]\s+|、\s*)(.*)$/);
    if (bullet && /^(\s{2,}|\t)/.test(raw) && list?.items.length) { list.items[list.items.length - 1].sub.push(inline(bullet[1])); continue; }
    if (bullet || num) {
      const tag = num ? 'ol' : 'ul';
      if (list && list.tag !== tag) flush();
      (list ||= { tag, items: [] }).items.push({ html: inline((bullet || num)[1]), sub: [] });
      continue;
    }
    if (!line) continue; // a blank line inside a list keeps the list going
    flush();
    if (line.startsWith('## ')) out.push(`<h4>${inline(line.slice(3))}</h4>`);
    else if (line.startsWith('# ')) out.push(`<h3>${inline(line.slice(2))}</h3>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('');
}
// The agreement in the current language, falling back to the other one if a translation is missing
export const docText = (a, zh) => ({
  title: (zh ? a.title_zh : a.title_en) || a.title_en || a.title_zh,
  body: (zh ? a.body_zh : a.body_en) || a.body_en || a.body_zh,
});
