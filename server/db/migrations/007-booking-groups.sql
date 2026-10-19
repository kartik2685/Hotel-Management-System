-- Group bookings (services/groups.js): several rooms booked together for a wedding or a conference, under one name
-- and contact, checked in together and billed on one invoice. Each room stays a booking of its own.
CREATE TABLE booking_groups (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  company       TEXT,
  gstin         TEXT,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
ALTER TABLE reservations ADD COLUMN group_id INTEGER REFERENCES booking_groups(id) ON DELETE SET NULL;
CREATE INDEX reservations_group ON reservations(group_id);
