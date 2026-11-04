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
- **No dependencies.** It needs only Node.js 22.5 or newer and uses Node's built-in SQLite. There is no `npm install` step.

## Run it

```bash
npm start                    # http://localhost:3000  (dashboard: /admin)
```

The first admin password is **`parsley`**. The dashboard asks you to change it, which you do under Settings. You can also set a password before the first start with `ADMIN_PASSWORD=...`.

To preview with sample data (4 team members, 3 weeks of shifts, every PIN `1234`):

```bash
DATA_DIR=./demo-data npm run demo
DATA_DIR=./demo-data npm start
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Folder for the SQLite database. **Back this up.** |
| `APP_TIMEZONE` | `Asia/Taipei` | Timezone used to group shifts into days |
| `ADMIN_PASSWORD` | `parsley` | Initial admin password, used on first start only |

## Put it online with Render

This repo includes `render.yaml`, which sets everything up for you. It uses the Singapore region (closest to Taiwan), a 1 GB disk for the database, and the Taipei timezone.

1. Sign in at [dashboard.render.com](https://dashboard.render.com) and connect your GitHub account.
2. Click **New → Blueprint**, then choose the `claude_time_tracker` repository and the branch that holds the app.
3. When Render asks for **ADMIN_PASSWORD**, type the password you want for the dashboard.
4. Click **Apply** and wait about 2 minutes. You get a link like `https://parsley-time.onrender.com`.
5. Open `…/admin`, sign in, and add your team under **Team**.
6. Send staff the main link. **iPhone (Safari):** Share → Add to Home Screen. **Android (Chrome):** tap **Install**.

**Plan and cost.** The blueprint uses the **Starter** plan plus a 1 GB disk, about US$7.25 a month. The free plan has no disk, so every shift would be erased on each restart. Free apps also fall asleep when nobody uses them.

**Backups.** Render takes daily snapshots of the disk. For an extra copy, export the CSV from Timesheets each month.

**Your own domain (optional).** To use an address like `time.parsleyhao.com`, go to Render → Settings → Custom Domains and add a CNAME record at your DNS provider. Render adds HTTPS automatically.

## Brand

- The logo is `public/icons/logo.svg`.
- Every colour is a token at the top of `public/css/app.css`. Change `--parsley-*`, `--honey` and so on there.
- After changing the logo, rebuild the PNG icons with `node scripts/make-icons.js`. This needs Playwright.

## Tests

```bash
npm test
```
