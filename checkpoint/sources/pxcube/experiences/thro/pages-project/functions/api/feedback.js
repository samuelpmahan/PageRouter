// thro card feedback endpoint (ask.html, "Which cards would you put on screen?").
//
// This is the ENTRY POINT OF A DATA PIPELINE: every row written here is raw data that later analysis will trust.
//
// POST /api/feedback  {answerId, revision, picks: [card ids], clientVersion, note?, seconds?, device?}
//   answerId   one random UUID v4 per page visit, minted by the page (crypto.randomUUID)
//   revision   1, 2, 3 ... bumped by the page only when the picks or the note actually change
//   (answerId, revision) is the row's identity. A repeat of the same pair is a no-op that answers 200 {duplicate: true}
//   with the ORIGINAL receivedAt; content is never hashed to decide identity.
// GET  /api/feedback  -> {total, counts: {card: n}} from the small derived table feedback_counts (12 rows, not O(answers)).
//   Notes are never returned. Cached for LIMITS.getCacheSeconds.
//
// Tables (migrations/0002): feedback is RAW and append-only (nothing here ever UPDATEs or DELETEs it; triggers also forbid it).
// feedback_counts / feedback_daily are DERIVED and are changed in the SAME D1 batch as the insert, only when the insert happened.
// sql/recompute-counts.sql rebuilds them from feedback; sql/check-counts.sql proves they agree.

// ---- every number that bounds this endpoint lives here (migrations/0002 mirrors revisions, picks and note in CHECKs) ----
const LIMITS = Object.freeze({
  maxBodyBytes: 4096,          // POST body, bytes -> 413 payload_too_large
  maxPicks: 30,                // length of the picks array as sent -> 400 too_many_picks
  maxNoteChars: 600,           // note, characters after trim -> 400 note_too_long
  maxRevisions: 20,            // highest revision number per answerId -> 400 too_many_revisions
  maxSeconds: 86400,           // plausible time-on-page
  rateLimitPerMinute: 10,      // accepted-shape POSTs per client per 60 s window (D1 counter) -> 429 rate_limited
  isolateBurstPerMinute: 30,   // POSTs of any shape per client per 60 s per Worker isolate (memory only, costs no D1) -> 429 rate_limited
  dailyWriteCap: 2000,         // rows accepted per UTC day, all clients -> 503 daily_cap_reached
  getCacheSeconds: 30,         // Cache-Control max-age and edge-cache lifetime of GET
});
const SCHEMA_VERSION = 2;      // version of the stored row contract (migrations/0002); 1 = the pre-migration table
const PAGE = 'ask';
const CARDS = Object.freeze(['u01', 'u02', 'u03-front', 'u03-behind', 'u04', 'u05', 'b01', 'b02', 'b03', 'b04', 'b05', 'p01']);
const TOTAL_KEY = '_answers';  // reserved row of feedback_counts: number of distinct answerIds
// --------------------------------------------------------------------------------------------------------------------

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENT_VERSION = /^[A-Za-z0-9._@+-]{1,40}$/;
const FIELDS = new Set(['answerId', 'revision', 'picks', 'note', 'seconds', 'device', 'clientVersion']);
// Used to key the rate limiter when the Pages secret CLIENT_KEY_SECRET is not set. Set the secret in production (see the report).
const FALLBACK_PEPPER = 'thro-feedback-rate-limit-v1';

const MESSAGES = {
  bad_origin: 'This request did not come from the thro page.',
  method_not_allowed: 'Use GET or POST.',
  unsupported_media_type: 'Send JSON (content-type: application/json).',
  payload_too_large: `That answer is too large (limit ${LIMITS.maxBodyBytes} bytes).`,
  invalid_json: 'The request body was not a JSON object.',
  unknown_field: 'The request had a field this endpoint does not accept.',
  bad_answer_id: 'answerId must be a lowercase UUID v4.',
  bad_revision: 'revision must be a whole number from 1.',
  too_many_revisions: `An answer can be revised at most ${LIMITS.maxRevisions} times.`,
  no_picks: 'Pick at least one card.',
  bad_picks: 'picks must be an array of card ids.',
  too_many_picks: `At most ${LIMITS.maxPicks} picks.`,
  unknown_card: 'One of the picks is not a known card.',
  duplicate_pick: 'A card can be picked only once.',
  bad_note: 'note must be text.',
  note_too_long: `Keep the note under ${LIMITS.maxNoteChars} characters.`,
  bad_seconds: `seconds must be a whole number from 0 to ${LIMITS.maxSeconds}.`,
  bad_device: 'device must be "phone" or "computer".',
  bad_client_version: 'clientVersion must be 1-40 letters, digits or . _ @ + -',
  rate_limited: 'Too many sends in a minute. Wait a moment and send again; your text is still copied for Slack.',
  daily_cap_reached: 'Saving answers is paused for today. Your text is still copied: paste it in the Slack thread.',
  storage_error: 'Could not save just now. Your text is still copied: paste it in the Slack thread.',
};

const STATUS = {
  bad_origin: 403, method_not_allowed: 405, unsupported_media_type: 415, payload_too_large: 413,
  rate_limited: 429, storage_error: 500, daily_cap_reached: 503,
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, 'cache-control': 'no-store', ...extra } });
const fail = (error, extra = {}) => json({ ok: false, error, message: MESSAGES[error] }, STATUS[error] ?? 400, extra);

// ---------- reading ----------
async function readCounts(db) {
  const { results } = await db.prepare('SELECT key, n FROM feedback_counts').all();
  return tallyOf(results);
}
function tallyOf(rows) {
  const counts = Object.fromEntries(CARDS.map(c => [c, 0]));
  let total = 0;
  for (const { key, n } of rows) { if (key === TOTAL_KEY) total = n; else if (key in counts) counts[key] = n; }
  return { total, counts };
}
const cacheKeyFor = request => new Request(new URL('/api/feedback', request.url).href, { method: 'GET' });  // query string ignored so ?x=random cannot bypass the cache

export async function onRequestGet({ request, env, waitUntil }) {
  let cache = null;
  try { cache = caches.default; const hit = await cache.match(cacheKeyFor(request)); if (hit) return hit; } catch { cache = null; }
  let tally;
  try { tally = await readCounts(env.FEEDBACK); } catch (e) { console.error('feedback read failed:', e?.message); return fail('storage_error'); }
  const res = json(tally, 200, { 'cache-control': `public, max-age=${LIMITS.getCacheSeconds}` });
  if (cache) { try { waitUntil?.(cache.put(cacheKeyFor(request), res.clone())); } catch { /* caching is an optimisation only */ } }
  return res;
}

// ---------- validation ----------
async function readBody(request, max) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return undefined; }
}

// Returns {v} on success or {error}. Pure: touches no storage, so rejected requests cost no D1.
function validate(b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return { error: 'invalid_json' };
  for (const k of Object.keys(b)) if (!FIELDS.has(k)) return { error: 'unknown_field' };
  if (typeof b.answerId !== 'string' || !UUID_V4.test(b.answerId)) return { error: 'bad_answer_id' };
  if (!Number.isInteger(b.revision) || b.revision < 1) return { error: 'bad_revision' };
  if (b.revision > LIMITS.maxRevisions) return { error: 'too_many_revisions' };
  if (!Array.isArray(b.picks)) return { error: 'bad_picks' };
  if (b.picks.length > LIMITS.maxPicks) return { error: 'too_many_picks' };
  if (!b.picks.length) return { error: 'no_picks' };
  for (const p of b.picks) if (typeof p !== 'string' || !CARDS.includes(p)) return { error: 'unknown_card' };
  if (new Set(b.picks).size !== b.picks.length) return { error: 'duplicate_pick' };
  let note = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== 'string') return { error: 'bad_note' };
    const t = b.note.trim();
    if ([...t].length > LIMITS.maxNoteChars) return { error: 'note_too_long' };
    note = t || null;
  }
  let seconds = null;
  if (b.seconds !== undefined && b.seconds !== null) {
    if (!Number.isInteger(b.seconds) || b.seconds < 0 || b.seconds > LIMITS.maxSeconds) return { error: 'bad_seconds' };
    seconds = b.seconds;
  }
  let device = null;
  if (b.device !== undefined && b.device !== null) {
    if (b.device !== 'phone' && b.device !== 'computer') return { error: 'bad_device' };
    device = b.device;
  }
  if (typeof b.clientVersion !== 'string' || !CLIENT_VERSION.test(b.clientVersion)) return { error: 'bad_client_version' };
  return { v: { answerId: b.answerId, revision: b.revision, picks: [...b.picks].sort(), note, seconds, device, clientVersion: b.clientVersion } };
}

// ---------- rate limiting ----------
// Cloudflare's Rate Limiting binding (`ratelimits` in wrangler config) is NOT available to Pages Functions (Workers only), so:
//  1. a per-isolate in-memory counter absorbs floods without touching D1;
//  2. a D1 counter (table rate_limit, one row per client bucket) enforces the real per-minute limit across isolates. Once a client is
//     over the limit the upsert changes nothing, so a flood costs D1 reads only, never writes.
// The client bucket is HMAC-SHA256(CLIENT_KEY_SECRET, network) truncated to 24 hex chars: the IP itself is never stored or logged.
const bursts = new Map();
function isolateAllows(client, nowSec) {
  const win = Math.floor(nowSec / 60);
  if (bursts.size > 2000) bursts.clear();
  let e = bursts.get(client);
  if (!e || e.win !== win) { e = { win, n: 0 }; bursts.set(client, e); }
  return ++e.n <= LIMITS.isolateBurstPerMinute;
}
function networkOf(ip) {  // IPv6 clients are bucketed by /64 so one machine cannot rotate through its whole prefix
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return 'v6:' + groups.slice(0, 4).map(g => g.toLowerCase().padStart(4, '0')).join(':');
}
async function clientBucket(request, env) {
  const net = networkOf(request.headers.get('cf-connecting-ip') || 'unknown');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.CLIENT_KEY_SECRET || FALLBACK_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(net)));
  return Array.from(sig.slice(0, 12), x => x.toString(16).padStart(2, '0')).join('');
}
// n is incremented only while below the limit; over the limit the conflict branch is skipped, no row changes, RETURNING yields nothing.
const RATE_SQL = `INSERT INTO rate_limit (client, window_start, n) VALUES (?1, ?2, 1)
  ON CONFLICT (client) DO UPDATE SET n = CASE WHEN window_start = ?2 THEN n + 1 ELSE 1 END, window_start = ?2
  WHERE window_start <> ?2 OR n < ?3
  RETURNING n`;

// ---------- write ----------
// One D1 batch = one transaction. Statement 1 is the only INSERT into feedback and is atomic (ON CONFLICT DO NOTHING), so three
// identical parallel POSTs yield exactly one row. Every later statement is guarded by "the row with MY ingest_id exists", so
// a duplicate (or a request stopped by the daily cap) changes nothing.
const MINE = `EXISTS (SELECT 1 FROM feedback WHERE answer_id = ?1 AND revision = ?2 AND ingest_id = ?4)`;
function writeBatch(db, v, now, ingestId) {
  const day = now.slice(0, 10), picks = JSON.stringify(v.picks);
  const prevPicks = `COALESCE((SELECT picks FROM feedback WHERE answer_id = ?1 AND revision < ?2 ORDER BY revision DESC LIMIT 1), '[]')`;
  return [
    // 0. the append-only raw row, unless the key exists already or today's cap is spent
    db.prepare(`INSERT INTO feedback (answer_id, revision, received_at, schema_version, client_version, page, picks, note, seconds, device, ingest_id)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
      WHERE COALESCE((SELECT answers FROM feedback_daily WHERE day = ?12), 0) < ?13
      ON CONFLICT (answer_id, revision) DO NOTHING`)
      .bind(v.answerId, v.revision, now, SCHEMA_VERSION, v.clientVersion, PAGE, picks, v.note, v.seconds, v.device, ingestId, day, LIMITS.dailyWriteCap),
    // 1. derived: today's accepted-row counter
    db.prepare(`INSERT INTO feedback_daily (day, answers) SELECT ?1, 1 WHERE EXISTS (SELECT 1 FROM feedback WHERE answer_id = ?2 AND revision = ?3 AND ingest_id = ?4)
      ON CONFLICT (day) DO UPDATE SET answers = answers + 1`).bind(day, v.answerId, v.revision, ingestId),
    // 2. derived: per-card counts. Only when this row is the answer's latest revision, move each card by (+1 if newly picked, -1 if dropped)
    //    relative to the previous latest revision; cards picked in both are not touched. A late revision 1 after revision 2 changes nothing.
    db.prepare(`UPDATE feedback_counts
      SET n = n + (key IN (SELECT value FROM json_each(?3))) - (key IN (SELECT value FROM json_each(${prevPicks})))
      WHERE key <> '${TOTAL_KEY}' AND ${MINE}
        AND NOT EXISTS (SELECT 1 FROM feedback WHERE answer_id = ?1 AND revision > ?2)
        AND (key IN (SELECT value FROM json_each(?3))) <> (key IN (SELECT value FROM json_each(${prevPicks})))`)
      .bind(v.answerId, v.revision, picks, ingestId),
    // 3. derived: distinct answers, +1 only for the first row ever stored for this answerId
    db.prepare(`UPDATE feedback_counts SET n = n + 1 WHERE key = '${TOTAL_KEY}' AND ${MINE}
      AND NOT EXISTS (SELECT 1 FROM feedback WHERE answer_id = ?1 AND revision <> ?2)`).bind(v.answerId, v.revision, null, ingestId),
    // 4. housekeeping: forget rate-limit buckets idle for an hour (bounded)
    db.prepare(`DELETE FROM rate_limit WHERE client IN (SELECT client FROM rate_limit WHERE window_start < ?1 LIMIT 50)`).bind(Math.floor(Date.parse(now) / 1000) - 3600),
    // 5. what is stored under this key now (mine, or the original)
    db.prepare(`SELECT f.received_at, f.picks, f.note, f.ingest_id,
        NOT EXISTS (SELECT 1 FROM feedback n WHERE n.answer_id = f.answer_id AND n.revision > f.revision) AS is_latest
      FROM feedback f WHERE f.answer_id = ?1 AND f.revision = ?2`).bind(v.answerId, v.revision),
    // 6. counts for the reply
    db.prepare('SELECT key, n FROM feedback_counts'),
  ];
}

export async function onRequestPost({ request, env, waitUntil }) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return fail('bad_origin');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail('unsupported_media_type');

  const nowSec = Math.floor(Date.now() / 1000);
  const client = await clientBucket(request, env);
  const retryAfter = { 'retry-after': String(60 - (nowSec % 60)) };
  if (!isolateAllows(client, nowSec)) return fail('rate_limited', retryAfter);

  const text = await readBody(request, LIMITS.maxBodyBytes);
  if (text === null) return fail('payload_too_large');
  let body; try { body = JSON.parse(text); } catch { return fail('invalid_json'); }
  const checked = validate(body);
  if (checked.error) return fail(checked.error);
  const v = checked.v;

  try {
    const allowed = await env.FEEDBACK.prepare(RATE_SQL).bind(client, nowSec - (nowSec % 60), LIMITS.rateLimitPerMinute).first();
    if (!allowed) return fail('rate_limited', retryAfter);

    const now = new Date().toISOString(), ingestId = crypto.randomUUID();
    const out = await env.FEEDBACK.batch(writeBatch(env.FEEDBACK, v, now, ingestId));
    const row = out[5].results[0];
    if (!row) return fail('daily_cap_reached', { 'retry-after': '3600' });  // nothing stored under this key and nothing was inserted: the cap
    const duplicate = row.ingest_id !== ingestId;
    const reply = { ok: true, duplicate, answerId: v.answerId, revision: v.revision, receivedAt: row.received_at, counted: row.is_latest === 1, tally: tallyOf(out[6].results) };
    if (duplicate) reply.contentMatches = row.picks === JSON.stringify(v.picks) && (row.note ?? null) === v.note;
    else { try { waitUntil?.(caches.default.delete(cacheKeyFor(request))); } catch { /* cache is optional */ } }
    return json(reply);
  } catch (e) {
    console.error('feedback write failed:', e?.message);   // message only: never the payload, never the IP
    return fail('storage_error');
  }
}

// Anything else (PUT, DELETE, OPTIONS ...) is refused; there is no CORS: only the thro page calls this.
export const onRequest = () => fail('method_not_allowed', { allow: 'GET, POST' });
