// English + Traditional Chinese (Taiwan). Each device remembers its own choice.
const STORE_KEY = 'parsley-lang';

const zh = {
  // shared
  'Time clock': '打卡',
  'Manager dashboard': '管理後台',
  'Team time': '團隊工時',
  'Manager': '管理者',
  'Italian passion': '義式熱情',
  'Save': '儲存',
  'Cancel': '取消',
  'Delete': '刪除',
  'Sign out': '登出',
  'No connection — please try again.': '沒有網路連線，請再試一次。',
  'Server error': '伺服器錯誤',

  // employee app
  "Who's clocking in?": '誰要打卡？',
  'Tap your name, then enter your PIN.': '點選你的名字，再輸入密碼。',
  'Add to Home Screen': '加入主畫面',
  'Install Parsley Time for one-tap punching.': '安裝 Parsley 打卡，一鍵就能打卡。',
  'Tap <b>Share</b> then <b>Add to Home Screen</b> for one-tap punching.': '點選<b>分享</b>，再選<b>加入主畫面</b>，以後一鍵打卡。',
  'Install': '安裝',
  'No team members yet.<br>Ask your manager to add you in the <a href="/admin">dashboard</a>.': '還沒有員工。<br>請管理者在<a href="/admin">管理後台</a>新增你。',
  'Not you?': '不是你？',
  'Enter your PIN': '請輸入密碼',
  'Enter': '確認',
  'Today': '今天',
  'This week': '本週',
  'This month': '本月',
  'Recent shifts': '最近班次',
  'now': '現在',
  'Completed': '已完成',
  'In progress': '進行中',
  '{n} min break': '休息 {n} 分鐘',
  'adjusted by manager': '已由管理者調整',
  'No punches yet today.': '今天還沒有打卡紀錄。',
  'Your past shifts will appear here.': '你過去的班次會顯示在這裡。',
  'On shift': '上班中',
  'Tap to clock out': '點一下下班打卡',
  'Clock in': '上班打卡',
  'Clock out': '下班打卡',
  'Start your day': '開始今天的工作',
  'Start another shift': '開始另一個班次',
  'Clocked in at {t}': '{t} 上班打卡',
  'Off the clock': '未打卡',
  'Still clocked in since {d}, {t}. Forgot? Tell your manager.': '從 {d} {t} 起仍在上班中。忘記打卡了嗎？請告訴管理者。',
  'Sign out {name} from this phone?': '要將 {name} 從這支手機登出嗎？',
  'You clocked in less than a minute ago. Clock out anyway?': '你不到一分鐘前才上班打卡，確定要下班打卡嗎？',
  "You've been clocked in since {d}, {t} ({dur}).\n\nIf you forgot to clock out, your manager can fix the time. Clock out now anyway?": '你從 {d} {t} 起一直是上班狀態（{dur}）。\n\n如果你忘記下班打卡，管理者可以幫你修改時間。仍要現在下班打卡嗎？',
  'Clocked in at {t} — buon lavoro!': '{t} 上班打卡成功 — buon lavoro！工作順利！',
  'Clocked out at {t} — grazie, see you soon!': '{t} 下班打卡成功 — grazie，辛苦了！',

  // admin: login & nav
  'Welcome back': '歡迎回來',
  'Admin password': '管理者密碼',
  'Sign in': '登入',
  '← Back to the time clock': '← 回到打卡頁面',
  'Overview': '總覽',
  'Timesheets': '工時紀錄',
  'Team': '團隊',
  'Settings': '設定',
  'Open time clock': '開啟打卡頁面',
  '<b>{n}</b> of {total} on shift now': '目前 <b>{n}</b> / {total} 人上班中',

  // admin: banners
  '<b>{name}</b> has been clocked in for {dur} (since {since}). Forgot to clock out?': '<b>{name}</b> 已連續上班 {dur}（自 {since} 起）。忘記下班打卡了嗎？',
  'Fix': '修正',
  "You're using the default admin password. Please change it.": '你正在使用預設的管理者密碼，請盡快更改。',
  'Change now': '立即更改',

  // admin: overview
  'Buongiorno': 'Buongiorno 早安',
  'Buon pomeriggio': 'Buon pomeriggio 午安',
  'Buonasera': 'Buonasera 晚安',
  '{greet}, Chef': '{greet}，主廚',
  "Here's how the team is doing today.": '今天團隊的狀況。',
  'Add shift': '新增班次',
  'On shift now': '目前上班中',
  'Nobody clocked in': '目前沒有人上班',
  'Hours today': '今日工時',
  'Hours this week': '本週工時',
  'Since Monday': '從週一起算',
  'Payroll this month': '本月薪資',
  '{h} h worked · estimate': '已工作 {h} 小時 · 估算',
  'h': '小時',
  'Hours per day': '每日工時',
  'Last 14 days': '最近 14 天',
  'Team today': '今日團隊',
  '{n} working': '{n} 人上班中',
  'No clock-out since {since}': '自 {since} 起未下班打卡',
  'In since {t}': '{t} 上班',
  'Worked {dur} today': '今天已工作 {dur}',
  'Not in today': '今天未上班',
  'Add your team to get started.': '新增你的團隊成員開始使用。',
  'Add team member': '新增員工',
  'This week by person': '本週個人工時',
  'Mon – today': '週一至今',
  'Employee': '員工',
  'Week': '本週',
  'Month': '本月',
  'Month pay': '本月薪資',
  'No team members yet.': '還沒有員工。',
  'Recent activity': '最新動態',
  'IN': '上班',
  'OUT': '下班',
  'Punches will show up here.': '打卡紀錄會顯示在這裡。',
  'No hours recorded in the last 14 days.': '最近 14 天沒有工時紀錄。',
  'No hours': '沒有工時',
  'Total': '合計',
  'Stacked bar chart of hours worked per day for the last 14 days': '最近 14 天每日工時堆疊長條圖',

  // admin: timesheets
  '{month} · {n} shifts': '{month} · {n} 個班次',
  '{month} · 1 shift': '{month} · 1 個班次',
  'Everyone': '所有人',
  'Export CSV': '匯出 CSV',
  '{n} days · {pay}': '{n} 天 · {pay}',
  'Date': '日期',
  'In': '上班',
  'Out': '下班',
  'Break': '休息',
  'Worked': '工時',
  'Pay': '薪資',
  'Note': '備註',
  'CHECK · NO CLOCK-OUT': '請確認 · 未下班打卡',
  'ON SHIFT': '上班中',
  'edited': '已修改',
  'Edit shift': '修改班次',
  'No shifts in {month}.': '{month} 沒有班次。',
  'Clock-in location': '上班打卡位置',

  // admin: shift dialog
  'Add clock-out for {name}': '補登 {name} 的下班時間',
  'Clocked in {d} at {t}. Enter the time they really left.': '{d} {t} 上班打卡。請輸入實際下班時間。',
  'Forgot to clock out': '忘記下班打卡',
  'Break (min)': '休息（分鐘）',
  'e.g. forgot to clock out': '例如：忘記下班打卡',
  'Delete this shift? This cannot be undone.': '確定要刪除這個班次嗎？刪除後無法復原。',
  'Shift deleted': '班次已刪除',
  'Shift updated': '班次已更新',
  'Shift added': '班次已新增',
  'Add a team member first': '請先新增員工',

  // admin: team
  '{n} active members. Each person signs in on their phone with a personal PIN.': '{n} 位在職員工。每個人用自己的密碼在手機上登入。',
  'Team member': '員工',
  'inactive': '已停用',
  'Edit {name}': '編輯 {name}',
  "No team members yet. Add your first one — they'll appear on the time clock right away.": '還沒有員工。新增第一位員工後，他們會立刻出現在打卡頁面。',
  'Name': '姓名',
  'Role': '職位',
  'Pastry chef': '甜點師',
  'Hourly rate (NT$)': '時薪（NT$）',
  'PIN (4–6 digits)': '密碼（4–6 位數字）',
  'New PIN (leave empty to keep)': '新密碼（留空則不變更）',
  'Active (can clock in)': '在職（可以打卡）',
  'Saved': '已儲存',
  '{name} added — they can sign in now': '已新增 {name}，現在就可以登入打卡',

  // admin: settings
  'Business details and security.': '商家資訊與安全性。',
  'Business': '商家',
  'Shown on the time clock.': '顯示在打卡頁面。',
  'Business name': '商家名稱',
  'Record location when employees punch': '員工打卡時記錄位置',
  'Warn me when someone is clocked in longer than (hours)': '員工連續上班超過幾小時要提醒我',
  'Timezone: <b>{tz}</b> (set with the APP_TIMEZONE variable on the server).': '時區：<b>{tz}</b>（在伺服器的 APP_TIMEZONE 設定）。',
  'Used to open this dashboard.': '用來登入這個管理後台。',
  'Current password': '目前密碼',
  'New password': '新密碼',
  'Update password': '更新密碼',
  'Settings saved': '設定已儲存',
  'Password updated': '密碼已更新',
  'Language': '語言',

  // server error messages
  'Wrong PIN': '密碼錯誤',
  'Wrong password': '密碼錯誤',
  'Too many attempts. Try again in 15 minutes.': '嘗試次數過多，請 15 分鐘後再試。',
  'Not signed in': '尚未登入',
  'Name is required': '請輸入姓名',
  'PIN must be 4–6 digits': '密碼必須是 4–6 位數字',
  'Employee not found': '找不到這位員工',
  'Choose an employee': '請選擇員工',
  'Date and clock-in time are required': '請輸入日期和上班時間',
  'Invalid clock-out time': '下班時間格式錯誤',
  'Shift not found': '找不到這個班次',
  'Current password is wrong': '目前密碼錯誤',
  'New password needs at least 6 characters': '新密碼至少需要 6 個字元',
  'Warning time must be between 1 and 24 hours': '提醒時間必須介於 1 到 24 小時之間',
  // time off
  'Time off': '休假',
  'Request': '申請',
  'Request time off': '申請休假',
  'Type': '假別',
  'From': '開始',
  'To': '結束',
  'Half day only': '只請半天',
  'Reason (optional)': '原因（選填）',
  'Send request': '送出申請',
  'Annual leave': '特休',
  'Personal leave': '事假',
  'Sick leave': '病假',
  'Other leave': '其他休假',
  'half day': '半天',
  '1 day': '1 天',
  '{n} days': '{n} 天',
  'Waiting for approval': '等待核准',
  'Approved': '已核准',
  'Declined': '未核准',
  'Cancelled': '已取消',
  'Your time off was approved': '你的休假已核准',
  'Your time off was declined': '你的休假未核准',
  'OK': '知道了',
  'No time-off requests yet.': '還沒有休假申請。',
  'Cancel this request?': '要取消這個申請嗎？',
  'Request cancelled': '申請已取消',
  'Request sent to your manager': '已將申請送給管理者',
  'To get a notification when your manager replies, add this app to your Home Screen first.': '想在管理者回覆時收到通知，請先把這個 App 加入主畫面。',
  'Notifications are blocked. Allow them in your phone settings.': '通知已被封鎖，請到手機設定中允許通知。',
  'Get a notification when your manager replies.': '管理者回覆時通知我。',
  'Turn on': '開啟',
  'Notifications are on': '通知已開啟',
  '{n} waiting': '{n} 件待處理',
  '1 time-off request is waiting for you.': '有 1 件休假申請等你處理。',
  '{n} time-off requests are waiting for you.': '有 {n} 件休假申請等你處理。',
  'Review': '查看',
  'On leave today': '今天休假',
  'Requests from your team. Approve or decline — they get notified right away.': '團隊的休假申請。核准或不核准後，員工會立刻收到通知。',
  'Waiting for you': '待處理',
  'Asked {when}': '申請時間 {when}',
  'Reply (optional)': '回覆（選填）',
  'Decline': '不核准',
  'Approve': '核准',
  'No requests waiting. 🎉': '目前沒有待處理的申請 🎉',
  'Coming up': '即將休假',
  'No approved time off coming up.': '近期沒有已核准的休假。',
  'History': '紀錄',
  'Nothing yet.': '目前沒有紀錄。',
  'Approved — {name} will be notified': '已核准，將通知 {name}',
  'Declined — {name} will be notified': '未核准，將通知 {name}',
  'Dates': '日期',
  'Status': '狀態',
  'Reply': '回覆',
  'Notifications are on for this device.': '這個裝置的通知已開啟。',
  'Send a test': '傳送測試通知',
  'Test sent': '測試通知已送出',
  'On iPhone: tap Share → Add to Home Screen, open the dashboard from there, then turn on notifications.': 'iPhone：點選分享 → 加入主畫面，從主畫面打開管理後台，再開啟通知。',
  'This browser cannot show notifications. Check this page for new requests.': '這個瀏覽器無法顯示通知，請在這個頁面查看新申請。',
  'Get a notification on this device when someone asks for time off.': '有人申請休假時，在這個裝置上通知我。',
  'Choose a type of leave': '請選擇假別',
  'Choose the dates': '請選擇日期',
  'The end date is before the start date': '結束日期早於開始日期',
  'A request can be at most 60 days': '每次申請最多 60 天',
  'Request not found': '找不到這個申請',
  'Only a pending request can be cancelled': '只能取消尚未核准的申請',
  'This request was cancelled': '這個申請已被取消',
  'Invalid decision': '無效的操作',
  'Invalid subscription': '通知設定無效',
  'incl. {pay} paid leave': '含帶薪假 {pay}',
  'incl. {n} days paid leave ({pay})': '含帶薪假 {n} 天（{pay}）',
  'Paid leave {pct}%': '帶薪假 {pct}%',
  'Paid leave': '帶薪假',
  'How much of the normal pay each type of approved leave earns. It is added to payroll and the CSV export.': '已核准的各種假別可領取正常薪資的比例，會自動計入薪資和 CSV 匯出。',
  'Common in Taiwan: annual leave 100%, sick leave 50%, personal leave unpaid. Paid hours per leave day are set for each person in Team.': '台灣常見做法：特休 100%、病假 50%、事假不支薪。每位員工每個休假日的給薪時數在「團隊」中設定。',
  'Paid hours per leave day': '每個休假日給薪時數',
  '{h}h per leave day': '休假日 {h} 小時',
  'Leave pay must be between 0 and 100%': '給薪比例必須介於 0 到 100% 之間',
};

export function getLang() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {}
  return /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
}
let lang = getLang();

export const isZh = () => lang === 'zh';
export const locale = () => (lang === 'zh' ? 'zh-TW' : 'en-US');

// t('Clocked in at {t}', { t: '9:00' })
export function t(key, vars = {}) {
  let s = (lang === 'zh' && zh[key]) || key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}

// Static markup: data-i18n (text), data-i18n-html, data-i18n-placeholder, data-i18n-aria-label, data-i18n-title.
export function translatePage(root = document) {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant-TW' : 'en';
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.dataset.i18nSrc ??= el.textContent.trim();
    el.textContent = t(el.dataset.i18nSrc);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.dataset.i18nSrc ??= el.innerHTML.trim();
    el.innerHTML = t(el.dataset.i18nSrc);
  });
  for (const attr of ['placeholder', 'aria-label', 'title']) {
    root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`))));
  }
}

export function setLang(next) {
  lang = next === 'zh' ? 'zh' : 'en';
  try { localStorage.setItem(STORE_KEY, lang); } catch {}
  translatePage();
  dispatchEvent(new CustomEvent('langchange', { detail: lang }));
}

// A small "中文 / EN" switch. Shows the language you can switch TO.
export function langButton(extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn btn-ghost btn-sm lang-btn ${extraClass}`;
  const paint = () => {
    b.textContent = lang === 'zh' ? 'EN' : '中文';
    b.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切換成中文');
    b.title = b.getAttribute('aria-label');
  };
  paint();
  b.onclick = () => setLang(lang === 'zh' ? 'en' : 'zh');
  addEventListener('langchange', paint);
  return b;
}
