-- Optional online checkout attempts. These rows are separate from the payment ledger;
-- only a verified webhook may create a `payments` row.
CREATE TABLE payment_attempts (
  id                   INTEGER PRIMARY KEY,
  reservation_id       INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL UNIQUE,
  order_id             TEXT NOT NULL UNIQUE,
  provider_payment_id  TEXT UNIQUE,
  amount_cents         INTEGER NOT NULL CHECK (amount_cents > 0),
  currency             TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('creating', 'active', 'success', 'failed', 'expired', 'cancelled', 'review')),
  checkout_url         TEXT,
  utr                  TEXT,
  recorded_payment_id  INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX payment_attempts_reservation ON payment_attempts(reservation_id, created_at);
CREATE UNIQUE INDEX payment_attempts_one_open_per_reservation ON payment_attempts(reservation_id) WHERE status IN ('creating', 'active');
