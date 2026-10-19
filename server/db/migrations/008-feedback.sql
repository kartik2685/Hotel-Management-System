-- Guest feedback after check-out (services/feedback.js): one answer per booking, from the guest's signed link.
CREATE TABLE feedback (
  id             INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  created_at     TEXT NOT NULL
);
