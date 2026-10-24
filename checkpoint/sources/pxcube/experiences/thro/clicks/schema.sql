-- thro click tracking, Cloudflare D1 (SQLite). Bound to the Pages project as CLICKS.
-- Apply with: wrangler d1 execute <database-name> --file=schema.sql
--
-- Privacy: a click row holds only the link code, the UTC time, the referring site's
-- hostname and a coarse source. No IP address, user agent, cookie or any other
-- per-person value is stored, so no row can be tied back to a viewer.

CREATE TABLE IF NOT EXISTS links (
  code        TEXT PRIMARY KEY,          -- 7 characters, see CODE_ALPHABET in _worker.js
  destination TEXT NOT NULL,             -- absolute http(s) URL the link redirects to
  label       TEXT,                      -- display text, at most 80 characters
  card        TEXT,                      -- JSON object describing the card, at most 1024 bytes
  created     TEXT NOT NULL              -- ISO 8601 UTC, e.g. 2026-10-24T15:04:05.000Z
);

CREATE TABLE IF NOT EXISTS clicks (
  code     TEXT NOT NULL REFERENCES links(code),
  at       TEXT NOT NULL,                -- ISO 8601 UTC; substr(at, 1, 10) is the UTC day
  referrer TEXT,                         -- hostname only (www.youtube.com), NULL when no Referer
  source   TEXT NOT NULL CHECK (source IN ('youtube', 'other', 'direct'))
);

CREATE INDEX IF NOT EXISTS clicks_code_at ON clicks (code, at);
