-- Idempotency and audit metadata for signed channel-manager callbacks.
-- Raw webhook bodies are deliberately not stored because they can contain guest data.
CREATE TABLE integration_events (
  id                  INTEGER PRIMARY KEY,
  provider            TEXT NOT NULL,
  external_event_id   TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status              TEXT NOT NULL,
  received_at         TEXT NOT NULL,
  processed_at        TEXT,
  UNIQUE (provider, external_event_id, direction)
);
CREATE INDEX integration_events_status ON integration_events(status, received_at);
