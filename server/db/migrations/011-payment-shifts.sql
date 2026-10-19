-- Record the staff member's active shift when a payment is entered, for shift-close reporting.
-- Automated/online records use "Online"; legacy imported rows remain blank and report as Unassigned.
ALTER TABLE payments ADD COLUMN shift TEXT NOT NULL DEFAULT '';
CREATE INDEX payments_created_shift ON payments(created_at, shift, taken_by_name);
