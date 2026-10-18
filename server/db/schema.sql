-- Frontdesk HMS database schema (SQLite).
-- Money is stored in cents (INTEGER). Dates are 'YYYY-MM-DD', times 'YYYY-MM-DD HH:MM' in hotel time.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                       -- JSON
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'frontdesk', 'housekeeping')),
  title         TEXT NOT NULL DEFAULT '',
  department    TEXT NOT NULL DEFAULT '',
  shift         TEXT NOT NULL DEFAULT 'morning' CHECK (shift IN ('morning', 'evening', 'night')),
  code          TEXT NOT NULL UNIQUE,       -- short code used on the room board, e.g. 'mv'
  area          TEXT,                       -- housekeeping area label, e.g. 'Floor 1'
  floor         INTEGER,                    -- housekeeping home floor
  avatar_tone   TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,             -- SHA-256 of the cookie value (the raw token is never stored)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  shift       TEXT NOT NULL DEFAULT 'morning',
  remember    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,             -- epoch ms
  last_seen   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  ip         TEXT,
  ok         INTEGER NOT NULL,
  created_at INTEGER NOT NULL               -- epoch ms
);
CREATE INDEX IF NOT EXISTS login_attempts_lookup ON login_attempts(email, created_at);

CREATE TABLE IF NOT EXISTS room_types (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  base_rate_cents INTEGER NOT NULL CHECK (base_rate_cents >= 0),
  max_guests      INTEGER NOT NULL CHECK (max_guests BETWEEN 1 AND 12),
  clean_minutes   INTEGER NOT NULL DEFAULT 40,
  service_minutes INTEGER NOT NULL DEFAULT 25,
  sort            INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rooms (
  id           INTEGER PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,
  floor        INTEGER NOT NULL,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  hk_status    TEXT NOT NULL DEFAULT 'clean' CHECK (hk_status IN ('clean', 'dirty')),
  attendant_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  hk_updated_at TEXT
);

-- Out-of-order periods. start_date is the first night off sale, end_date the day it is back.
CREATE TABLE IF NOT EXISTS room_blocks (
  id         INTEGER PRIMARY KEY,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL CHECK (end_date > start_date),
  reason     TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS room_blocks_room ON room_blocks(room_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS rate_plans (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  adjust_type  TEXT NOT NULL CHECK (adjust_type IN ('amount', 'percent')),
  adjust_value INTEGER NOT NULL,            -- cents per night, or whole percent (e.g. -12)
  description  TEXT NOT NULL DEFAULT '',
  bookable     INTEGER NOT NULL DEFAULT 1,  -- offered on the new booking form
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS extras (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  per         TEXT NOT NULL CHECK (per IN ('stay', 'night')),
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sources (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'ota', 'corporate', 'walk_in')),
  sort      INTEGER NOT NULL DEFAULT 0,
  form_sort INTEGER,                        -- position on the new booking form (NULL = not offered)
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS guests (
  id          INTEGER PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  city        TEXT,
  company     TEXT,
  vip         INTEGER NOT NULL DEFAULT 0,
  corporate   INTEGER NOT NULL DEFAULT 0,
  preferences TEXT NOT NULL DEFAULT '{}',   -- JSON: { room: [], comfort: [], dining: [], service: [] }
  prior_stays INTEGER NOT NULL DEFAULT 0,   -- history imported from before this system
  prior_nights INTEGER NOT NULL DEFAULT 0,
  prior_spend_cents INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS guests_name ON guests(last_name, first_name);
CREATE INDEX IF NOT EXISTS guests_email ON guests(email);

CREATE TABLE IF NOT EXISTS guest_notes (
  id          INTEGER PRIMARY KEY,
  guest_id    INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_notes_guest ON guest_notes(guest_id, created_at);

CREATE TABLE IF NOT EXISTS reservations (
  id                 INTEGER PRIMARY KEY,
  confirmation       TEXT NOT NULL UNIQUE,
  guest_id           INTEGER NOT NULL REFERENCES guests(id),
  room_type_id       INTEGER NOT NULL REFERENCES room_types(id),
  room_id            INTEGER REFERENCES rooms(id),
  arrival            TEXT NOT NULL,
  departure          TEXT NOT NULL CHECK (departure > arrival),
  adults             INTEGER NOT NULL DEFAULT 1 CHECK (adults >= 1),
  children           INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  rate_plan_id       INTEGER REFERENCES rate_plans(id),
  nightly_rate_cents INTEGER NOT NULL,
  source_id          INTEGER REFERENCES sources(id),
  status             TEXT NOT NULL CHECK (status IN ('tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  eta                TEXT,
  checked_in_at      TEXT,
  checked_out_at     TEXT,
  cancelled_at       TEXT,
  tags               TEXT NOT NULL DEFAULT '[]', -- JSON: early, late, anniversary, first-stay
  notes              TEXT NOT NULL DEFAULT '',   -- internal note (tape chart)
  requests           TEXT NOT NULL DEFAULT '',   -- guest requests from the booking form
  room_total_cents   INTEGER NOT NULL,
  tax_cents          INTEGER NOT NULL,
  extras_cents       INTEGER NOT NULL DEFAULT 0,
  total_cents        INTEGER NOT NULL,
  paid_cents         INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS reservations_dates ON reservations(arrival, departure);
CREATE INDEX IF NOT EXISTS reservations_room ON reservations(room_id, arrival, departure);
CREATE INDEX IF NOT EXISTS reservations_guest ON reservations(guest_id);
CREATE INDEX IF NOT EXISTS reservations_status ON reservations(status);

CREATE TABLE IF NOT EXISTS reservation_extras (
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  extra_id       INTEGER NOT NULL REFERENCES extras(id),
  amount_cents   INTEGER NOT NULL,
  PRIMARY KEY (reservation_id, extra_id)
);

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
  id           INTEGER PRIMARY KEY,
  task_date    TEXT NOT NULL,
  room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('departure', 'stayover', 'maintenance')),
  title        TEXT NOT NULL,
  minutes      INTEGER NOT NULL CHECK (minutes > 0),
  attendant_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT,                        -- staff note shown as a chip
  note_tone    TEXT,                        -- '', 'amber', 'gold', 'blue'
  done_at      TEXT,
  done_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS housekeeping_tasks_date ON housekeeping_tasks(task_date);

CREATE TABLE IF NOT EXISTS handover_notes (
  id          INTEGER PRIMARY KEY,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  department  TEXT NOT NULL,
  lead        TEXT NOT NULL,                -- shown in bold
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  icon       TEXT NOT NULL,
  tone       TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (notification_id, user_id)
);

-- One row per closed business day (night audit), used for trends.
CREATE TABLE IF NOT EXISTS daily_stats (
  date               TEXT PRIMARY KEY,
  rooms_available    INTEGER NOT NULL,
  rooms_sold         INTEGER NOT NULL,
  room_revenue_cents INTEGER NOT NULL,
  adr_cents          INTEGER NOT NULL,
  revpar_cents       INTEGER NOT NULL,
  closed_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at          TEXT
);

-- Revenue by outlet and day (rooms are posted by the night audit; other outlets are entered by staff).
CREATE TABLE IF NOT EXISTS revenue (
  date         TEXT NOT NULL,
  outlet       TEXT NOT NULL CHECK (outlet IN ('rooms', 'fnb', 'spa')),
  amount_cents INTEGER NOT NULL,
  PRIMARY KEY (date, outlet)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT NOT NULL,
  action     TEXT NOT NULL,
  summary    TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_log_time ON activity_log(created_at);
