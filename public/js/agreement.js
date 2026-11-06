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
      <span>${esc(company)} · ${lang === 'en' ? `Version ${a.version} · Effective ${day(a.published_at)}` : `文件版本 第 ${a.version} 版 · 生效日期 ${day(a.published_at)}`}</span></div></div>
    <div class="doc">${renderDoc(body)}</div></section>` : '';
  $('#paper').innerHTML = `<div class="paper">
    ${part('zh-Hant-TW', a.title_zh, a.body_zh)}${part('en', a.title_en, a.body_en)}
    <div class="sig">
      <div class="full sec">員工資料 Employee Information</div>
      <div><small>員工姓名 Employee Name</small><b>${esc(e.name)}</b></div>
      <div><small>職位 Position</small>${esc(e.role || '') || '<span class="line"></span>'}</div>
      <div><small>到職日期 Employment Start Date</small>${e.start_date ? esc(e.start_date.replaceAll('-', '/')) : '<span class="line"></span>'}</div>
      <div><small>身分證明文件號碼 Identification Number</small><span class="line"></span></div>
      ${s ? `<div><small>員工簽名 Employee Signature</small><span class="name">${esc(s.signed_name)}</span></div>
        <div><small>日期 Date</small>${when(s.signed_at)}</div>
        <div class="full note">版本 ${a.version} · 已於 App 中勾選「我已閱讀並了解本同意書，並同意遵守。」並輸入姓名簽署。 Version ${a.version} · signed in the app by ticking "I have read and understood this agreement, and I agree to follow it." and typing the name above.</div>`
        : `<div class="full unsigned">尚未簽署 Not signed yet</div>`}
      <div class="full sec">公司 Company</div>
      <div><small>公司代表 Company Representative</small><span class="line"></span></div>
      <div><small>日期 Date</small><span class="line"></span></div>
      <div class="full"><small>公司簽章 Company Stamp</small><span class="stamp"></span></div>
    </div>
    <p class="tagline">PARSLEY Italian Handmade Desserts · 帕斯里義式手工甜點<br><i>Good ingredients. Honest craftsmanship. A team that cares.</i></p>
  </div></div>`;
  document.title = `${a.title_zh || a.title_en} · ${e.name}`;
}

api(emp ? `/api/admin/agreement/signed/${encodeURIComponent(emp)}` : '/api/me/agreement')
  .then((d) => { if (!d.agreement) throw new Error('No agreement yet 尚無員工守則'); render(d); })
  .catch((err) => { $('#paper').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; });
