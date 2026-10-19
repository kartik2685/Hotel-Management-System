# Development guide

This guide is for someone taking over the codebase. It describes where the main behaviour lives and how to make a change without having to understand the whole app first.

## Run and test

The project needs Node.js 22.13 or newer.

```sh
npm ci
npm start
npm test
```

The app listens on port 3000 by default. A fresh local database starts with the demo hotel. Set `DB_PATH` to choose a SQLite file, or set `DATABASE_URL` for PostgreSQL. See `.env.example` for the optional settings.

## How a request travels through the app

1. `server/app.js` builds the Express app, parses requests, loads the current hotel settings and signed-in session, and applies security checks.
2. A file in `server/routes/` matches the URL. Routes handle request/response concerns and validate submitted forms.
3. Reusable hotel rules live in `server/services/`; low-level helpers such as form validation, dates, currency, and permissions live in `server/lib/`.
4. The route renders an EJS view from `server/views/`. Browser styles and behaviour are in `assets/css/` and `assets/js/`.
5. SQLite and PostgreSQL share the database setup in `server/db/`. Schema changes belong in migrations and must be covered by tests.

### Where to look

| Change | Start here |
|---|---|
| Guest-facing hotel pages or booking flow | `server/routes/site.js`, `server/services/website.js`, `server/views/site/` |
| Admin panel pages | `server/routes/admin.js`, `server/views/admin/` |
| Staff dashboard, reservations, rooms | `server/routes/pages.js`, the matching route/service, and `server/views/pages/` |
| Login, roles, sessions, CSRF | `server/routes/auth.js`, `server/lib/auth.js`, `server/lib/security.js` |
| Hotel defaults and saved settings | `server/services/settings.js` |
| Optional payment, messaging and channel-manager boundaries | `server/services/integrations.js`, `server/routes/integrations.js` |
| Demo hotel | `server/db/seed.js` and `server/db/demo-data.json` |
| Database tables and upgrades | `server/db/schema.sql`, `server/db/schema.pg.sql`, `server/db/migrations/` |
| Provider setup and webhook contract | `README.md` → Integrations and future setup |
| Automated checks | `test/` (shared app and browser-like helper: `test/helpers.js`) |

## Website copy and photo galleries

Text, hotel details, and uploaded-photo lists are stored as JSON values in the `settings` table. Room descriptions and their cover photo are fields on `room_types`; additional room photos are stored in the `room_type_galleries` setting, keyed by room-type id (demo defaults may use the room code).

Uploaded images are checked for JPEG, PNG, or WebP file signatures, assigned a random filename, and stored under `assets/img/rooms/uploads/`. The guest website resolves those filenames when it renders each gallery. Do not put user-supplied filenames directly into a filesystem path.

Carousel markup is shared in `server/views/site/_carousel.ejs`; homepage areas that need a custom layout use the same `data-site-carousel` controls. `assets/js/site.js` handles buttons, desktop hover, touch swipes, and mobile auto-advance. `assets/css/site.css` controls the small translucent arrows and responsive sizing.

Demo image lists are configured in `DEMO_SETTINGS` in `server/db/seed.js`. Use existing files under `assets/img/` so the sample hotel works immediately after seeding. Add a test whenever a new gallery surface or upload path is introduced.

## Keeping changes understandable

- Keep route handlers focused on HTTP input/output; put pricing, availability, and other reusable rules in services.
- Validate every submitted field on the server. Browser validation is only a convenience.
- Use descriptive names for database fields and extracted values; add a brief comment where a business rule is not obvious.
- Escape guest-provided text in EJS with `<%= value %>`. Use unescaped output only for trusted, app-generated markup.
- Add or update tests alongside behaviour changes: permissions, invalid form input, successful changes, and relevant edge cases.
- Run `npm test` and `git diff --check` before considering a change finished.

## Third-party notices

The public footer uses hotel branding and does not show a template credit. The original Frontdesk visual design attribution and its license are recorded in the repository's README; keep that notice if distributing the design assets.
