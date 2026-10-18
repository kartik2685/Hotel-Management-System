# Frontdesk — hotel management system

A working hotel management system (PMS) for the front office, housekeeping and management, plus a
**guest booking website**. It covers:

- bookings, check-in and check-out, room status and housekeeping task sheets;
- guest profiles and a 14-night tape chart;
- registration cards (GRC) and Form III for foreign guests;
- payments and **GST invoices**, emails, reports;
- staff logins with roles, an **admin panel** and an end-of-day **night audit**.

It keeps the exact look of the *Frontdesk* template by uiCookies. Every page is now drawn
by the server from a real database, and every change is saved.

- **Stack:** Node.js (22.13 or newer) · Express · EJS templates · SQLite (built into Node, nothing to install) or PostgreSQL / **Supabase**
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

- **Guest website:** <http://localhost:3000/hotel>. Guests see the rooms, check availability and book; they pay at the hotel.
- **Staff app:** <http://localhost:3000/login>.

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
| **Registration card (GRC)** | On the booking page: nationality, address, ID proof (Aadhaar, passport…), visa details for foreign guests, purpose of visit. Printable with signature lines. Optionally required before check-in |
| **Form III** | For foreign guests at an Indian hotel: the 24-hour deadlines after check-in and check-out, a reminder, and a place to record the FRRO acknowledgement number |
| **Payments and invoices** | Every payment with method and reference, refunds (managers), and printable invoices. GST invoices show your GSTIN, SAC 996311, CGST + SGST or IGST, the guest company’s GSTIN and the amount in words, numbered per financial year (e.g. `HLW/26-27/0001`) |

### Guest website (`/hotel`)

- Home page with rooms, photos, prices, amenities, location and policies.
- Availability search with real rooms left, prices per rate plan (tax included) and the cancellation rule of each rate.
- Booking form with extras. Every online booking appears straight away on the dashboard, tape chart and reservations list, and a confirmation email is written.
- “Manage booking”: guests find their booking with its number and email. A signed link means only the guest can open it. Flexible rates can be cancelled online until their deadline.
- Switch it on or off and edit its texts in *Admin → Website*. Room descriptions and photos are set in *Admin → Room types* (photos live in `assets/img/rooms/`).

### Admin panel

Open it from the **account menu** (click your name, top right) → **Admin panel**, or go to `/admin`.

- **Overview → Database** (admins): which database the hotel runs on (*Supabase (PostgreSQL) · Singapore*, or the
  SQLite file), its tables, size and round-trip time, and **Download a backup**: every table in one file.
  On Render without `DATABASE_URL` it warns in red that the data is in a temporary file.
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
- **Website:** turn the guest website on or off; tagline, introduction, amenities and policies.
- **Invoices:** every invoice issued, with CSV export.
- **Reports:** occupancy, ADR, RevPAR and room revenue for any period, revenue by outlet and bookings by source, with CSV export.
- **Emails** (admins): every email the system wrote (confirmations, cancellations, password resets) and whether it was sent.
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
2. In **Admin → Hotel settings**, set:
   - name, city, address, **country** and **state**, GSTIN;
   - currency (an empty hotel starts in Indian settings: `INR`, `₹`, *India GST on rooms*, `Asia/Kolkata`);
   - check-in/out times, **business date → Follow today’s date**;
   - invoice prefix, website address;
   - whether the **GRC is required before check-in**.
3. Add **room types**, then **rooms**, then **rate plans**, **extras** and **booking sources**.
4. Add a **staff account** for each person, with the right role.
5. Put your own room photos in `assets/img/rooms/`, choose them in **Room types**, write the texts in **Website** and switch the website on.
6. To send emails, set the SMTP variables below. Until then emails are kept in *Admin → Emails*, and password-reset links can be copied from there.

> GST bands built in (from 22 Sep 2025): rooms under ₹1,000/night 0%, up to ₹7,500 5%, above ₹7,500 18%.
> Confirm the current rules with your accountant.

## Configuration

Settings are environment variables (see `.env.example`). On your own computer you can also put them in a `.env` file next to `package.json`; real environment variables win over it.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where the server listens |
| `DATABASE_URL` | — | A PostgreSQL connection string, e.g. from **Supabase** (see below). When set, it is used instead of the SQLite file and the tables are created automatically |
| `DB_PATH` | `./data/frontdesk.db` | The SQLite database file, used when there is no `DATABASE_URL`. **Back up this folder** |
| `NODE_ENV` | — | Set to `production` on a live server (secure cookies, HSTS) |
| `TRUST_PROXY` | off | Set to `1` behind a proxy or load balancer (Render, Railway, nginx) |
| `COOKIE_SECURE` | on in production | Cookies only over HTTPS |
| `SESSION_IDLE_MINUTES` | `30` | Sign out after this long idle (unless *Keep me signed in*) |
| `SESSION_REMEMBER_DAYS` | `30` | Length of *Keep me signed in* |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | — | On a new database: start an **empty hotel** with this admin account instead of the demo. Without `ADMIN_PASSWORD` a one-time password is printed in the log |
| `ADMIN_NAME`, `HOTEL_NAME` | `Administrator`, `My Hotel` | Names used for that empty hotel |
| `DEMO_PASSWORD` | `harlow-demo` | Password for the demo accounts. With `NODE_ENV=production` and no `DEMO_PASSWORD`, a random one is printed in the log instead |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | — | Your mail provider (Gmail/Workspace, Zoho, Amazon SES, Brevo…) for sending emails |
| `MAIL_FROM` | hotel email | Sender, e.g. `The Harlow Hotel <stay@yourhotel.com>` |
| `HMS_NOW` | — | Freeze the hotel clock, e.g. `2026-09-24T10:42` (demos and tests only) |
| `EMBED_PREVIEW`, `PREVIEW_BAR` | — | Development only: allow framing by a preview panel; `/` shows a Desktop/Tablet/Mobile bar |

> **Signing in inside a preview panel.** With `EMBED_PREVIEW` the cookies are made for frames
> (`SameSite=None; Secure; Partitioned`). Most browsers then work inside the panel. Some keep
> blocking cookies there, for example Safari before 26.2 or a browser set to block all cookies.
> The sign-in page notices this and shows **Sign in from a new tab**, with a button and the
> address. The guest website still works there, because it doesn’t need cookies.

### Going live on Render

> **Step by step in Hinglish, with every click:** [docs/SETUP-SUPABASE-RENDER.md](docs/SETUP-SUPABASE-RENDER.md)

**Easiest: the Blueprint.** The repository has a [`render.yaml`](render.yaml). In Render → **New → Blueprint**,
connect the repository and pick the branch with this code. Render asks for four values:

| Value | What to enter |
|---|---|
| `DATABASE_URL` | your Supabase connection string (next section) |
| `ADMIN_EMAIL` | your sign-in email: the app starts as an empty hotel with this admin account |
| `ADMIN_PASSWORD` | your sign-in password (8+ characters) |
| `HOTEL_NAME` | the hotel's name |

Click **Deploy Blueprint**. Everything else is filled in: a free web service in Singapore, `npm ci`, `npm start`,
health check `/login`, `NODE_ENV=production` and `TRUST_PROXY=1`. Leave `ADMIN_EMAIL` empty to get the demo hotel
instead; its staff password is then printed once in the **Logs**. `render.yaml` names the branch it deploys
(`branch:`); change it to `main` once the code is merged there.

**Or by hand:** in **New → Web Service**, connect the GitHub repository and fill in:

| Field | Value |
|---|---|
| Language | **Node** |
| Branch | the branch that has this code (`main` once it is merged) |
| Root Directory | leave empty |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path (Advanced) | `/login` |

Then add the environment variables `NODE_ENV=production`, `TRUST_PROXY=1` and **`DATABASE_URL`** (your
Supabase database, next section — without it a free instance forgets everything), plus one of:

- **To show the demo:** `DEMO_PASSWORD` = a password of your own (8+ characters). Sign in as
  `elena.marsh@example.com` with it. The sign-in page never shows the password on a live server.
- **For a real hotel:** `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `HOTEL_NAME`. The app starts as an empty hotel
  with that admin account. Then follow *Setting it up for a real hotel* above.

The site’s address (`https://<name>.onrender.com`) opens the guest website, or the sign-in page while the
website is switched off (an empty hotel starts with it off). Staff always sign in at `/login`.
Render uses Node 24 here (from `engines` in `package.json`).

> **Keep the data in Supabase.** Render's free instances lose their files on every restart, redeploy and
> after 15 minutes without visitors, so a SQLite file there starts again from the beginning. With
> `DATABASE_URL` the data lives in Supabase and survives all of that. (The other way: a paid instance
> with a **Disk** at `/var/data` and `DB_PATH=/var/data/frontdesk.db`.)

### Database on Supabase (free)

1. On [supabase.com](https://supabase.com) create a **New project**. Choose a database password (letters
   and digits are easiest; keep it) and the region **Southeast Asia (Singapore)**. In Render pick
   **Singapore** too: every page asks the database a few things, so both should be in the same place.
2. When the project is ready, click **Connect** at the top, choose **Session pooler** and copy the URI:
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-…-ap-southeast-1.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` (brackets included) with your database password.
   Use the **Session pooler**, not *Direct connection*: the direct address only works over IPv6, which Render doesn't have.
3. Put that string in `DATABASE_URL`: the Blueprint asks for it; on a service made by hand, add it in Render →
   your service → **Environment** and deploy. The log shows `Database: PostgreSQL on aws-…pooler.supabase.com:5432/postgres`,
   and the app creates its 26 tables by itself (see them in Supabase → **Table Editor**). Nothing to run in the SQL Editor.
4. Sign in and open **Admin → Overview**. The **Database** card shows *Supabase (PostgreSQL) · Singapore*, 26 tables
   and the round trip: a few milliseconds when both are in Singapore. (Much more means they are in different regions,
   and every page waits for it.)
5. Restarts, redeploys and sleeping no longer lose anything; staff even stay signed in.

Good to know:
- **Wrong string?** The deploy log says what to fix (wrong password, placeholder left in, IPv6 direct address, unknown host).
- **Free projects pause** after a week with no use at all, and are restored with one click in the Supabase dashboard.
  A hotel that uses the system every day keeps it awake. The free plan has 500 MB, years of bookings for a small hotel.
- **Backups:** the free plan has no automatic backups. **Admin → Overview → Download a backup** saves every table
  in one file: a SQLite database the app can open as it is (`DB_PATH=<file> npm start`). On a computer with
  `DATABASE_URL` in `.env`, `npm run backup` writes the same file to `backups/`. Both read one consistent snapshot, so
  bookings made meanwhile can't half-appear. `npm run db:copy -- --from <file>.db --to "<empty database URL>"` puts a
  backup back.
- **Already have data in SQLite?** Copy it before the first start on Supabase (the database must be empty):
  `npm run db:copy -- --from data/frontdesk.db --to "<DATABASE_URL>"`.
- **Security:** the connection string contains the password, so keep it in Render's Environment only.
  Every table has row level security switched on, so Supabase's public API keys can't read hotel data;
  the app connects as the database owner.
- If you ever want the tables before the first deploy, paste `server/db/schema.pg.sql` into the SQL Editor and run it.

### Going live (any Node host)

- Run `npm ci --omit=dev && npm start` with `NODE_ENV=production`, `TRUST_PROXY=1` and HTTPS in front.
- Keep the data somewhere that lasts: set `DATABASE_URL` to a PostgreSQL database (Supabase, Neon, your own),
  or give the app a **persistent disk** for `data/` and point `DB_PATH` at it.
- Back up regularly: **Admin → Overview → Download a backup**, or `npm run backup`, which writes the same file to
  `backups/` (safe while the app runs; with `DATABASE_URL` it is a SQLite file with the same tables).
- Shared hosting that only serves PHP or plain HTML files won’t run this app. It needs Node.js.

## Security

- Passwords are hashed with scrypt. A first password set by an admin must be changed at first sign-in.
- Sessions are stored server-side; only a hash of the cookie is kept. Cookies are HttpOnly and SameSite.
  Sessions end after 30 minutes idle on shared workstations.
- Every form and API call carries a CSRF token, and the login form has its own.
  Forms that work without a session (sign-in, password reset, guest website) accept either the
  visitor’s cookie token or a recent token signed by the server. The signed token only counts when
  the browser reports that the form was sent from this site (`Sec-Fetch-Site`, or `Origin`).
- Five wrong passwords lock the account for 15 minutes.
- Roles are checked on the server for every page and action: admin, manager, front desk, housekeeping.
- All database queries are parameterised, and all output is escaped.
- A strict Content-Security-Policy (no inline scripts) is applied, plus `nosniff`, `Referrer-Policy` and frame protection.
- Every change is written to the activity log.
- The guest website’s forms have their own CSRF tokens and a spam trap, and are rate-limited per IP address. Booking links are signed with a secret key, so a booking number alone can’t open someone’s booking.
- Password resets use single-use links that expire after an hour. The reply is the same whether or not the email exists, and a reset signs the person out everywhere.
- ID numbers are masked on screens that don’t need them.
- The database (`data/`) holds guest personal data. It is git-ignored; keep it private and backed up.
  Backup files hold the same data, so only admins can download one, and each download is in the activity log.
  India’s DPDP Act applies to guest data.

## Tests

```bash
npm test
```

67 tests run against a fresh demo hotel. `npm run test:pg` runs all of them on PostgreSQL instead (an embedded
copy, nothing to install), and `TEST_DATABASE=postgres://user:pass@host/postgres npm test` on a real server.
They cover:
- sign-in, lockout, CSRF and redirect safety;
- browsers that block cookies in a preview panel (sign-in note, guest booking, cross-site refusal);
- roles;
- booking rules, payments and refunds;
- the guest website (booking, signed links, cancellation rules, spam protection);
- the GRC and Form III;
- GST invoice numbering and tax splits;
- password reset, reports and CSV safety;
- database upgrades, and what a new database starts with on a live server;
- PostgreSQL: the same tables and answers as SQLite, row level security, copying between the two;
- the admin's database card and backup downloads (who may, and that the file holds every row).

## Project structure

```
server/
  index.js            start-up (creates and seeds the database on first run)
  app.js              Express app: security headers, sessions, routes, error pages
  config.js           environment settings
  db/                 index.js (SQLite) and postgres.js (PostgreSQL / Supabase) behind one API; schema.sql + migrations/
                      and schema.pg.sql (applied automatically); seed.js (demo or empty hotel), copy.js, backup.js, demo-data.json
  lib/                auth (passwords, sessions), security (CSP, CSRF, roles), forms, pricing, formatting, clock, activity log
  services/           business logic: reservations, rooms, guests, housekeeping, dashboard, stats, night audit, billing,
                      registration (GRC, Form III), website, emails, settings, system (the admin's database card)
  routes/             pages, bookings, admin panel, guest website, JSON API, sign-in
  views/              EJS templates: staff pages (same markup as the original design), admin panel, guest website, printables
assets/               CSS, browser JavaScript, fonts and images
test/                 end-to-end tests (node:test)
docs/                 SETUP-SUPABASE-RENDER.md: going live with Supabase and Render, step by step (Hinglish)
render.yaml           Render Blueprint: one free web service, data in Supabase
```

## Not included yet

- **Online card or UPI payments:** these need your own Razorpay, PayU or Stripe merchant account. Today guests pay at the hotel, and staff record each payment.
- **SMS or WhatsApp messages:** these need a provider account (e.g. MSG91, Twilio).
- **Channel manager:** syncing with Booking.com, MakeMyTrip, Agoda and similar sites needs a channel-manager partner.
- **Multiple properties:** the property switcher shows only the current hotel.
- **Tax on extras:** extras are added without tax; only the room charge is taxed.

## Credits

- Design: *Frontdesk*, a free hotel management dashboard template by
  [uiCookies](https://uicookies.com/) (free for personal and commercial use,
  [license](https://uicookies.com/license/)). The code in this repository is a fresh implementation.
- Fonts: [Manrope](https://github.com/sharanda/manrope) and
  [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant), SIL Open Font License 1.1, self-hosted.
- Photo: "Hotel Lobby", CC0 1.0, via [rawpixel](https://www.rawpixel.com/image/5969494/hotel-lobby).
- Room and restaurant photos in `assets/img/rooms/` are AI-generated placeholders for the fictional demo hotel. Replace them with real photos of your hotel.
- Demo data is fictional.

## License

The code is released under the [MIT License](LICENSE). Fonts keep their own licence (SIL OFL 1.1) and the photo is CC0.
