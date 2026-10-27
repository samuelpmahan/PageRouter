-- 0002: idempotent identity (answer_id, revision), append-only raw data, separate derived tables.
--
-- RAW (never updated or deleted; enforced by triggers below):
--   feedback          one row per (answer_id, revision), minted by the client; a repeat of the same key is ignored.
-- DERIVED (recomputable from feedback at any time with sql/recompute-counts.sql, verified by sql/check-counts.sql):
--   feedback_counts   per-card answers (latest revision per answer_id only) + the reserved key '_answers' = distinct answers
--   feedback_daily    rows accepted per UTC day (drives the daily write cap)
--   feedback_latest   VIEW: the latest revision per answer_id (the canonical "one answer per visitor" for analysis)
-- OPERATIONAL scratch (not data, safe to truncate):
--   rate_limit        one row per client bucket (keyed by a keyed hash of the network, never the IP itself)
--
-- Limits mirrored in CHECK constraints (the Function's LIMITS block is the source of truth): 20 revisions, 30 picks, 600 note chars.
-- Existing rows (production has 0) are carried over as revision 1 with schema_version 1 and client_version 'pre-v2'.

CREATE TABLE feedback_v2 (
  answer_id      TEXT    NOT NULL CHECK (length(answer_id) = 36),
  revision       INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 20),
  received_at    TEXT    NOT NULL,                       -- server clock, ISO 8601 UTC
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  client_version TEXT    NOT NULL CHECK (length(client_version) BETWEEN 1 AND 40),
  page           TEXT    NOT NULL DEFAULT 'ask',
  picks          TEXT    NOT NULL CHECK (json_valid(picks) AND json_type(picks) = 'array' AND json_array_length(picks) BETWEEN 1 AND 30),
  note           TEXT    CHECK (note IS NULL OR length(note) <= 600),
  seconds        INTEGER CHECK (seconds IS NULL OR seconds BETWEEN 0 AND 86400),
  device         TEXT    CHECK (device IS NULL OR device IN ('phone', 'computer')),
  ingest_id      TEXT    NOT NULL,                       -- server-minted per accepted row; lets the insert batch tell "mine" from "duplicate"
  PRIMARY KEY (answer_id, revision)
) WITHOUT ROWID;

INSERT INTO feedback_v2 (answer_id, revision, received_at, schema_version, client_version, page, picks, note, seconds, device, ingest_id)
SELECT id, 1, received_at, 1, 'pre-v2', page, picks, note, seconds, device, 'legacy:' || id FROM feedback;

DROP TABLE feedback;                                    -- takes the old received_at index with it
ALTER TABLE feedback_v2 RENAME TO feedback;

CREATE TRIGGER feedback_append_only_update BEFORE UPDATE ON feedback
BEGIN SELECT RAISE(ABORT, 'feedback is append-only: rows are never updated'); END;

CREATE TRIGGER feedback_append_only_delete BEFORE DELETE ON feedback
BEGIN SELECT RAISE(ABORT, 'feedback is append-only: rows are never deleted'); END;

CREATE VIEW feedback_latest AS
SELECT f.* FROM feedback f
WHERE f.revision = (SELECT MAX(revision) FROM feedback WHERE answer_id = f.answer_id);

CREATE TABLE feedback_counts (
  key TEXT PRIMARY KEY,                                  -- a card id, or '_answers' (distinct answer_id count)
  n   INTEGER NOT NULL CHECK (n >= 0)
) WITHOUT ROWID;

INSERT INTO feedback_counts (key, n) VALUES
  ('_answers', 0),
  ('u01', 0), ('u02', 0), ('u03-front', 0), ('u03-behind', 0), ('u04', 0), ('u05', 0),
  ('b01', 0), ('b02', 0), ('b03', 0), ('b04', 0), ('b05', 0);

CREATE TABLE feedback_daily (
  day     TEXT PRIMARY KEY,                              -- YYYY-MM-DD, UTC
  answers INTEGER NOT NULL CHECK (answers >= 0)
) WITHOUT ROWID;

CREATE TABLE rate_limit (
  client       TEXT PRIMARY KEY,                         -- 24 hex chars of HMAC(secret, network); no IP stored
  window_start INTEGER NOT NULL,                         -- unix seconds, start of the 60 s window
  n            INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX rate_limit_window_start ON rate_limit (window_start);

-- Fill the derived tables from whatever was carried over (same statements as sql/recompute-counts.sql).
UPDATE feedback_counts
SET n = (SELECT COUNT(*) FROM feedback_latest l, json_each(l.picks) j WHERE j.value = feedback_counts.key)
WHERE key <> '_answers';
UPDATE feedback_counts SET n = (SELECT COUNT(DISTINCT answer_id) FROM feedback) WHERE key = '_answers';
INSERT INTO feedback_daily (day, answers) SELECT substr(received_at, 1, 10), COUNT(*) FROM feedback GROUP BY 1;
