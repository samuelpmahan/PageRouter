-- 0001: the feedback table exactly as it exists in production today (created by hand before migrations were tracked).
-- IF NOT EXISTS makes this a no-op on production and creates the same table on a fresh (local/test) database.
-- The received_at index is named here; if production's index has another name, 0002 drops the whole table, indexes included.
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  picks       TEXT NOT NULL,
  note        TEXT,
  seconds     INTEGER,
  device      TEXT,
  page        TEXT NOT NULL DEFAULT 'ask'
);
CREATE INDEX IF NOT EXISTS feedback_received_at ON feedback (received_at);
