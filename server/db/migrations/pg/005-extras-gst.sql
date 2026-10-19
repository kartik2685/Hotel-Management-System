-- Twin of ../005-extras-gst.sql: GST on extras.
ALTER TABLE extras ADD COLUMN IF NOT EXISTS gst_kind text COLLATE "C" NOT NULL DEFAULT 'none';
ALTER TABLE reservation_extras ADD COLUMN IF NOT EXISTS gst_kind text COLLATE "C" NOT NULL DEFAULT 'none';
ALTER TABLE reservation_extras ADD COLUMN IF NOT EXISTS tax_bp bigint NOT NULL DEFAULT 0;
ALTER TABLE reservation_extras ADD COLUMN IF NOT EXISTS tax_cents bigint NOT NULL DEFAULT 0;
