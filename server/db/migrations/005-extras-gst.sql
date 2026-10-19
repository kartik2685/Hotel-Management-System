-- GST on extras (Admin → Rates & extras, services/tax-kinds.js). extras.gst_kind is 'none' (untaxed, as before),
-- 'room' (part of the stay: the room's rate) or a kind of service ('transport', 'fnb', 'other'…).
-- Each booked extra keeps its kind, rate (hundredths of a percent) and tax; the tax is part of reservations.tax_cents.
ALTER TABLE extras ADD COLUMN gst_kind TEXT NOT NULL DEFAULT 'none';
ALTER TABLE reservation_extras ADD COLUMN gst_kind TEXT NOT NULL DEFAULT 'none';
ALTER TABLE reservation_extras ADD COLUMN tax_bp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservation_extras ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;
