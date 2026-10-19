-- Version 2: guest website, registration cards (GRC) and Form III, payments, invoices, email outbox, password resets.

-- Guest registration details (India: GRC; foreign guests: passport and visa for Form III)
ALTER TABLE guests ADD COLUMN nationality TEXT;          -- ISO 3166 code, e.g. 'IN'
ALTER TABLE guests ADD COLUMN address TEXT;
ALTER TABLE guests ADD COLUMN date_of_birth TEXT;
ALTER TABLE guests ADD COLUMN id_type TEXT;
ALTER TABLE guests ADD COLUMN id_number TEXT;
ALTER TABLE guests ADD COLUMN passport_number TEXT;
ALTER TABLE guests ADD COLUMN visa_number TEXT;
ALTER TABLE guests ADD COLUMN visa_type TEXT;
ALTER TABLE guests ADD COLUMN visa_valid_until TEXT;
ALTER TABLE guests ADD COLUMN arrived_in_india TEXT;
ALTER TABLE guests ADD COLUMN port_of_arrival TEXT;
ALTER TABLE guests ADD COLUMN gstin TEXT;                -- company GSTIN for B2B invoices

ALTER TABLE reservations ADD COLUMN purpose TEXT;
ALTER TABLE reservations ADD COLUMN arriving_from TEXT;
ALTER TABLE reservations ADD COLUMN going_to TEXT;
ALTER TABLE reservations ADD COLUMN grc_at TEXT;
ALTER TABLE reservations ADD COLUMN grc_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reservations ADD COLUMN form3_arrival_ref TEXT;
ALTER TABLE reservations ADD COLUMN form3_arrival_at TEXT;
ALTER TABLE reservations ADD COLUMN form3_departure_ref TEXT;
ALTER TABLE reservations ADD COLUMN form3_departure_at TEXT;
ALTER TABLE reservations ADD COLUMN booked_online INTEGER NOT NULL DEFAULT 0;

-- What the guest website shows
ALTER TABLE room_types ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE room_types ADD COLUMN photo TEXT NOT NULL DEFAULT '';
ALTER TABLE room_types ADD COLUMN bed TEXT NOT NULL DEFAULT '';
ALTER TABLE room_types ADD COLUMN size_sqm INTEGER;
ALTER TABLE room_types ADD COLUMN online INTEGER NOT NULL DEFAULT 1;

ALTER TABLE rate_plans ADD COLUMN free_cancel_days INTEGER;  -- NULL means non-refundable
ALTER TABLE rate_plans ADD COLUMN online INTEGER NOT NULL DEFAULT 1;

CREATE TABLE payments (
  id             INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,                  -- negative for a refund
  method         TEXT NOT NULL,
  reference      TEXT NOT NULL DEFAULT '',
  taken_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  taken_by_name  TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX payments_reservation ON payments(reservation_id);

CREATE TABLE invoices (
  id             INTEGER PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  status         TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  issued_at      TEXT NOT NULL,
  issued_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  data           TEXT NOT NULL,                     -- JSON snapshot of everything printed on it
  total_cents    INTEGER NOT NULL,
  cancelled_at   TEXT
);
CREATE INDEX invoices_reservation ON invoices(reservation_id);

CREATE TABLE outbox (
  id         INTEGER PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'logged')),
  error      TEXT,
  created_at TEXT NOT NULL,
  sent_at    TEXT
);

CREATE TABLE password_resets (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
