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

- **Stack:** Node.js (22.13 or newer) · Express · EJS templates · SQLite (built into Node, nothing to install) or PostgreSQL (**Render**, Supabase…)
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

### Sample hotel in rupees (try every screen)

An empty hotel can be filled with a realistic Indian sample in one click: **Admin panel → Overview → Sample data →
Add sample data** (admins only), or `npm run sample` on the command line.

- *The Hooghly Residency*, Kolkata: 25 rooms in 7 types (Standard to Presidential Suite), INR, GST, `Asia/Kolkata`.
- 18 staff in every role: general manager, managers, front desk, reservations, night auditors, housekeeping,
  engineering, and one who has left; plus a new hire invited yesterday whose invite link is still open.
- 50 guests of every kind: business travellers billed to companies with GSTINs, families, VIPs, walk-ins, a wedding
  group, medical stays, foreign guests (Form III; Nepal and Bhutan exempt), a no-show and cancellations.
- Four weeks of hotel life up to the minute it is added: bookings by phone, email, walk-in, travel sites and the
  website, registration cards, check-ins and check-outs, room moves and an upgrade, payments and refunds, GST
  invoices, housekeeping tasks, handover notes, outlet revenue and a night audit every day; and 13 charges during
  stays (room service, minibar, laundry, spa, a taxi) on bills and GST invoices.

Nothing is pasted into the tables: everything is made through the same code as the screens, by the member of staff
on duty, at the time it happened, so every record can be opened and changed. All sample staff sign in with one
password, shown once when the sample is added. **Remove sample data** (same card, or `npm run sample -- --remove`)
takes it all out again before real use. Names, companies, GSTINs and ID numbers are made up; the emails use
`example.com`, so nothing is ever sent to them.

## What the system does

| Page | What you can do |
|---|---|
| **Dashboard** | Tonight’s occupancy, ADR and RevPAR (worked out from the bookings), arrivals with one-click **check-in**, departures with open balances, live room status, housekeeping progress, shift handover notes, 12-week revenue |
| **Reservations** | Search and filter bookings, export CSV, and create a **new booking**. The server checks availability for every night, picks a free room, prices the stay (rate plan, extras, tax) and saves it |
| **Booking page** (click a guest name) | Change dates, room, rate, guests and notes; take a **payment**; **check in**, **check out** (the folio must be settled; leaving early bills the nights stayed) or **cancel**. **WhatsApp the guest** opens WhatsApp with a message that fits the booking: the confirmation with their see-or-cancel link, a welcome with the room, or after check-out a thank-you with their invoice. Every change is logged |
| **Tape chart** | 48 rooms × 14 nights. Click a stay for details, check-in or confirmation |
| **Rooms** | Flip rooms clean or dirty, and assign housekeepers (saved instantly) |
| **Housekeeping** | Tick tasks off. Finishing a clean marks the room clean. Includes printable task sheets |
| **Guests** | Profiles with contact details, preferences, notes and stay history. Press Enter in the search box to search every guest. Edit a profile from the booking page or from *Admin → Guests* |
| **Shift handover** | Notes for the next shift (*account menu → Add a handover note*) |
| **Registration card (GRC)** | On the booking page: nationality, address, ID proof (Aadhaar, passport…), visa details for foreign guests, purpose of visit. Printable with signature lines. Optionally required before check-in |
| **Form III** | For foreign guests at an Indian hotel: the 24-hour deadlines after check-in and check-out, a reminder, and a place to record the FRRO acknowledgement number |
| **Payments and invoices** | Every payment with method and reference, refunds (managers), and printable invoices. GST invoices show your GSTIN, SAC 996311, CGST + SGST or IGST, the guest company’s GSTIN and the amount in words, numbered per financial year (e.g. `HLW/26-27/0001`). **Send on WhatsApp** gives the guest their own signed link to the invoice (no sign-in; it opens that invoice only) to print or save as PDF |
| **Charges during the stay** | On an in-house guest's booking page: **Add a charge to the bill** for room service, minibar, laundry, spa, a taxi… with its own GST rate (food is 18% when any room sells above ₹7,500 a night, else 5%; laundry and spa 18%; taxi 5%; staff can pick another). Charges count in the total, the balance and check-out; GST invoices list each with its SAC code and show CGST/SGST per rate. Managers can take a wrong charge off the bill (it stays listed) |
| **App on phones and computers** | Install Frontdesk from the browser: Android (Chrome) menu → *Install app*; iPhone (Safari) Share → *Add to Home Screen*; Edge or Chrome on a computer, the install icon in the address bar (*My account* has the steps and an Install button). It opens in its own window with the hotel's icon, and shows a clear "No connection" page offline. Pages are never stored on the device |

### Guest website (`/hotel`)

- Home page with rooms, photos, prices, amenities, location and policies.
- Availability search with real rooms left, prices per rate plan (tax included) and the cancellation rule of each rate.
- Booking form with extras. Every online booking appears straight away on the dashboard, tape chart and reservations list, and a confirmation email is written.
- “Manage booking”: guests find their booking with its number and email. A signed link means only the guest can open it. Flexible rates can be cancelled online until their deadline.
- Switch it on or off and edit its texts in *Admin → Website*. Room descriptions and photos are set in *Admin → Room types* (photos live in `assets/img/rooms/`).

### Admin panel

Managers and admins open it from the sidebar: **Admin → Admin panel** (admins also get **Staff accounts**
there). It is also in the account menu (click your name, top right), and at `/admin`.

- **Overview → Database** (admins): which database the hotel runs on (*Render PostgreSQL*, *Supabase (PostgreSQL)*
  or the SQLite file), its tables, size and round-trip time, and **Download a backup**: every table in one file.
  On Render's free database it counts down the days before it expires; on Render without a database it warns in
  red that the data is in a temporary file.
- **Hotel settings** (admins): name, city, contact details, GSTIN, currency (₹ / $ / …), number format,
  tax rule (**one flat rate**, **India GST on rooms**, or **none**), check-in/out times, time zone,
  shift hours, business date.
- **Room types:** name, base rate, how many guests it sleeps, cleaning times.
- **Rooms:** add or change rooms; take a room **out of order** for a period and put it back in service.
- **Rates & extras:** rate plans (e.g. Bed & breakfast +₹500/night, Advance purchase −12%) and extras (airport transfer, parking…).
- **Booking sources:** walk-in, phone, website, OTAs; choose which appear on the booking form.
- **Staff accounts** (admins): add people with a role, then either
  - leave the password blank to get an **invite link** (works once, for 7 days): copy it or press **Send on WhatsApp**,
    and it is emailed too when email is set up. The person opens it and chooses their own password;
  - or set a temporary password they must change at first sign-in.

  The list shows *Invite sent* / *Invite expired*; **Edit** → **Send a new invite link** replaces an old link, and
  **Send a password link** (24 hours) helps someone who forgot theirs. You can also reset passwords or deactivate
  accounts. You can’t remove the last admin or lock yourself out.
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
4. Add a **staff account** for each person, with the right role. Leave the password blank and send them the invite link (WhatsApp or email).
5. Put your own room photos in `assets/img/rooms/`, choose them in **Room types**, write the texts in **Website** and switch the website on.
6. To send emails, set the SMTP variables below. Until then emails are kept in *Admin → Emails*, and password-reset links can be copied from there.

> GST bands built in (from 22 Sep 2025): rooms under ₹1,000/night 0%, up to ₹7,500 5%, above ₹7,500 18%.
> Confirm the current rules with your accountant.

## Configuration

Settings are environment variables (see `.env.example`). On your own computer you can also put them in a `.env` file next to `package.json`; real environment variables win over it.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where the server listens |
| `DATABASE_URL` | — | A PostgreSQL connection string. On Render the Blueprint fills it in (see below). When set, it is used instead of the SQLite file and the tables are created automatically |
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

### Going live on Render (website, backend and database)

> **Step by step in Hinglish, with every click:** [docs/SETUP-RENDER.md](docs/SETUP-RENDER.md)

**How the code gets there:** Render deploys straight from GitHub. You connect it once (the Blueprint below);
after that every push to the branch is deployed by itself, and the data stays in the database.

**The Blueprint.** [`render.yaml`](render.yaml) creates two resources in Singapore and connects them:

| Resource | What it is | Plan |
|---|---|---|
| `hotel-management-system` | the web service: guest website, staff app and backend (`npm ci`, `npm start`, health check `/login`, `NODE_ENV=production`, `TRUST_PROXY=1`) | Free |
| `hotel-db` | Render PostgreSQL with all the data. `DATABASE_URL` is set to its private address by Render | Free for 30 days |

In Render → **New → Blueprint**, connect the repository and pick the branch with this code. Render asks for three
values: `ADMIN_EMAIL` (your sign-in), `ADMIN_PASSWORD` (8+ characters) and `HOTEL_NAME`. Click **Deploy Blueprint**.
The app waits up to about a minute for a database that is still starting, creates its 26 tables and starts as an
empty hotel with that admin account. Leave `ADMIN_EMAIL` empty to get the demo hotel instead; its staff password is
then printed once in the **Logs**. Check it in **Admin → Overview**: the **Database** card shows
*Render PostgreSQL · private network*, 26 tables and a round trip of a few milliseconds. `render.yaml` names the
branch it deploys (`branch:`); change it to `main` once the code is merged there.

> **Render's free database lasts 30 days.** Then it stops, and 14 days later Render deletes it with all its data.
> Before that, upgrade `hotel-db` in the Render Dashboard to `0.1c-256mb` (about $6 a month plus $0.30 per GB of
> storage; the data stays) and set `plan: 0.1c-256mb` in `render.yaml` so the Blueprint agrees. **Admin → Overview**
> counts the days down (in red during the last week), and Render sends emails too.
> The free web service sleeps after 15 minutes without visitors and takes about a minute to wake up; the Starter
> plan ($7 a month) keeps it awake.

**Or by hand:** create a database (**New → Postgres**, region Singapore) and a **Web Service** in the same region:

| Field | Value |
|---|---|
| Language | **Node** |
| Branch | the branch that has this code (`main` once it is merged) |
| Root Directory | leave empty |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path (Advanced) | `/login` |

Then add the environment variables `NODE_ENV=production`, `TRUST_PROXY=1`, **`DATABASE_URL`** = the database's
**Internal Database URL** (without it a free instance forgets everything on every restart), plus one of:

- **To show the demo:** `DEMO_PASSWORD` = a password of your own (8+ characters). Sign in as
  `elena.marsh@example.com` with it. The sign-in page never shows the password on a live server.
- **For a real hotel:** `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `HOTEL_NAME`. The app starts as an empty hotel
  with that admin account. Then follow *Setting it up for a real hotel* above.

The site’s address (`https://<name>.onrender.com`) opens the guest website, or the sign-in page while the
website is switched off (an empty hotel starts with it off). Staff always sign in at `/login`. Links in emails use
that address unless *Website address* is set in Hotel settings. Render uses Node 24 here (from `engines` in `package.json`).

Good to know:
- **Backups:** free databases have none. **Admin → Overview → Download a backup** saves every table in one file:
  a SQLite database the app can open as it is (`DB_PATH=<file> npm start`). On a computer with the database's
  **External Database URL** in `.env` as `DATABASE_URL`, `npm run backup` writes the same file to `backups/`.
  Both read one consistent snapshot, so bookings made meanwhile can't half-appear.
  `npm run db:copy -- --from <file>.db --to "<empty database URL>"` puts a backup back.
- **Already have data in SQLite?** Copy it before the first start (the database must be empty):
  `npm run db:copy -- --from data/frontdesk.db --to "<External Database URL>"`.
- **A wrong setting?** The deploy log says what to fix (wrong password, unknown host, the private `dpg-…` address
  used from outside Render…).
- **Security:** the database URL contains its password; Render keeps it in the service's Environment, never in Git.
- **Without a database** the Database card and the start log warn in red that the data is in a temporary file.
  (A paid instance can also keep the SQLite file on a **Disk**: mount it at `/var/data`, set `DB_PATH=/var/data/frontdesk.db`.)

### Other PostgreSQL databases (Supabase, Neon…)

`DATABASE_URL` takes any PostgreSQL 14+ connection string; remote servers are reached over TLS. To use one with the
Blueprint, delete the `databases:` block and the `fromDatabase` entry from `render.yaml`, and set `DATABASE_URL` in
the service's **Environment** instead.

- **Supabase** (free plan: 500 MB, doesn't expire, pauses after a week without any use): create the project in
  **Southeast Asia (Singapore)**, then **Connect → Session pooler** and copy the URI, replacing `[YOUR-PASSWORD]`.
  Not *Direct connection*: it only works over IPv6, which Render doesn't have. Every table has row level security
  switched on, so Supabase's public API keys can't read hotel data. If you want the tables before the first deploy,
  paste `server/db/schema.pg.sql` into the SQL Editor and run it.
- Keep the database in the same region as the app: every page asks it a dozen things or more.

### Going live (any Node host)

- Run `npm ci --omit=dev && npm start` with `NODE_ENV=production`, `TRUST_PROXY=1` and HTTPS in front.
- Keep the data somewhere that lasts: set `DATABASE_URL` to a PostgreSQL database (Render, Supabase, Neon, your own),
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

111 tests run against a fresh demo hotel or the sample hotel (one of them only on PostgreSQL). `npm run test:pg` runs all of them on PostgreSQL instead (an embedded
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
- staff invite and password links (shown once, emailed, work once, expire, a newer link replaces the older);
- WhatsApp messages to guests (numbers with country codes, the guest's signed invoice link);
- charges during the stay (tax rate per charge, SAC codes and GST per rate on the invoice, managers take charges off);
- the installable app (manifest, icons, service worker and offline page, also for an account that must change its password);
- database upgrades, and what a new database starts with on a live server;
- the sample hotel: made through the services, in rupees everywhere, admins only, and removed without a trace;
- PostgreSQL: the same tables and answers as SQLite, row level security, copying between the two;
- the admin's database card (Render and Supabase recognised, the free-plan countdown) and backup downloads
  (who may, and that the file holds every row); waiting for a database that is still starting.

## Project structure

```
server/
  index.js            start-up (creates and seeds the database on first run)
  app.js              Express app: security headers, sessions, routes, error pages
  config.js           environment settings
  db/                 index.js (SQLite) and postgres.js (PostgreSQL: Render, Supabase…) behind one API; schema.sql + migrations/
                      and schema.pg.sql + migrations/pg/ (applied automatically); seed.js (demo or empty hotel), sample.js + sample-data.js
                      (the sample hotel in rupees), copy.js, backup.js, demo-data.json
  lib/                auth (passwords, sessions), security (CSP, CSRF, roles), forms, pricing, formatting, clock, activity log
  services/           business logic: reservations, rooms, guests, housekeeping, dashboard, stats, night audit, billing,
                      registration (GRC, Form III), website, emails, settings, signin-links (reset and invite links),
                      system (the admin's database card)
  routes/             pages, bookings, admin panel, guest website, JSON API, sign-in
  views/              EJS templates: staff pages (same markup as the original design), admin panel, guest website, printables
assets/               CSS, browser JavaScript, fonts and images
test/                 end-to-end tests (node:test)
docs/                 SETUP-RENDER.md: going live on Render, step by step (Hinglish)
render.yaml           Render Blueprint: the web service and its PostgreSQL database, connected
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
- Room and restaurant photos in `assets/img/rooms/` are AI-generated placeholders for the fictional demo and sample hotels. Replace them with real photos of your hotel.
- Demo data is fictional.

## License

The code is released under the [MIT License](LICENSE). Fonts keep their own licence (SIL OFL 1.1) and the photo is CC0.
