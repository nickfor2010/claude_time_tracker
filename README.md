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
