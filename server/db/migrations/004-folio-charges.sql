-- Charges posted to a guest's bill during the stay (services/folio.js): room service, laundry, minibar…
-- amount_cents is before tax; tax_bp is the tax rate in hundredths of a percent (500 = 5%).
-- reservations.charges_cents is the sum of the open charges with their tax, and is part of total_cents.
CREATE TABLE folio_charges (
  id             INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  description    TEXT NOT NULL,
  sac            TEXT,
  amount_cents   INTEGER NOT NULL,
  tax_bp         INTEGER NOT NULL DEFAULT 0,
  tax_cents      INTEGER NOT NULL DEFAULT 0,
  posted_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  posted_by_name TEXT NOT NULL,
  posted_at      TEXT NOT NULL,
  voided_at      TEXT,
  voided_by_name TEXT
);
CREATE INDEX folio_charges_reservation ON folio_charges(reservation_id);
ALTER TABLE reservations ADD COLUMN charges_cents INTEGER NOT NULL DEFAULT 0;
