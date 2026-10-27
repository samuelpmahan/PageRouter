// End-to-end tests for functions/api/feedback.js, run against the REAL function in `wrangler pages dev` with a LOCAL D1.
//   cd pages-project && npm install && npm test          (Node >= 22.13: uses node:sqlite to inspect the local database)
// Safety: the test stages a copy of functions/ + migrations/ in a temp dir with an all-zero database_id and never passes --remote,
// so it cannot touch the production database (daf43f8e-...).
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { console.error('This test needs Node >= 22.13 (node:sqlite).'); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url)), project = resolve(here, '..'), thro = resolve(project, '..');
const wranglerBin = join(project, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const CARDS = ['u01', 'u02', 'u03-front', 'u03-behind', 'u04', 'u05', 'b01', 'b02', 'b03', 'b04', 'b05'];
const sql = name => readFileSync(join(project, 'sql', name), 'utf8');
const migration = name => readFileSync(join(project, 'migrations', name), 'utf8');
const functionSource = readFileSync(join(project, 'functions', 'api', 'feedback.js'), 'utf8');
const wranglerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' };
for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_KEY']) delete wranglerEnv[k];

// ---------------------------------------------------------------- tiny test runner
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}  (${Date.now() - t0} ms)`); }
  catch (e) { results.push({ name, ok: false, e }); console.log(`FAIL  ${name}\n      ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n      ')}`); }
}
const canon = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x);   // key order never matters
function eq(actual, expected, what = '') {
  const a = canon(actual), b = canon(expected);
  if (a !== b) throw new Error(`${what} expected ${b} but got ${a}`);
}
function ok(cond, what) { if (!cond) throw new Error(what); }

// ---------------------------------------------------------------- 0. SQL-only checks (in-memory sqlite): migrations, recompute, check, append-only
await test('migration 0002 carries legacy rows over and fills the derived tables; recompute fixes corruption; check detects it', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration('0001_initial_feedback.sql'));
  const ins = db.prepare('INSERT INTO feedback (id, received_at, picks, note, seconds, device, page) VALUES (?,?,?,?,?,?,?)');
  ins.run(randomUUID(), '2026-10-26T10:00:00.000Z', JSON.stringify(['u01', 'b02']), 'old note', 30, 'phone', 'ask');
  ins.run(randomUUID(), '2026-10-26T11:00:00.000Z', JSON.stringify(['u01']), null, null, null, 'ask');
  ins.run(randomUUID(), '2026-10-27T09:00:00.000Z', JSON.stringify(['b05', 'u03-front']), null, 5, 'computer', 'ask');
  db.exec(migration('0002_idempotent_append_only.sql'));
  const counts = Object.fromEntries(db.prepare('SELECT key, n FROM feedback_counts').all().map(r => [r.key, r.n]));
  eq(counts, { _answers: 3, u01: 2, u02: 0, 'u03-front': 1, 'u03-behind': 0, u04: 0, u05: 0, b01: 0, b02: 1, b03: 0, b04: 0, b05: 1 }, 'counts after migration');
  eq(db.prepare('SELECT day, answers FROM feedback_daily ORDER BY day').all().map(r => [r.day, r.answers]), [['2026-10-26', 2], ['2026-10-27', 1]], 'daily');
  const row = db.prepare("SELECT revision, schema_version, client_version, page FROM feedback WHERE note = 'old note'").get();
  eq({ ...row }, { revision: 1, schema_version: 1, client_version: 'pre-v2', page: 'ask' }, 'legacy row provenance');
  eq(db.prepare(sql('check-counts.sql')).all().length, 0, 'check-counts right after migration');
  db.exec("UPDATE feedback_counts SET n = n + 5 WHERE key = 'u01'; DELETE FROM feedback_daily WHERE day = '2026-10-26'; UPDATE feedback_counts SET n = 0 WHERE key = '_answers';");
  ok(db.prepare(sql('check-counts.sql')).all().length >= 3, 'check-counts must flag the corruption');
  db.exec(sql('recompute-counts.sql'));
  eq(db.prepare(sql('check-counts.sql')).all().length, 0, 'check-counts after recompute');
  eq(Object.fromEntries(db.prepare('SELECT key, n FROM feedback_counts').all().map(r => [r.key, r.n])), counts, 'recompute restores the same counts');
});

await test('0002 on an empty database: 11 cards + _answers seeded at 0, matching the CARDS list in feedback.js', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration('0001_initial_feedback.sql')); db.exec(migration('0002_idempotent_append_only.sql'));
  const keys = db.prepare('SELECT key FROM feedback_counts ORDER BY key').all().map(r => r.key);
  const inSource = /const CARDS = Object\.freeze\((\[[^\]]*\])\)/.exec(functionSource);
  ok(inSource, 'CARDS not found in feedback.js');
  eq(JSON.parse(inSource[1].replace(/'/g, '"')), CARDS, 'CARDS in feedback.js');
  eq(keys, ['_answers', ...CARDS].sort(), 'seeded keys');
});

await test('the raw table is append-only: UPDATE and DELETE raise, and the function source never issues them', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration('0001_initial_feedback.sql')); db.exec(migration('0002_idempotent_append_only.sql'));
  db.exec("INSERT INTO feedback (answer_id, revision, received_at, schema_version, client_version, picks, ingest_id) VALUES ('11111111-1111-4111-8111-111111111111', 1, '2026-10-27T00:00:00.000Z', 2, 't', '[\"u01\"]', 'x')");
  let msg = ''; try { db.exec("UPDATE feedback SET picks = '[\"u02\"]'"); } catch (e) { msg = e.message; }
  ok(/append-only/.test(msg), `UPDATE must be refused by trigger (got "${msg}")`);
  msg = ''; try { db.exec('DELETE FROM feedback'); } catch (e) { msg = e.message; }
  ok(/append-only/.test(msg), `DELETE must be refused by trigger (got "${msg}")`);
  ok(!/\bUPDATE\s+feedback\s/i.test(functionSource) && !/\bDELETE\s+FROM\s+feedback\s/i.test(functionSource), 'feedback.js must contain no UPDATE/DELETE on feedback');
});

// ---------------------------------------------------------------- stage + start the real function on a local D1
const tmp = mkdtempSync(join(tmpdir(), 'thro-feedback-test-')), state = join(tmp, 'state');
mkdirSync(join(tmp, 'site')); writeFileSync(join(tmp, 'site', 'index.html'), '<!doctype html><title>t</title>');
cpSync(join(project, 'functions'), join(tmp, 'functions'), { recursive: true }); cpSync(join(project, 'migrations'), join(tmp, 'migrations'), { recursive: true });
writeFileSync(join(tmp, 'wrangler.toml'), readFileSync(join(project, 'wrangler.toml'), 'utf8').replace(/database_id = ".*"/, 'database_id = "00000000-0000-4000-8000-000000000000"'));
ok(!readFileSync(join(tmp, 'wrangler.toml'), 'utf8').includes('daf43f8e'), 'staged config must not carry the production database id');

const mig = spawnSync(process.execPath, [wranglerBin, 'd1', 'migrations', 'apply', 'thro-feedback', '--local', '--persist-to', state], { cwd: tmp, env: wranglerEnv, encoding: 'utf8' });
if (mig.status !== 0) { console.error(mig.stdout, mig.stderr); process.exit(2); }
const port = await new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [wranglerBin, 'pages', 'dev', 'site', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state], { cwd: tmp, env: wranglerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
const stop = () => { try { process.platform === 'win32' ? spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']) : server.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', stop);
for (let i = 0; i < 120 && !/Ready on/.test(serverLog); i++) await new Promise(r => setTimeout(r, 500));
if (!/Ready on/.test(serverLog)) { console.error('wrangler pages dev did not start:\n' + serverLog); stop(); process.exit(2); }
const base = `http://127.0.0.1:${port}/api/feedback`;

const dbFile = (function find(dir) { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) { const f = find(p); if (f) return f; } else if (e.name.endsWith('.sqlite') && !e.name.includes('metadata')) return p; } return null; })(state);
const db = new DatabaseSync(dbFile); db.exec('PRAGMA busy_timeout = 5000');
const all = (q, ...a) => db.prepare(q).all(...a).map(r => ({ ...r }));
const one = (q, ...a) => all(q, ...a)[0];
const rawCount = () => one('SELECT COUNT(*) AS c FROM feedback').c;
const derived = () => ({ counts: Object.fromEntries(all('SELECT key, n FROM feedback_counts').map(r => [r.key, r.n])), daily: all('SELECT day, answers FROM feedback_daily ORDER BY day') });

// ---------------------------------------------------------------- http helpers
let ipSeq = 0;
const freshIp = () => { ipSeq++; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`; };
const usedIps = new Set();
async function post(body, { ip = freshIp(), headers = {}, raw, method = 'POST', contentType = 'application/json' } = {}) {
  usedIps.add(ip);
  const r = await fetch(base, { method, headers: { ...(contentType ? { 'content-type': contentType } : {}), 'cf-connecting-ip': ip, 'user-agent': 'THRO-TEST-UA/1.0', ...headers }, body: raw ?? JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* keep null */ }
  return { status: r.status, headers: r.headers, json: j, text };
}
const answer = (over = {}) => ({ answerId: randomUUID(), revision: 1, picks: ['u01'], clientVersion: 'test@1', ...over });
const getTally = async (qs = '') => { const r = await fetch(base + qs); return { status: r.status, headers: r.headers, text: await r.text() }; };

// ---------------------------------------------------------------- 1. the headline cases
await test('triple-click: 3 identical POSTs fired in parallel -> exactly 1 row, 1 created + 2 duplicate:true, same receivedAt', async () => {
  const body = answer({ picks: ['u01', 'b02'], note: 'triple', seconds: 12, device: 'phone' }), before = rawCount(), ip = freshIp();
  const rs = await Promise.all([post(body, { ip }), post(body, { ip }), post(body, { ip })]);
  eq(rs.map(r => r.status), [200, 200, 200], 'statuses');
  eq(rs.filter(r => r.json.duplicate === false).length, 1, 'exactly one created');
  eq(rs.filter(r => r.json.duplicate === true).length, 2, 'two duplicates');
  eq(new Set(rs.map(r => r.json.receivedAt)).size, 1, 'all three report the original receivedAt');
  eq(rawCount() - before, 1, 'rows added');
  eq(all('SELECT * FROM feedback WHERE answer_id = ?', body.answerId).length, 1, 'rows for this answer');
});

let rev2 = null;
await test('revision 2 of the same answerId replaces revision 1 in the counts (does not add to them)', async () => {
  const s0 = derived().counts, id = randomUUID(), c = n => derived().counts[n];
  const r1 = await post(answer({ answerId: id, picks: ['u01', 'u02'] }));
  eq(r1.json.duplicate, false, 'rev1 created');
  eq([c('u01') - s0.u01, c('u02') - s0.u02, c('b01') - s0.b01, c('_answers') - s0._answers], [1, 1, 0, 1], 'after rev1 (u01,u02)');
  const r2 = await post(answer({ answerId: id, revision: 2, picks: ['u02', 'b01'], note: 'changed my mind' }));
  eq([r2.status, r2.json.duplicate, r2.json.counted], [200, false, true], 'rev2 created and counted');
  eq([c('u01') - s0.u01, c('u02') - s0.u02, c('b01') - s0.b01, c('_answers') - s0._answers], [0, 1, 1, 1], 'after rev2 (u02,b01): u01 dropped, still one answer');
  eq(all('SELECT revision FROM feedback WHERE answer_id = ? ORDER BY revision', id).map(r => r.revision), [1, 2], 'both revisions kept as raw rows');
  eq(r2.json.tally.counts.u01, c('u01'), 'reply tally == table');
  rev2 = { id, after: derived() };
});

await test('retry of revision 1 after revision 2 is a no-op: 200 duplicate:true, nothing changes; changed content under a used key is flagged and not stored', async () => {
  const before = derived(), n = rawCount();
  const same = await post(answer({ answerId: rev2.id, revision: 1, picks: ['u01', 'u02'] }));
  eq([same.status, same.json.duplicate, same.json.counted, same.json.contentMatches], [200, true, false, true], 'retry of rev1');
  const other = await post(answer({ answerId: rev2.id, revision: 1, picks: ['b05'] }));
  eq([other.status, other.json.duplicate, other.json.contentMatches], [200, true, false], 'rev1 resent with other picks');
  eq(rawCount(), n, 'no row added'); eq(derived(), before, 'derived untouched');
  eq(JSON.parse(one('SELECT picks FROM feedback WHERE answer_id = ? AND revision = 1', rev2.id).picks), ['u01', 'u02'], 'original content kept');
});

await test('out-of-order arrival: revision 3 then late 2 and 1 -> counts follow revision 3 only; revision 4 then moves them again', async () => {
  const s0 = derived().counts, id = randomUUID(), d = () => Object.fromEntries(CARDS.concat('_answers').map(k => [k, derived().counts[k] - s0[k]]));
  await post(answer({ answerId: id, revision: 3, picks: ['u04'] }));
  await post(answer({ answerId: id, revision: 2, picks: ['u05'] }));
  const late1 = await post(answer({ answerId: id, revision: 1, picks: ['b05'] }));
  eq(late1.json.counted, false, 'late rev1 not counted');
  eq({ u04: d().u04, u05: d().u05, b05: d().b05, answers: d()._answers }, { u04: 1, u05: 0, b05: 0, answers: 1 }, 'only rev3 counted, one answer');
  eq(all('SELECT COUNT(*) AS c FROM feedback WHERE answer_id = ?', id)[0].c, 3, 'all three raw rows stored');
  await post(answer({ answerId: id, revision: 4, picks: ['b03'] }));
  eq({ u04: d().u04, b03: d().b03, answers: d()._answers }, { u04: 0, b03: 1, answers: 1 }, 'rev4 replaces rev3');
});

// ---------------------------------------------------------------- 2. limits and strict validation
await test('every validation/limit returns its stable error code, the right status, and stores nothing', async () => {
  const n = rawCount(), derivedBefore = JSON.stringify(derived());
  const note600 = 'n'.repeat(600);
  const cases = [
    ['payload_too_large (content-length)', { body: answer({ note: 'x'.repeat(5000) }) }, 413, 'payload_too_large'],
    ['too_many_picks (31)', { body: answer({ picks: Array(31).fill('u01') }) }, 400, 'too_many_picks'],
    ['note_too_long (601)', { body: answer({ note: 'n'.repeat(601) }) }, 400, 'note_too_long'],
    ['note_too_long (601 emoji = code points, not bytes)', { body: answer({ note: '😀'.repeat(601) }) }, 400, 'note_too_long'],
    ['too_many_revisions (21)', { body: answer({ revision: 21 }) }, 400, 'too_many_revisions'],
    ['unknown_card', { body: answer({ picks: ['u01', 'zzz'] }) }, 400, 'unknown_card'],
    ['unknown_card (path-ish)', { body: answer({ picks: ['../x'] }) }, 400, 'unknown_card'],
    ['unknown_card (non-string)', { body: answer({ picks: [1] }) }, 400, 'unknown_card'],
    ['duplicate_pick', { body: answer({ picks: ['u01', 'u01'] }) }, 400, 'duplicate_pick'],
    ['no_picks', { body: answer({ picks: [] }) }, 400, 'no_picks'],
    ['bad_picks (string)', { body: answer({ picks: 'u01' }) }, 400, 'bad_picks'],
    ['bad_picks (missing)', { body: (({ picks, ...r }) => r)(answer()) }, 400, 'bad_picks'],
    ['bad_answer_id (not a uuid)', { body: answer({ answerId: 'abc' }) }, 400, 'bad_answer_id'],
    ['bad_answer_id (UPPERCASE would alias a lowercase id)', { body: answer({ answerId: randomUUID().toUpperCase() }) }, 400, 'bad_answer_id'],
    ['bad_answer_id (uuid v1)', { body: answer({ answerId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' }) }, 400, 'bad_answer_id'],
    ['bad_answer_id (missing)', { body: (({ answerId, ...r }) => r)(answer()) }, 400, 'bad_answer_id'],
    ['bad_revision (0)', { body: answer({ revision: 0 }) }, 400, 'bad_revision'],
    ['bad_revision (-1)', { body: answer({ revision: -1 }) }, 400, 'bad_revision'],
    ['bad_revision (1.5)', { body: answer({ revision: 1.5 }) }, 400, 'bad_revision'],
    ['bad_revision ("1")', { body: answer({ revision: '1' }) }, 400, 'bad_revision'],
    ['bad_revision (missing)', { body: (({ revision, ...r }) => r)(answer()) }, 400, 'bad_revision'],
    ['unknown_field (page)', { body: answer({ page: 'ask' }) }, 400, 'unknown_field'],
    ['unknown_field (id)', { body: answer({ id: 'x' }) }, 400, 'unknown_field'],
    ['bad_note (number)', { body: answer({ note: 5 }) }, 400, 'bad_note'],
    ['bad_seconds (-1)', { body: answer({ seconds: -1 }) }, 400, 'bad_seconds'],
    ['bad_seconds (86401)', { body: answer({ seconds: 86401 }) }, 400, 'bad_seconds'],
    ['bad_seconds (1.5)', { body: answer({ seconds: 1.5 }) }, 400, 'bad_seconds'],
    ['bad_seconds ("5")', { body: answer({ seconds: '5' }) }, 400, 'bad_seconds'],
    ['bad_device', { body: answer({ device: 'tablet' }) }, 400, 'bad_device'],
    ['bad_client_version (missing)', { body: (({ clientVersion, ...r }) => r)(answer()) }, 400, 'bad_client_version'],
    ['bad_client_version (space)', { body: answer({ clientVersion: 'has space' }) }, 400, 'bad_client_version'],
    ['bad_client_version (41 chars)', { body: answer({ clientVersion: 'v'.repeat(41) }) }, 400, 'bad_client_version'],
    ['invalid_json (garbage)', { raw: '{nope' }, 400, 'invalid_json'],
    ['invalid_json (array)', { raw: '[]' }, 400, 'invalid_json'],
    ['invalid_json (null)', { raw: 'null' }, 400, 'invalid_json'],
    ['invalid_json (empty body)', { raw: '' }, 400, 'invalid_json'],
    ['unsupported_media_type', { body: answer(), contentType: 'text/plain' }, 415, 'unsupported_media_type'],
    ['unsupported_media_type (none)', { body: answer(), contentType: null }, 415, 'unsupported_media_type'],
    ['bad_origin', { body: answer(), headers: { origin: 'https://evil.example' } }, 403, 'bad_origin'],
    ['method_not_allowed (PUT)', { body: answer(), method: 'PUT' }, 405, 'method_not_allowed'],
    ['method_not_allowed (DELETE)', { raw: undefined, method: 'DELETE' }, 405, 'method_not_allowed'],
  ];
  for (const [name, o, status, error] of cases) {
    const r = await post(o.body, { raw: o.raw, headers: o.headers, method: o.method, contentType: o.contentType === undefined ? 'application/json' : o.contentType });
    eq([name, r.status, r.json?.ok, r.json?.error], [name, status, false, error], 'case');
    ok(typeof r.json.message === 'string' && r.json.message.length > 0, `${name}: friendly message present`);
  }
  // streamed body with no content-length: the reader must stop at the cap
  const streamed = await fetch(base, { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/json', 'cf-connecting-ip': freshIp() },
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"note":"' + 'x'.repeat(6000) + '"}')); c.close(); } }) });
  eq([streamed.status, (await streamed.json()).error], [413, 'payload_too_large'], 'streamed oversize body');
  // the boundaries themselves are accepted
  const edge = await Promise.all([post(answer({ note: note600 })), post(answer({ note: '😀'.repeat(600) })), post(answer({ revision: 20 })), post(answer({ picks: CARDS })), post(answer({ seconds: 86400, device: 'computer', note: '   ' }))]);
  eq(edge.map(r => r.status), [200, 200, 200, 200, 200], 'boundary values accepted (600 chars, 600 emoji, revision 20, all 11 cards, 86400 s)');
  eq(rawCount() - n, 5, 'only the five boundary rows were stored');
  eq(one("SELECT note FROM feedback WHERE note IS NULL AND seconds = 86400").note, null, 'whitespace-only note stored as NULL');
  ok(JSON.stringify(derived()) !== derivedBefore, 'sanity: boundary rows moved the counts');
});

await test('per-client rate limit: 10 accepted per minute, then 429 rate_limited + Retry-After; a flood costs no D1 writes; other clients unaffected', async () => {
  const secsLeft = () => 60 - (Math.floor(Date.now() / 1000) % 60);
  if (secsLeft() < 20) await new Promise(r => setTimeout(r, (secsLeft() + 1) * 1000));   // stay inside one 60 s window
  const ip = freshIp(), bucket = createHmac('sha256', 'thro-feedback-rate-limit-v1').update(ip).digest('hex').slice(0, 24), n = rawCount();
  const rs = []; for (let i = 0; i < 12; i++) rs.push(await post(answer(), { ip }));
  eq(rs.slice(0, 10).map(r => r.status), Array(10).fill(200), 'first ten');
  eq(rs.slice(10).map(r => [r.status, r.json.error]), [[429, 'rate_limited'], [429, 'rate_limited']], '11th and 12th');
  ok(Number(rs[10].headers.get('retry-after')) >= 1, 'Retry-After header present');
  eq(rawCount() - n, 10, 'only ten rows stored');
  eq(one('SELECT n FROM rate_limit WHERE client = ?', bucket)?.n, 10, 'D1 counter stopped at the limit');
  const flood = await Promise.all(Array.from({ length: 40 }, () => post(answer(), { ip })));
  ok(flood.every(r => r.status === 429 && r.json.error === 'rate_limited'), 'a 40-request flood is all 429');
  eq(one('SELECT n FROM rate_limit WHERE client = ?', bucket).n, 10, 'flood did not write to D1 (counter unchanged)');
  eq(rawCount() - n, 10, 'flood stored nothing');
  eq((await post(answer())).status, 200, 'a different client is unaffected');
  // the D1 counter works across isolates: a fresh bucket in this isolate's memory, but D1 already at the limit
  const ip2 = freshIp(), b2 = createHmac('sha256', 'thro-feedback-rate-limit-v1').update(ip2).digest('hex').slice(0, 24), win = Math.floor(Date.now() / 1000) - (Math.floor(Date.now() / 1000) % 60);
  db.prepare('INSERT INTO rate_limit (client, window_start, n) VALUES (?,?,10)').run(b2, win);
  eq((await post(answer(), { ip: ip2 })).status, 429, 'D1 says over the limit -> 429 without any in-memory history');
  const ip3 = freshIp(), b3 = createHmac('sha256', 'thro-feedback-rate-limit-v1').update(ip3).digest('hex').slice(0, 24);
  db.prepare('INSERT INTO rate_limit (client, window_start, n) VALUES (?,?,10)').run(b3, win - 60);
  eq((await post(answer(), { ip: ip3 })).status, 200, 'an old window resets');
  eq(one('SELECT n, window_start FROM rate_limit WHERE client = ?', b3), { n: 1, window_start: win }, 'counter restarted in the new window');
  const stored = JSON.stringify(all('SELECT * FROM rate_limit'));
  ok(![...usedIps].some(i => stored.includes(i)), 'no raw IP in rate_limit');
});

// ---------------------------------------------------------------- 3. reads
await test('GET: only {total, counts}; never a note; Cache-Control set; query string cannot bypass; fresh after an accepted POST', async () => {
  const secret = 'TOPSECRETNOTE-' + randomUUID();
  const g0 = JSON.parse((await getTally()).text);
  await post(answer({ picks: ['u02'], note: secret }));
  const g1 = await getTally('?cb=' + Math.random()), body = JSON.parse(g1.text);
  eq(g1.status, 200, 'status'); eq(g1.headers.get('cache-control'), 'public, max-age=30', 'Cache-Control');
  eq(Object.keys(body).sort(), ['counts', 'total'], 'top-level keys');
  eq(Object.keys(body.counts).sort(), [...CARDS].sort(), 'one count per card');
  ok(!g1.text.includes(secret) && !/note/i.test(g1.text), 'no note in GET');
  eq(body.total, g0.total + 1, 'total grew by one right after the POST (cache invalidated)');
  eq(body.counts.u02, g0.counts.u02 + 1, 'u02 count grew');
  const dbTally = derived().counts; eq(body.total, dbTally._answers, 'GET total == feedback_counts');
  ok(/FROM feedback_counts/.test(functionSource.slice(functionSource.indexOf('async function readCounts'), functionSource.indexOf('function tallyOf'))), 'GET reads feedback_counts');
});

// ---------------------------------------------------------------- 4. randomized burst vs the recompute script
await test('randomized burst of 200 mixed requests: derived tables == recompute script output == independent oracle; every valid key stored exactly once', async () => {
  let seed = 20261027; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pickN = n => Math.floor(rnd() * n);
  const answers = Array.from({ length: 25 }, () => randomUUID()), rowsBefore = rawCount(), existing = new Set(all('SELECT answer_id, revision FROM feedback').map(r => r.answer_id + '#' + r.revision));
  const reqs = [];
  for (let i = 0; i < 200; i++) {
    const roll = rnd(), a = answers[pickN(answers.length)], revision = 1 + pickN(5);
    const picks = CARDS.filter(() => rnd() < 0.35); if (!picks.length) picks.push(CARDS[pickN(11)]);
    let body = { answerId: a, revision, picks, clientVersion: 'burst@1', ...(rnd() < 0.4 ? { note: 'n' + i } : {}), ...(rnd() < 0.5 ? { seconds: pickN(500) } : {}), ...(rnd() < 0.5 ? { device: rnd() < 0.5 ? 'phone' : 'computer' } : {}) };
    let expect = 'valid';
    if (roll < 0.03) { body.picks = [...picks, 'nope']; expect = 'unknown_card'; }
    else if (roll < 0.06) { body.picks = []; expect = 'no_picks'; }
    else if (roll < 0.08) { body.revision = 0; expect = 'bad_revision'; }
    else if (roll < 0.10) { body.note = 'x'.repeat(601); expect = 'note_too_long'; }
    else if (roll < 0.12) { body.revision = 21; expect = 'too_many_revisions'; }
    reqs.push({ body, expect });
  }
  const sent = []; for (let w = 0; w < reqs.length; w += 25) sent.push(...await Promise.all(reqs.slice(w, w + 25).map(async r => ({ ...r, res: await post(r.body) }))));
  const valid = sent.filter(s => s.expect === 'valid'), invalid = sent.filter(s => s.expect !== 'valid');
  ok(valid.every(s => s.res.status === 200 && s.res.json.ok), 'every valid request answered 200 ok (duplicates included)');
  ok(invalid.every(s => s.res.json.error === s.expect), 'every invalid request got its own error code');
  const keys = new Set(valid.map(s => s.body.answerId + '#' + s.body.revision)), newKeys = [...keys].filter(k => !existing.has(k));
  eq(rawCount() - rowsBefore, newKeys.length, 'rows added == distinct valid keys');
  eq(valid.filter(s => s.res.json.duplicate === false).length, newKeys.length, 'exactly one non-duplicate reply per distinct key');
  const dups = valid.filter(s => s.res.json.duplicate).length; ok(dups > 20, `burst should contain many duplicates (got ${dups})`);

  // oracle 1: latest revision per answer, computed in JS from the raw rows
  const latest = new Map(); for (const r of all('SELECT answer_id, revision, picks FROM feedback')) if (!latest.has(r.answer_id) || latest.get(r.answer_id).revision < r.revision) latest.set(r.answer_id, r);
  const oracle = Object.fromEntries(CARDS.map(c => [c, 0])); oracle._answers = latest.size;
  for (const r of latest.values()) for (const c of JSON.parse(r.picks)) oracle[c]++;
  const live = derived(); eq(live.counts, oracle, 'derived counts (maintained live by the batches) vs JS oracle');
  eq(live.daily.reduce((s, d) => s + d.answers, 0), rawCount(), 'sum of feedback_daily == raw rows');
  eq(db.prepare(sql('check-counts.sql')).all().length, 0, 'check-counts.sql finds no disagreement');
  // oracle 2: the recompute script rebuilds the tables; they must come out identical
  db.exec(sql('recompute-counts.sql'));
  eq(derived(), live, 'derived tables after recompute-counts.sql == the live-maintained ones');
  eq(db.prepare(sql('check-counts.sql')).all().length, 0, 'check-counts.sql after recompute');
  console.log(`      burst: ${sent.length} requests = ${valid.length} valid (${newKeys.length} new keys, ${dups} duplicates/late) + ${invalid.length} invalid; raw rows now ${rawCount()}, answers ${latest.size}`);
});

await test('provenance and privacy: every row has server received_at, schema_version, page, client_version; no IP or user-agent anywhere', () => {
  const cols = all('PRAGMA table_info(feedback)').map(c => c.name);
  eq(cols, ['answer_id', 'revision', 'received_at', 'schema_version', 'client_version', 'page', 'picks', 'note', 'seconds', 'device', 'ingest_id'], 'columns');
  const rows = all('SELECT * FROM feedback');
  ok(rows.length > 100, 'enough rows to be meaningful');
  ok(rows.every(r => r.schema_version === 2 && r.page === 'ask' && /^(test@1|burst@1)$/.test(r.client_version) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.received_at)), 'provenance fields on every row');
  const dump = JSON.stringify([...rows, ...all('SELECT * FROM rate_limit'), ...all('SELECT * FROM feedback_daily')]);
  ok(!dump.includes('THRO-TEST-UA'), 'no user-agent stored');
  ok(![...usedIps].some(ip => dump.includes(ip)), 'no raw IP stored in any table');
  ok(all('SELECT client FROM rate_limit').every(r => /^[0-9a-f]{24}$/.test(r.client)), 'rate_limit keys are 24-hex HMAC buckets');
});

// ---------------------------------------------------------------- 5. the client's retry core (the <post-answer> block of ask.mjs)
await test('ask.mjs client: same bytes on every attempt, at most 2 retries, network failure only, server answers are final', async () => {
  const src = readFileSync(join(thro, 'ask.mjs'), 'utf8'), m = /\/\/ <post-answer>[\s\S]*?\/\/ <\/post-answer>/.exec(src);
  ok(m, 'post-answer block found in ask.mjs');
  const postAnswer = vm.runInNewContext(`${m[0]}\npostAnswer`, { AbortController, setTimeout, clearTimeout, fetch: undefined });
  const payload = { answerId: randomUUID(), revision: 1, picks: ['u01'], clientVersion: 'x' };
  const reply = (status, body) => ({ ok: status < 400, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
  const rig = steps => { const calls = []; return { calls, sleeps: [], fetchFn: async (url, init) => { calls.push({ url, body: init.body }); const s = steps[Math.min(calls.length - 1, steps.length - 1)]; if (s instanceof Error) throw s; return s; } }; };
  const run = async (steps, extra = {}) => { const r = rig(steps); const out = await postAnswer(payload, { fetchFn: r.fetchFn, sleep: async ms => r.sleeps.push(ms), ...extra }); return { out, ...r }; };

  let t = await run([new TypeError('fail'), new TypeError('fail'), reply(200, { ok: true, duplicate: false, tally: { total: 1, counts: {} } })]);
  eq([t.out.saved, t.out.attempts, t.calls.length, t.sleeps], [true, 3, 3, [400, 1200]], 'two failures then success: backoff 400 ms then 1.2 s');
  ok(t.calls.every(c => c.body === t.calls[0].body && JSON.parse(c.body).answerId === payload.answerId && JSON.parse(c.body).revision === 1), 'identical body and identity on every attempt');
  t = await run([new TypeError('fail')]);
  eq([t.out.saved, t.out.error, t.out.attempts, t.calls.length], [false, 'network', 3, 3], 'always failing: 1 try + 2 retries, then give up');
  for (const [status, error] of [[503, 'daily_cap_reached'], [429, 'rate_limited'], [400, 'unknown_card'], [500, 'storage_error']]) {
    t = await run([reply(status, { ok: false, error })]);
    eq([t.out.saved, t.out.error, t.out.attempts, t.sleeps], [false, error, 1, []], `HTTP ${status} is final, no retry`);
  }
  t = await run([reply(502, '<html>bad gateway</html>')]);
  eq([t.out.saved, t.out.status, t.out.attempts], [false, 502, 1], 'non-JSON gateway error: no retry');
  t = await run([reply(200, { ok: true, duplicate: true })]);
  eq([t.out.saved, t.out.duplicate], [true, true], 'duplicate:true counts as saved');
  t = await postAnswer(payload, { fetchFn: (u, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new Error('aborted')))), sleep: async () => {}, timeoutMs: 20 });
  eq([t.saved, t.error, t.attempts], [false, 'network', 3], 'a hung request times out and is retried like any network failure');

  // end to end: first response is lost AFTER the server stored the row; the retry must come back duplicate:true and add no row
  const body = answer({ picks: ['b04'], note: 'lost response' }); let lost = 0;
  const flaky = async (url, init) => { const r = await fetch(base, { ...init, headers: { ...init.headers, 'cf-connecting-ip': freshIp() } }); if (!lost++) { await r.text(); throw new TypeError('connection reset'); } return r; };
  const n = rawCount(), out = await postAnswer(body, { fetchFn: flaky, sleep: async () => {} });
  eq([out.saved, out.duplicate, out.attempts, rawCount() - n], [true, true, 2, 1], 'lost response -> retry -> duplicate:true, exactly one row');
  ok(/\bsending\b/.test(src) && /if \(sending \|\| !picked\.size\) return;/.test(src) && /crypto\.randomUUID/.test(src), 'ask.mjs guards re-entry while sending and mints an answerId');
});

// ---------------------------------------------------------------- 6. daily cap (last: it fakes today's counter, then restores it with the recompute script)
await test('daily cap: at 1999 of 2000, 3 parallel new answers -> exactly 1 stored, 2 get 503 daily_cap_reached; duplicates still answer 200', async () => {
  const day = new Date().toISOString().slice(0, 10), real = one('SELECT answers FROM feedback_daily WHERE day = ?', day).answers, n = rawCount();
  db.prepare('UPDATE feedback_daily SET answers = 1999 WHERE day = ?').run(day);
  const bodies = [answer({ picks: ['u01'] }), answer({ picks: ['u02'] }), answer({ picks: ['u03-front'] })];
  const rs = await Promise.all(bodies.map(b => post(b)));
  const created = rs.filter(r => r.status === 200 && r.json.duplicate === false), refused = rs.filter(r => r.status === 503);
  eq([created.length, refused.length], [1, 2], 'one stored, two refused');
  ok(refused.every(r => r.json.error === 'daily_cap_reached' && /paused for today/.test(r.json.message) && r.headers.get('retry-after')), '503 body: code + friendly message + Retry-After');
  eq([rawCount() - n, one('SELECT answers FROM feedback_daily WHERE day = ?', day).answers], [1, 2000], 'one row added, counter at the cap');
  const winner = bodies.find(b => b.answerId === created[0].json.answerId);
  const again = await post(winner); eq([again.status, again.json.duplicate], [200, true], 'a retry of the stored answer is still a quiet 200 at the cap');
  const next = await post({ ...winner, revision: 2, picks: ['b01'] }); eq([next.status, next.json.error], [503, 'daily_cap_reached'], 'a new revision is a new write and is refused');
  eq(rawCount() - n, 1, 'still just one new row');
  const g = await getTally(); eq(g.status, 200, 'GET still works at the cap');
  db.exec(sql('recompute-counts.sql'));   // undo the faked counter
  eq(one('SELECT answers FROM feedback_daily WHERE day = ?', day).answers, real + 1, 'recompute restored the true daily figure');
  eq(db.prepare(sql('check-counts.sql')).all().length, 0, 'check-counts.sql clean');
});

await test('scripts/check-counts.mjs (the ops check) agrees: exit 0 on this database', () => {
  db.close();
  const r = spawnSync(process.execPath, [join(project, 'scripts', 'check-counts.mjs'), '--local', '--cwd', tmp, '--persist-to', state], { encoding: 'utf8' });
  console.log('      ' + (r.stdout.trim() || r.stderr.trim()).split('\n').join('\n      '));
  eq(r.status, 0, 'check-counts exit code');
});

// ---------------------------------------------------------------- wrap up
stop();
try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir cleanup is best effort (Windows may hold the sqlite file briefly) */ }
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests passed${failed.length ? '; FAILED: ' + failed.map(f => f.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
