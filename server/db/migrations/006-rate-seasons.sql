-- Seasons and weekends (Admin → Rates & extras, services/seasons.js): a different room rate on some nights: a date
-- range (a festival), days of the week (a weekend) or both, for every room type or one. weekdays lists day numbers
-- (0 = Sunday … 6 = Saturday); adjust_value is a percentage, or an amount in paise per night.
CREATE TABLE rate_seasons (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  start_date   TEXT,
  end_date     TEXT,
  weekdays     TEXT NOT NULL DEFAULT '',
  room_type_id INTEGER REFERENCES room_types(id) ON DELETE CASCADE,
  adjust_type  TEXT NOT NULL DEFAULT 'percent' CHECK (adjust_type IN ('percent', 'amount')),
  adjust_value INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
-- A booking whose nights cost different amounts keeps each night's rate (a JSON list in paise); NULL means every
-- night at nightly_rate_cents, which is otherwise the average.
ALTER TABLE reservations ADD COLUMN night_rates TEXT;
