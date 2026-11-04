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

## Put it online

Phones can only install the app over **HTTPS**. Any host that runs Node and keeps a persistent disk will work:

- **Render / Railway / Fly.io**: start command `npm start`. Attach a persistent disk and set `DATA_DIR` to its mount path, e.g. `/var/data`.
- **Your own server or NAS**: run `npm start` behind Caddy or nginx for HTTPS.

Then send staff the link:

- **iPhone (Safari):** Share, then Add to Home Screen.
- **Android (Chrome):** tap **Install** on the screen.

## Brand

- The logo is `public/icons/logo.svg`.
- Every colour is a token at the top of `public/css/app.css`. Change `--parsley-*`, `--honey` and so on there.
- After changing the logo, rebuild the PNG icons with `node scripts/make-icons.js`. This needs Playwright.

## Tests

```bash
npm test
```
