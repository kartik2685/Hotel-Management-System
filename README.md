# Hotel Management System: Frontdesk

A front-office dashboard for a hotel (the fictional 48-room **Harlow Hotel**) with
reservations, a tape chart, a room status board, guest profiles, housekeeping tasks
and a staff sign-in page. It comes with a light and a dark theme.

It is built with plain **HTML, CSS and JavaScript**. There are no frameworks, no
libraries and no build step.

## Run it

- Open `index.html` in a browser, **or**
- serve the folder (recommended, so the URL and search parameters behave like a real site):

  ```bash
  python3 -m http.server 8000
  # then open http://localhost:8000
  ```

The sign-in page accepts any email with a password of 8 or more characters (demo only).

## Pages

| Page | What it does |
| --- | --- |
| `index.html` | Dashboard: occupancy, arrivals and departures, ADR, RevPAR, weekly revenue chart, room status, today's arrivals with one-click check-in, shift handover, departures |
| `reservations.html` | Bookings table with search, filters, sorting and CSV export, plus a new-booking form with live price calculation |
| `calendar.html` | Tape chart: rooms × 14 nights, paging, floor/room-type filters, booking details dialog |
| `rooms.html` | Room board by floor: status filters, clean/dirty switch, housekeeper assignment |
| `guests.html` | Guest list with search and filters; profiles with preferences, notes and stay history |
| `housekeeping.html` | Tasks by floor with live shift, task-type, attendant and floor progress |
| `login.html` | Staff sign-in with show/hide password and a password-reset panel |

## Project structure

```
├── index.html, reservations.html, calendar.html, rooms.html,
│   guests.html, housekeeping.html, login.html
└── assets/
    ├── css/
    │   ├── base.css          design tokens (light + dark), fonts, reset, utilities
    │   ├── layout.css        app shell: sidebar/drawer, top bar, dropdown menus, footer
    │   ├── components.css    buttons, cards, chips, forms, tables, progress bars…
    │   └── pages/            one stylesheet per page
    ├── js/
    │   ├── theme-init.js     sets the theme before the page paints
    │   ├── core.js           shared helpers + app shell behaviour
    │   └── pages/            one script per page
    ├── data/tape-chart.js    rooms, bookings and out-of-order blocks for the tape chart
    ├── fonts/                Manrope and Cormorant Garamond (self-hosted)
    └── img/                  lobby photo and favicon
```

Every HTML page loads `base.css`, `layout.css`, `components.css` and its own page
stylesheet, then `core.js` and its own page script.

## How the code is organised

- **CSS naming:** BEM, e.g. `.card`, `.card__title`, `.button--primary`. State classes start
  with `is-` (`.is-open`, `.is-done`); ARIA attributes are styled directly where they
  carry the state (`[aria-pressed="true"]`, `[aria-current="page"]`).
- **Theming:** every colour, shadow and radius is a custom property at the top of
  `assets/css/base.css`. The dark theme overrides the same properties under
  `:root[data-theme="dark"]`.
- **Icons:** one SVG sprite at the top of each page; use an icon with
  `<svg class="icon" aria-hidden="true"><use href="#icon-bed"></use></svg>`.
- **JavaScript hooks:** scripts find elements through `data-*` attributes
  (`data-check-in`, `data-room-filter`, …), never through styling classes, so the CSS can
  change without breaking behaviour.
- **Progressive enhancement:** without JavaScript, pages still show all their content.

## Customising

- **Colours and fonts:** edit the tokens at the top of `assets/css/base.css`.
- **Revenue chart:** it is drawn from the data table under it in `index.html`. Edit the
  table and the chart follows.
- **Tape chart:** replace the data in `assets/data/tape-chart.js` (the format is documented
  at the top of the file).
- **Forms:** they validate in the browser and show a success state. Connect them to
  your booking system, auth provider or API to make them live.
- **Theme choice:** saved in `localStorage` under `hms-theme`; otherwise the OS
  setting is used.

## Security notes

- Content created by JavaScript is always inserted as text (no `innerHTML`), so guest names
  and other input can't inject markup.
- CSV export neutralises cells that start with `=`, `+`, `-` or `@` so spreadsheet apps
  don't run them as formulas (CSV injection).
- The sign-in form uses `method="post"`, so a password never ends up in the URL even if
  JavaScript fails.
- Fonts are self-hosted: no visitor data goes to third-party font servers, and the site
  works offline.
- This is a front-end only demo. Real authentication, authorisation and data storage
  must happen on a server.

## Browser support

Current versions of Chrome, Edge, Firefox and Safari. The pages use modern CSS (`:has()`,
`color-mix()`) and the native `<dialog>` element.

## Credits

- Visual design based on the free **Frontdesk** hotel template by
  [uiCookies](https://uicookies.com/) (free for personal and commercial use,
  [license](https://uicookies.com/license/)). All code in this repository is a fresh
  rewrite.
- Fonts: [Manrope](https://github.com/sharanda/manrope) and
  [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant), SIL Open Font License
  (see `assets/fonts/`).
- Photo: "Hotel Lobby", CC0 1.0, via [rawpixel](https://www.rawpixel.com/image/5969494/hotel-lobby).
- All names, bookings and figures are fictional.

## License

The code is released under the [MIT License](LICENSE). Fonts keep their own
licence (SIL OFL 1.1) and the photo is CC0.
