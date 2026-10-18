# Frontdesk — hotel management system

A working hotel management system (PMS) for the front office, housekeeping and management:
bookings, check-in and check-out, room status, housekeeping task sheets, guest profiles, a
14-night tape chart, staff logins with roles, an **admin panel** and an end-of-day **night audit**.

It keeps the exact look of the *Frontdesk* template by uiCookies. Every page is now drawn
by the server from a real database, and every change is saved.

- **Stack:** Node.js (22.13 or newer) · Express · EJS templates · SQLite (built into Node, nothing to install)
- **Runs anywhere Node runs:** your laptop, a VPS, Render, Railway…
- **No build step:** plain HTML, CSS and JavaScript in the browser

---

## Quick start

```bash
npm install
npm start
```

Open <http://localhost:3000>. The first start creates `data/frontdesk.db` and loads the demo
hotel (The Harlow Hotel, 48 rooms, about 560 bookings).

**Demo sign-in:** `elena.marsh@example.com` with the password `harlow-demo`.

| Demo account | Role | Can use |
|---|---|---|
| elena.marsh@example.com | Admin | Everything, including hotel settings and staff accounts |
| gus.palmer@example.com | Manager | Front office and the admin panel (rooms, rates, guests, activity log, night audit) |
| rosa.soto@example.com, jonas.reyes@example.com | Front desk | Dashboard, reservations, tape chart, guests, rooms, housekeeping |
| marisol.vega@example.com (and 4 more) | Housekeeping | Room board and housekeeping task sheets |

All demo accounts share the password `harlow-demo` (change it with `DEMO_PASSWORD`).
**Change these passwords before real use** (see below).

## What the system does

| Page | What you can do |
|---|---|
| **Dashboard** | Tonight’s occupancy, ADR and RevPAR (worked out from the bookings), arrivals with one-click **check-in**, departures with open balances, live room status, housekeeping progress, shift handover notes, 12-week revenue |
| **Reservations** | Search and filter bookings, export CSV, and create a **new booking**. The server checks availability for every night, picks a free room, prices the stay (rate plan, extras, tax) and saves it |
| **Booking page** (click a guest name) | Change dates, room, rate, guests and notes; take a **payment**; **check in**, **check out** (the folio must be settled) or **cancel**. Every change is logged |
| **Tape chart** | 48 rooms × 14 nights. Click a stay for details, check-in or confirmation |
| **Rooms** | Flip rooms clean or dirty, and assign housekeepers (saved instantly) |
| **Housekeeping** | Tick tasks off. Finishing a clean marks the room clean. Includes printable task sheets |
| **Guests** | Profiles with contact details, preferences, notes and stay history. Press Enter in the search box to search every guest. Edit a profile from the booking page or from *Admin → Guests* |
| **Shift handover** | Notes for the next shift (*account menu → Add a handover note*) |

### Admin panel

Open it from the **account menu** (click your name, top right) → **Admin panel**, or go to `/admin`.

- **Hotel settings** (admins): name, city, contact details, GSTIN, currency (₹ / $ / …), number format,
  tax rule (**one flat rate**, **India GST on rooms**, or **none**), check-in/out times, time zone,
  shift hours, business date.
- **Room types:** name, base rate, how many guests it sleeps, cleaning times.
- **Rooms:** add or change rooms; take a room **out of order** for a period and put it back in service.
- **Rates & extras:** rate plans (e.g. Bed & breakfast +₹500/night, Advance purchase −12%) and extras (airport transfer, parking…).
- **Booking sources:** walk-in, phone, website, OTAs; choose which appear on the booking form.
- **Staff accounts** (admins): add people with a role and a temporary password (they must choose their own at
  first sign-in), reset passwords, or deactivate accounts. You can’t remove the last admin or lock yourself out.
- **Guests:** search and edit every profile.
- **Activity log:** who did what and when.
- **Night audit:** at the end of the day, check that no one is left to check in or out, enter restaurant and spa
  revenue, then **close the day**. This saves the day’s occupancy, ADR, RevPAR and revenue (used by the dashboard
  trends), optionally marks no-shows, moves the business date on and creates the next day’s housekeeping tasks.

## Setting it up for a real hotel

1. Start with an empty hotel and your own admin account:
   ```bash
   npm run seed -- --force --empty --admin-email you@yourhotel.com --admin-name "Your Name" --hotel "Your Hotel"
   ```
   The command prints a one-time password. You’ll be asked to change it at first sign-in.
2. In **Admin → Hotel settings**, set the name, city, GSTIN, currency (for India: `INR`, `₹`, number format *India*),
   tax rule (*India GST on rooms*), time zone (`Asia/Kolkata`), check-in/out times and **business date → Follow today’s date**.
3. Add **room types**, then **rooms**, then **rate plans**, **extras** and **booking sources**.
4. Add a **staff account** for each person, with the right role.

> GST bands built in (from 22 Sep 2025): rooms under ₹1,000/night 0%, up to ₹7,500 5%, above ₹7,500 18%.
> Confirm the current rules with your accountant.

## Configuration

Settings are environment variables (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where the server listens |
| `DB_PATH` | `./data/frontdesk.db` | The database file. **Back up this folder** |
| `NODE_ENV` | — | Set to `production` on a live server (secure cookies, HSTS) |
| `TRUST_PROXY` | off | Set to `1` behind a proxy or load balancer (Render, Railway, nginx) |
| `COOKIE_SECURE` | on in production | Cookies only over HTTPS |
| `SESSION_IDLE_MINUTES` | `30` | Sign out after this long idle (unless *Keep me signed in*) |
| `SESSION_REMEMBER_DAYS` | `30` | Length of *Keep me signed in* |
| `DEMO_PASSWORD` | `harlow-demo` | Password for the demo accounts |
| `HMS_NOW` | — | Freeze the hotel clock, e.g. `2026-09-24T10:42` (demos and tests only) |
| `EMBED_PREVIEW`, `PREVIEW_BAR` | — | Development only: allow framing by a preview panel; `/` shows a Desktop/Tablet/Mobile bar |

### Going live (any Node host)

- Run `npm ci --omit=dev && npm start` with `NODE_ENV=production`, `TRUST_PROXY=1` and HTTPS in front.
- Give the app a **persistent disk** for `data/` (on Render or Railway, attach a volume and point `DB_PATH` at it).
- Back up regularly: `npm run backup` writes a consistent copy to `backups/` (safe while the app runs).
- Shared hosting that only serves PHP or plain HTML files won’t run this app. It needs Node.js.

## Security

- Passwords are hashed with scrypt. A first password set by an admin must be changed at first sign-in.
- Sessions are stored server-side; only a hash of the cookie is kept. Cookies are HttpOnly and SameSite.
  Sessions end after 30 minutes idle on shared workstations.
- Every form and API call carries a CSRF token, and the login form has its own.
- Five wrong passwords lock the account for 15 minutes.
- Roles are checked on the server for every page and action: admin, manager, front desk, housekeeping.
- All database queries are parameterised, and all output is escaped.
- A strict Content-Security-Policy (no inline scripts) is applied, plus `nosniff`, `Referrer-Policy` and frame protection.
- Every change is written to the activity log.
- The database (`data/`) holds guest personal data. It is git-ignored; keep it private and backed up.
  India’s DPDP Act applies to guest data.

## Tests

```bash
npm test
```

22 end-to-end tests run against a fresh demo hotel. They cover:
- sign-in, lockout, CSRF and redirect safety;
- roles;
- booking creation and pricing, availability and validation;
- check-in and check-out rules;
- room and task updates;
- the admin screens and the night audit;
- HTML escaping.

## Project structure

```
server/
  index.js            start-up (creates and seeds the database on first run)
  app.js              Express app: security headers, sessions, routes, error pages
  config.js           environment settings
  db/                 schema.sql, seed.js (demo or empty hotel), backup.js, demo-data.json
  lib/                auth (passwords, sessions), security (CSP, CSRF, roles), forms, pricing, formatting, clock, activity log
  services/           business logic: reservations, rooms, guests, housekeeping, dashboard, stats, night audit, settings
  routes/             pages, bookings, admin panel, JSON API, sign-in
  views/              EJS templates (same markup as the original design) and the admin panel
assets/               CSS, browser JavaScript, fonts and images
test/                 end-to-end tests (node:test)
```

## Not included yet (next steps)

- Guest Registration Card (GRC) and ID-proof capture at check-in.
- Form III (formerly Form C) reminders for foreign guests.
- GST invoices and bill printing; online payments.
- Email and SMS confirmations; password-reset email.
- Channel manager (OTA sync); a guest-facing booking website.
- Multiple properties: the property switcher shows only the current hotel.

## Credits

- Design: *Frontdesk*, a free hotel management dashboard template by
  [uiCookies](https://uicookies.com/) (free for personal and commercial use,
  [license](https://uicookies.com/license/)). The code in this repository is a fresh implementation.
- Fonts: [Manrope](https://github.com/sharanda/manrope) and
  [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant), SIL Open Font License 1.1, self-hosted.
- Photo: "Hotel Lobby", CC0 1.0, via [rawpixel](https://www.rawpixel.com/image/5969494/hotel-lobby).
- Demo data is fictional.

## License

The code is released under the [MIT License](LICENSE). Fonts keep their own licence (SIL OFL 1.1) and the photo is CC0.
