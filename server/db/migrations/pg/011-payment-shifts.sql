-- Twin of ../011-payment-shifts.sql.
ALTER TABLE payments ADD COLUMN shift text COLLATE "C" NOT NULL DEFAULT '';
CREATE INDEX payments_created_shift ON payments(created_at, shift, taken_by_name);
