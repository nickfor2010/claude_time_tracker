# Parsley Time 🌿

A time clock for the Parsley team. Staff install it on their phones and tap a button to clock in and out. The manager gets a dashboard showing hours, payroll and timesheets.

- **Employee app** (`/`): installable on iPhone and Android (PWA). Staff pick their name, enter a personal PIN once, and from then on clock in or out with one tap. A live timer, a progress ring for the day, and week and month totals are shown.
- **Manager dashboard** (`/admin`):
  - who is on shift right now
  - hours today, this week and this month
  - estimated payroll
  - a 14-day hours chart
  - timesheets you can edit, with breaks and notes
  - CSV export in the same columns as the payroll sheets
  - team management (PINs, roles, hourly rates)
  - optional location stamp on each punch
- **Runs on Cloudflare (free)** using Workers and a D1 database. It also runs on any server with Node.js 22.13 or newer, which uses Node's built-in SQLite.

## Time off (休假)

Staff tap **Time off → Request** on their phone, then choose the type (annual 特休, personal 事假, sick 病假, other), the dates (or a half day) and a reason. The manager sees a badge and a banner, and approves or declines in **Time off** with an optional reply. The employee sees the answer the next time they open the app.

**Leave balances (假期餘額).** Give each person a start date (到職日) in Team. On the Time off page you then see, per person:
- 特休 earned for the current anniversary year (勞基法 第38條: 6 months 3 days, 1 year 7, 2 years 10, 3 years 14, 5 years 15, then +1 per year from year 10 up to 30), plus used, pending and remaining days;
- when the year ends, with a warning in the last 60 days so unused days get paid out or carried over;
- the next grant;
- sick and personal leave used this year against the legal limits (30 and 14 days).

Part-time staff get a share by weekly hours (40 h = 100%). Staff see their own balance on their phone.

**Carry-over and leave systems.**
- Each member uses either 週年制 (anniversary year) or 曆年制 (calendar year). Switch it in Team.
  - 曆年制 uses the Ministry of Labor's proportional method, so it never gives fewer days than 週年制.
- When a leave year closes with unused 特休, the balances table asks you to settle it (Time off → Leave balances → Manage). You can:
  - **Carry over** (遞延) the days into the current year;
  - **Pay out** the days in a chosen month's payroll (特休未休折算工資, one day's wage each: monthly salary ÷ 30, or daily hours × hourly rate);
  - **Close** the year.
- Manual ± adjustments with a note cover opening balances.

**Paid leave in payroll.** Approved leave is added to the payroll estimate, the Timesheets (as its own rows) and the CSV export. Each leave day pays the person's *paid hours per leave day* (set in Team, default 8) × hourly rate × the percentage for that leave type. The defaults follow common Taiwan practice: annual 100%, sick 50%, personal 0%, other 0%. Change them in Settings → Paid leave. Leave is counted per calendar day of the approved request.

**Phone notifications.** On the Time off page (manager) or under Time off (staff), tap **Turn on** on each phone that should be notified.
- **iPhone (iOS 16.4 or newer):** first add the page to the Home Screen and open it from there. The dashboard installs as its own app, "Parsley 管理".
- **Android:** works in Chrome directly.

Notifications are sent with standard Web Push. No outside service or account is needed, and the keys are created automatically.

## Payroll (薪資)

Each person is either **Hourly** (part-time) or **Monthly salary** (full-time). In **Team**, you also set their hours per work day, work days and monthly insurance deduction.

- **Payroll page.** Every month you see each person's hours, overtime, base pay, extras, deductions and net pay. **Adjust** adds a bonus, insurance or another deduction, plus a note. **Mark paid** locks the payslip and notifies the employee. **Reopen** unlocks it again. **Export CSV** gives the whole month.
- **Overtime.** Hours beyond the daily hours are paid ×1.34 for the first 2 h, then ×1.67. For monthly staff, all hours worked on a non-work day count as overtime.
- **Monthly staff.** The hourly value is salary ÷ 240. Approved leave below 100% pay is deducted, e.g. 事假 is a full day's pay and 病假 is half. Scheduled days with no punches and no leave are flagged but not deducted.
- **National holidays (國定假日).** The Taiwan statutory holidays for 2020–2027 are pre-loaded, including substitute days (補假). Government bridge days (彈性放假) are not included, since they aren't holidays for private employers. You can add or remove dates in Settings → National holidays.
  - A holiday is a paid day off: monthly staff already have it in their salary, and hourly staff get their daily hours paid when it falls on one of their work days.
  - Working on a holiday earns an extra day's wage. Hours beyond the normal day are paid as overtime.
  - Leave days and "missing days" skip holidays.
- **Payslips.** Bilingual (中文 + English) and printable to A4/PDF. Staff see their paid payslips under **Payslips** on their phone.
- **Settings.** Every rate is editable in Settings → Overtime and Paid leave. Please have your accountant confirm them.

## History & import (歷史資料與匯入)

Go to Timesheets → **History & import**.

1. **Fill standard schedule.** Creates shifts for a person over a period (default: from their start date) with their normal hours. Their days off, national holidays, approved leave and days that already have shifts are skipped. You preview the result before anything is created.
2. **Add past leave.** Records leave someone already took as approved, so it counts in balances and payroll. Add it before filling the schedule.
3. **Import CSV.** Brings in shifts from another system, Excel or Google Sheets.
   - Columns are recognised in English or Chinese, and common date/time formats work (2026/8/5, 9:00 AM, 下午1:05…).
   - Files without an employee column (like the old monthly payroll sheets) go to the person you choose, and TOTAL rows are skipped.
   - Every row is checked first, and rows already imported are skipped, so importing the same file twice is safe.

Statutory holidays 2020–2027 are built in, so past holidays are skipped automatically.

## Languages (English / 繁體中文)

Every screen comes in English and Traditional Chinese (Taiwan). A phone set to Chinese opens in Chinese automatically, and the **中文 / EN** button switches language at any time. Each phone or computer remembers its own choice. The CSV export follows the dashboard language. All texts live in `public/js/i18n.js`.

## Fixing mistakes

In **Timesheets**, tap ✏️ on any shift to change the clock-in or clock-out time, add break minutes or a note, or delete it. **+ Add shift** records a shift someone forgot to punch. Edited shifts are marked *edited*, and the employee sees "adjusted by manager".

If someone stays clocked in longer than the warning time (12 hours by default; change it in Settings), or since a previous day, a red warning appears at the top of the dashboard with a **Fix** button. The employee's phone also tells them to contact the manager.

## Put it online with Cloudflare (free)

`wrangler.jsonc` holds all the settings. The first time the app is published, Cloudflare creates the database automatically.

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. Go to **Workers & Pages → Create → Import a repository**. Connect GitHub and choose `claude_time_tracker`.
3. Leave the defaults (deploy command `npx wrangler deploy`) and click **Deploy**.
4. Open the link you get (`https://parsley-time.<your-name>.workers.dev`) and add `/admin` to the end. Sign in with **`parsley`**, then change the password right away under Settings.
5. Add your team under **Team**, then send them the main link:
   - **iPhone (Safari):** Share → Add to Home Screen.
   - **Android (Chrome):** tap **Install**.

Every push to `main` updates the app automatically. Your data stays in the D1 database. Cloudflare keeps 30 days of point-in-time backups (Time Travel), and you can also export a CSV from Timesheets each month.

**Your own domain (optional).** If parsleyhao.com's DNS is on Cloudflare, go to Worker → Settings → Domains & Routes and add, for example, `time.parsleyhao.com`.

## Run it on your computer

```bash
npm start                                   # Node version: http://localhost:3000  (dashboard: /admin)
npm install && npm run dev                  # Cloudflare version, run locally
DATA_DIR=./demo-data npm run demo && DATA_DIR=./demo-data npm start   # preview with sample data (PIN 1234)
```

| Variable | Default | Meaning |
|---|---|---|
| `APP_TIMEZONE` | `Asia/Taipei` | Timezone used to group shifts into days |
| `ADMIN_PASSWORD` | `parsley` | Initial admin password, used on first start only |
| `PORT`, `DATA_DIR` | `3000`, `./data` | Node version only |

## Brand

- Brand colours: vino `#6E1E2E`, cream `#F9F6F1`, orange `#FF7A1A`. App icons are in `public/icons/` (192, 512, 180 Apple, 270) with `public/favicon.ico`; the 404 page is `public/404.html`.
- Every colour is a token at the top of `public/css/app.css`. Change `--vino-*`, `--cream`, `--orange` and so on there.
- After replacing `icon-512.png`, rebuild the Android round-safe icon with `node scripts/make-maskable.cjs` (needs Playwright).

## Tests

```bash
npm test
```
