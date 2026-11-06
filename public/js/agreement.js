// Printable staff agreement (中文 then English) with the signature record.
// /agreement → the signed-in employee's own copy; /agreement?emp=ID → the manager's copy for that person.
import { api, esc, renderDoc } from './common.js';

const emp = new URLSearchParams(location.search).get('emp');
const $ = (s) => document.querySelector(s);
const TZ = 'Asia/Taipei';
const when = (ms) => new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, dateStyle: 'long', timeStyle: 'short' }).format(ms);
const day = (ms) => new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, dateStyle: 'long' }).format(ms);

$('#back').href = emp ? '/admin#team' : '/';
$('#back').textContent = emp ? '← 團隊 Team' : '← 打卡 Time clock';
$('#print').onclick = () => print();

function render({ agreement: a, signature: s, employee: e, company }) {
  const part = (lang, title, body) => body ? `<section class="lang-part" lang="${lang}">
    <div class="head"><img src="/icons/icon-192.png" alt=""><div><h1>${esc(title)}</h1>
      <span>${esc(company)} · ${lang === 'en' ? `Version ${a.version} · ${day(a.published_at)}` : `第 ${a.version} 版 · ${day(a.published_at)}`}</span></div></div>
    <div class="doc">${renderDoc(body)}</div></section>` : '';
  $('#paper').innerHTML = `<div class="paper">
    ${part('zh-Hant-TW', a.title_zh, a.body_zh)}${part('en', a.title_en, a.body_en)}
    <div class="sig">
      <div><small>員工 Employee</small><b>${esc(e.name)}</b>${e.role ? ` · ${esc(e.role)}` : ''}</div>
      <div><small>版本 Version</small><b>${a.version}</b></div>
      ${s ? `<div class="full"><small>簽名 Signature</small><span class="name">${esc(s.signed_name)}</span></div>
        <div class="full"><small>簽署時間 Signed</small>${when(s.signed_at)} — 已於 App 中勾選「我已閱讀並了解本同意書，並同意遵守。」 Confirmed in the app: "I have read and understood this agreement, and I agree to follow it."</div>`
        : `<div class="full unsigned">尚未簽署 Not signed yet</div>`}
    </div></div>`;
  document.title = `${a.title_zh || a.title_en} · ${e.name}`;
}

api(emp ? `/api/admin/agreement/signed/${encodeURIComponent(emp)}` : '/api/me/agreement')
  .then((d) => { if (!d.agreement) throw new Error('No agreement yet 尚無員工守則'); render(d); })
  .catch((err) => { $('#paper').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; });
