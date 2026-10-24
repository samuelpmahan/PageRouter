import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker, { createClickWorker, CODE_ALPHABET, CODE_LENGTH, classifySource } from '../../experiences/thro/clicks/_worker.js';
import { createTrackedLink } from '../../experiences/thro/clicks/link-ui.mjs';

const clicksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../experiences/thro/clicks');
const schema = fs.readFileSync(path.join(clicksDir, 'schema.sql'), 'utf8');
const ORIGIN = 'https://thro.example';

// A D1 stand-in over node:sqlite, running the real schema.sql and the worker's real SQL.
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    async run() {
      const info = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(info.changes) } };
    },
    async all() {
      return { success: true, results: db.prepare(sql).all(...params).map((row) => ({ ...row })) };
    },
    async first() {
      const row = db.prepare(sql).get(...params);
      return row ? { ...row } : null;
    },
  });
  return { prepare: (sql) => statement(sql), raw: db };
}

function fakeAssets() {
  const seen = [];
  return {
    seen,
    async fetch(request) {
      seen.push(new URL(request.url).pathname);
      return new Response('static:' + new URL(request.url).pathname, { status: 200 });
    },
  };
}

function fakeCtx() {
  const pending = [];
  return { pending, waitUntil: (promise) => pending.push(promise), settle: () => Promise.all(pending) };
}

function setup(start = '2026-10-01T12:00:00.000Z', options = {}) {
  const clock = { t: Date.parse(start) };
  const app = createClickWorker({ now: () => clock.t, ...options });
  const env = { CLICKS: fakeD1(), ASSETS: fakeAssets() };
  const call = async (pathname, init = {}) => {
    const ctx = fakeCtx();
    const response = await app.fetch(new Request(ORIGIN + pathname, init), env, ctx);
    await ctx.settle();
    return response;
  };
  const create = (body) => call('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const click = (code, referer) => call('/c/' + code, { redirect: 'manual', headers: referer ? { Referer: referer } : {} });
  return { clock, env, call, create, click, setDay: (iso) => { clock.t = Date.parse(iso); } };
}

test('create link returns a valid code, link URL and numbers URL', async () => {
  const s = setup();
  const response = await s.create({ destination: 'https://shop.example/discs/zone?ref=yt', label: 'Zone OS card', card: { layout: 'bag-hero', disc: 'Zone OS' } });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.code.length, CODE_LENGTH);
  assert.match(body.code, new RegExp(`^[${CODE_ALPHABET}]+$`));
  assert.equal(body.link, `${ORIGIN}/c/${body.code}`);
  assert.equal(body.numbers, `${ORIGIN}/numbers.html?c=${body.code}`);
  const row = s.env.CLICKS.raw.prepare('SELECT * FROM links WHERE code = ?').get(body.code);
  assert.equal(row.destination, 'https://shop.example/discs/zone?ref=yt');
  assert.equal(row.label, 'Zone OS card');
  assert.deepEqual(JSON.parse(row.card), { layout: 'bag-hero', disc: 'Zone OS' });
  assert.equal(row.created, '2026-10-01T12:00:00.000Z');
});

test('label is truncated to 80 characters; oversized card and non-object card are rejected', async () => {
  const s = setup();
  const long = await (await s.create({ destination: 'https://a.example', label: 'x'.repeat(200) })).json();
  assert.equal(s.env.CLICKS.raw.prepare('SELECT label FROM links WHERE code = ?').get(long.code).label.length, 80);
  assert.equal((await s.create({ destination: 'https://a.example', card: { notes: 'y'.repeat(1100) } })).status, 400);
  assert.equal((await s.create({ destination: 'https://a.example', card: ['bag'] })).status, 400);
});

test('bad destinations answer 400', async () => {
  const s = setup();
  for (const destination of [undefined, '', 'shop.example/disc', '/relative', 'javascript:alert(1)', 'ftp://files.example/x', 'data:text/html,hi', 'https://user:pw@shop.example', `${ORIGIN}/c/abcdefg`, 42]) {
    const response = await s.create({ destination });
    assert.equal(response.status, 400, `destination ${JSON.stringify(destination)} should be rejected`);
    assert.equal((await response.json()).error, 'bad_destination');
  }
  const notJson = await s.call('/api/links', { method: 'POST', body: 'not json' });
  assert.equal(notJson.status, 400);
  assert.equal((await s.call('/api/links')).status, 405);
});

test('code collisions are retried with a fresh code', async () => {
  const fixed = [new Uint8Array(14).fill(0), new Uint8Array(14).fill(0), new Uint8Array(14).fill(1)];
  let i = 0;
  const s = setup(undefined, { randomBytes: () => fixed[Math.min(i++, fixed.length - 1)] });
  const first = await (await s.create({ destination: 'https://a.example' })).json();
  const second = await (await s.create({ destination: 'https://b.example' })).json();
  assert.equal(first.code, CODE_ALPHABET[0].repeat(7));
  assert.equal(second.code, CODE_ALPHABET[1].repeat(7));
});

test('click answers 302 to the destination and records a row with nothing personal', async () => {
  const s = setup();
  const { code } = await (await s.create({ destination: 'https://shop.example/discs/zone' })).json();
  const response = await s.click(code, 'https://blog.example/post/42?utm=1');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://shop.example/discs/zone');
  assert.equal(response.headers.get('Set-Cookie'), null);

  const columns = s.env.CLICKS.raw.prepare('PRAGMA table_info(clicks)').all().map((c) => c.name);
  assert.deepEqual(columns, ['code', 'at', 'referrer', 'source']);
  const rows = s.env.CLICKS.raw.prepare('SELECT * FROM clicks').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ code, at: '2026-10-01T12:00:00.000Z', referrer: 'blog.example', source: 'other' }]);

  // Send a request full of identifying headers and make sure none of it lands anywhere in the database.
  await s.call('/c/' + code, { headers: { 'User-Agent': 'SecretAgent/9.9', 'CF-Connecting-IP': '203.0.113.77', 'X-Forwarded-For': '198.51.100.5', Cookie: 'sid=abc' } });
  const dump = JSON.stringify(s.env.CLICKS.raw.prepare('SELECT * FROM clicks').all()) + JSON.stringify(s.env.CLICKS.raw.prepare('SELECT * FROM links').all());
  for (const secret of ['SecretAgent', '203.0.113.77', '198.51.100.5', 'sid=abc']) assert.ok(!dump.includes(secret), `${secret} must not be stored`);
  assert.equal(s.env.CLICKS.raw.prepare("SELECT source FROM clicks WHERE referrer IS NULL").get().source, 'direct');
});

test('the redirect does not wait for the click to be written', async () => {
  const s = setup();
  const { code } = await (await s.create({ destination: 'https://shop.example' })).json();
  const ctx = fakeCtx();
  const app = createClickWorker({ now: () => s.clock.t });
  const response = await app.fetch(new Request(`${ORIGIN}/c/${code}`), s.env, ctx);
  assert.equal(response.status, 302);
  assert.equal(ctx.pending.length, 1, 'the click write is handed to ctx.waitUntil');
  await ctx.settle();
  assert.equal(s.env.CLICKS.raw.prepare('SELECT COUNT(*) AS n FROM clicks').get().n, 1);
});

test('HEAD requests redirect without counting', async () => {
  const s = setup();
  const { code } = await (await s.create({ destination: 'https://shop.example' })).json();
  assert.equal((await s.call('/c/' + code, { method: 'HEAD' })).status, 302);
  assert.equal(s.env.CLICKS.raw.prepare('SELECT COUNT(*) AS n FROM clicks').get().n, 0);
});

test('YouTube referers are classified as youtube; look-alike domains are not', async () => {
  const s = setup();
  const { code } = await (await s.create({ destination: 'https://shop.example' })).json();
  await s.click(code, 'https://www.youtube.com/');
  await s.click(code, 'https://youtu.be/dQw4w9WgXcQ');
  await s.click(code, 'https://m.youtube.com/watch?v=abc');
  const rows = s.env.CLICKS.raw.prepare('SELECT referrer, source FROM clicks ORDER BY rowid').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { referrer: 'www.youtube.com', source: 'youtube' },
    { referrer: 'youtu.be', source: 'youtube' },
    { referrer: 'm.youtube.com', source: 'youtube' },
  ]);
  assert.equal(classifySource('notyoutube.com'), 'other');
  assert.equal(classifySource('youtube.com.evil.example'), 'other');
  assert.equal(classifySource(null), 'direct');
});

test('unknown codes answer 404 for clicks and numbers', async () => {
  const s = setup();
  const click = await s.click('zzzzzzz');
  assert.equal(click.status, 404);
  assert.match(await click.text(), /Link not found/);
  assert.equal((await s.click('not-a-code')).status, 404);
  assert.equal((await s.call('/api/numbers/zzzzzzz')).status, 404);
  assert.equal(s.env.CLICKS.raw.prepare('SELECT COUNT(*) AS n FROM clicks').get().n, 0);
});

test('numbers: totals, zero-filled byDay, sources and referrers across several days', async () => {
  const s = setup('2026-10-01T09:00:00.000Z');
  const { code } = await (await s.create({ destination: 'https://shop.example/zone', label: 'Zone OS', card: { layout: 'bag-hero', disc: 'Zone OS' } })).json();
  s.setDay('2026-10-01T10:00:00.000Z'); await s.click(code, 'https://www.youtube.com/'); await s.click(code, 'https://www.youtube.com/');
  s.setDay('2026-10-01T23:59:59.999Z'); await s.click(code);
  s.setDay('2026-10-03T00:00:00.000Z'); await s.click(code, 'https://youtu.be/x'); await s.click(code, 'https://reddit.com/r/discgolf');
  s.setDay('2026-10-05T18:30:00.000Z'); await s.click(code, 'https://www.youtube.com/');

  const response = await s.call('/api/numbers/' + code);
  assert.equal(response.status, 200);
  const n = await response.json();
  assert.equal(n.code, code);
  assert.equal(n.label, 'Zone OS');
  assert.equal(n.destination, 'https://shop.example/zone');
  assert.deepEqual(n.card, { layout: 'bag-hero', disc: 'Zone OS' });
  assert.equal(n.created, '2026-10-01T09:00:00.000Z');
  assert.equal(n.total, 6);
  assert.deepEqual(n.byDay, [
    { day: '2026-10-01', clicks: 3 },
    { day: '2026-10-02', clicks: 0 },
    { day: '2026-10-03', clicks: 2 },
    { day: '2026-10-04', clicks: 0 },
    { day: '2026-10-05', clicks: 1 },
  ]);
  assert.deepEqual(n.bySource, { youtube: 4, other: 1, direct: 1 });
  assert.deepEqual(n.byReferrer, [
    { host: 'www.youtube.com', clicks: 3 },
    { host: null, clicks: 1 },
    { host: 'reddit.com', clicks: 1 },
    { host: 'youtu.be', clicks: 1 },
  ]);
});

test('numbers: only the last 90 days are charted; total stays all-time', async () => {
  const s = setup('2026-01-01T12:00:00.000Z');
  const { code } = await (await s.create({ destination: 'https://shop.example' })).json();
  await s.click(code);                                   // 2026-01-01, outside the window later
  s.setDay('2026-07-05T08:00:00.000Z'); await s.click(code); // first day inside a 90-day window ending 2026-10-02
  s.setDay('2026-10-02T08:00:00.000Z'); await s.click(code);
  const n = await (await s.call('/api/numbers/' + code)).json();
  assert.equal(n.byDay.length, 90);
  assert.equal(n.byDay[0].day, '2026-07-05');
  assert.equal(n.byDay.at(-1).day, '2026-10-02');
  assert.equal(n.total, 3);
  assert.equal(n.windowTotal, 2);
  assert.deepEqual(n.bySource, { youtube: 0, other: 0, direct: 2 });
});

test('missing CLICKS binding: API answers 503 JSON, static site still serves', async () => {
  const assets = fakeAssets();
  const env = { ASSETS: assets };
  const post = await worker.fetch(new Request(ORIGIN + '/api/links', { method: 'POST', body: '{"destination":"https://a.example"}' }), env, fakeCtx());
  assert.equal(post.status, 503);
  const body = await post.json();
  assert.equal(body.error, 'storage_unavailable');
  assert.match(body.message, /CLICKS/);
  assert.equal((await worker.fetch(new Request(ORIGIN + '/api/numbers/abcdefg'), env, fakeCtx())).status, 503);
  assert.equal((await worker.fetch(new Request(ORIGIN + '/c/abcdefg'), env, fakeCtx())).status, 503);
  const home = await worker.fetch(new Request(ORIGIN + '/index.html'), env, fakeCtx());
  assert.equal(home.status, 200);
  assert.equal(await home.text(), 'static:/index.html');
});

test('non-API paths go to ASSETS untouched', async () => {
  const s = setup();
  for (const p of ['/', '/index.html', '/thro.css', '/numbers.html', '/api/other', '/cards/c/x']) {
    const response = await s.call(p);
    assert.equal(await response.text(), 'static:' + p);
  }
  assert.deepEqual(s.env.ASSETS.seen, ['/', '/index.html', '/thro.css', '/numbers.html', '/api/other', '/cards/c/x']);
});

test('createTrackedLink posts once and returns the JSON; errors are readable', async () => {
  const s = setup();
  const viaWorker = (url, init) => s.call(new URL(url, ORIGIN).pathname, init);
  const made = await createTrackedLink({ destination: ' https://shop.example/zone ', label: 'Zone', card: { disc: 'Zone' } }, viaWorker);
  assert.equal(made.link, `${ORIGIN}/c/${made.code}`);
  await assert.rejects(createTrackedLink({ destination: 'shop.example' }, viaWorker), /The link was not made: destination must be an absolute http\(s\) URL/);
  await assert.rejects(createTrackedLink({ destination: '' }, viaWorker), /Paste the link/);
  await assert.rejects(createTrackedLink({ destination: 'https://a.example' }, async () => { throw new TypeError('offline'); }), /Could not reach thro/);
});
