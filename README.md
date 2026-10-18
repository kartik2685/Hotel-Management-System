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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | — | Your mail provider (Gmail/Workspace, Zoho, Amazon SES, Brevo…) for sending emails |
| `MAIL_FROM` | hotel email | Sender, e.g. `The Harlow Hotel <stay@yourhotel.com>` |
| `HMS_NOW` | — | Freeze the hotel clock, e.g. `2026-09-24T10:42` (demos and tests only) |
| `EMBED_PREVIEW`, `PREVIEW_BAR` | — | Development only: allow framing by a preview panel; `/` shows a Desktop/Tablet/Mobile bar |

> **Signing in inside a preview panel.** With `EMBED_PREVIEW` the cookies are made for frames
> (`SameSite=None; Secure; Partitioned`). Most browsers then work inside the panel. Some keep
> blocking cookies there, for example Safari before 26.2 or a browser set to block all cookies.
> The sign-in page notices this and shows **Sign in from a new tab**, with a button and the
> address. The guest website still works there, because it doesn’t need cookies.

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
  India’s DPDP Act applies to guest data.

## Tests

```bash
npm test
```

44 end-to-end tests run against a fresh demo hotel. They cover:
- sign-in, lockout, CSRF and redirect safety;
- browsers that block cookies in a preview panel (sign-in note, guest booking, cross-site refusal);
- roles;
- booking rules, payments and refunds;
- the guest website (booking, signed links, cancellation rules, spam protection);
- the GRC and Form III;
- GST invoice numbering and tax splits;
- password reset, reports and CSV safety;
- database upgrades.

## Project structure

```
server/
  index.js            start-up (creates and seeds the database on first run)
  app.js              Express app: security headers, sessions, routes, error pages
  config.js           environment settings
  db/                 schema.sql + migrations/ (applied automatically), seed.js (demo or empty hotel), backup.js, demo-data.json
  lib/                auth (passwords, sessions), security (CSP, CSRF, roles), forms, pricing, formatting, clock, activity log
  services/           business logic: reservations, rooms, guests, housekeeping, dashboard, stats, night audit, billing,
                      registration (GRC, Form III), website, emails, settings
  routes/             pages, bookings, admin panel, guest website, JSON API, sign-in
  views/              EJS templates: staff pages (same markup as the original design), admin panel, guest website, printables
assets/               CSS, browser JavaScript, fonts and images
test/                 end-to-end tests (node:test)
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
