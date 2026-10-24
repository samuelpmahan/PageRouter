// thro click tracking: Cloudflare Pages advanced-mode worker.
//
// Routes handled here (everything else goes to env.ASSETS, so the static site is unchanged):
//   POST /api/links          create a tracked link
//   GET  /c/:code            record one click, 302 to the destination
//   GET  /api/numbers/:code  click numbers for the last 90 days
//
// Storage: Cloudflare D1 bound as env.CLICKS (tables in schema.sql).
// A click records ONLY: code, UTC time, referring hostname (or null), coarse source.
// No IP address, no user agent, no cookies.

export const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0 1 i l o
export const CODE_LENGTH = 7;
export const WINDOW_DAYS = 90;
export const LABEL_MAX = 80;
export const CARD_MAX_BYTES = 1024;
const BODY_MAX_BYTES = 4096;
const CODE_ATTEMPTS = 5;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const DAY_MS = 86400000;

const defaultRandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

// Unbiased: bytes at or above the largest multiple of the alphabet size are discarded.
export function generateCode(randomBytes = defaultRandomBytes) {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH * 2)) {
      if (byte < limit && code.length < CODE_LENGTH) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }
  return code;
}

export function classifySource(host) {
  if (!host) return 'direct';
  const isUnder = (domain) => host === domain || host.endsWith('.' + domain);
  return isUnder('youtube.com') || isUnder('youtu.be') ? 'youtube' : 'other';
}

export function refererHost(request) {
  const referer = request.headers.get('Referer');
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

const apiError = (status, error, message) => json({ error, message }, status);

const page = (status, title, message) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - thro</title><meta name="robots" content="noindex"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d140f;color:#e9f1e4;font-family:system-ui,sans-serif;padding:16px;box-sizing:border-box}main{max-width:420px;background:#151f18;border:1px solid #263329;border-radius:16px;padding:28px}h1{margin:0 0 10px;font-size:24px}p{margin:0;color:#9fb0a3;line-height:1.55}a{color:#c8f49d}</style></head><body><main><h1>${title}</h1><p>${message}</p><p style="margin-top:16px"><a href="/">Go to thro</a></p></main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
  );

const noDatabase = () =>
  apiError(503, 'storage_unavailable', 'Click tracking storage is not configured: the D1 binding CLICKS is missing on this deployment.');

function validateDestination(value, origin) {
  if (typeof value !== 'string' || !value.trim()) return 'destination is required and must be an absolute http(s) URL.';
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return 'destination must be an absolute http(s) URL, for example https://example.com/disc.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'destination must start with http:// or https://.';
  if (url.username || url.password) return 'destination must not contain a username or password.';
  if (url.origin === origin && url.pathname.startsWith('/c/')) return 'destination must not be another thro tracked link.';
  return null;
}

async function readJson(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > BODY_MAX_BYTES) return { error: 'body must be at most 4096 bytes.' };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: 'body must be JSON: { "destination": "https://...", "label": "...", "card": { ... } }.' };
  }
}

async function createLink(request, env, origin, clock, randomBytes) {
  const { value: body, error } = await readJson(request);
  if (error) return apiError(400, 'bad_request', error);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError(400, 'bad_request', 'body must be a JSON object.');

  const destinationError = validateDestination(body.destination, origin);
  if (destinationError) return apiError(400, 'bad_destination', destinationError);
  const destination = new URL(body.destination.trim()).href;

  let label = null;
  if (body.label != null) {
    if (typeof body.label !== 'string') return apiError(400, 'bad_label', 'label must be text.');
    // Truncate rather than reject: a too-long label should never block making a link.
    label = Array.from(body.label.trim()).slice(0, LABEL_MAX).join('') || null;
  }

  let card = null;
  if (body.card != null) {
    if (typeof body.card !== 'object' || Array.isArray(body.card)) return apiError(400, 'bad_card', 'card must be a JSON object, for example { "layout": "...", "disc": "..." }.');
    card = JSON.stringify(body.card);
    if (new TextEncoder().encode(card).length > CARD_MAX_BYTES) return apiError(400, 'bad_card', `card must be at most ${CARD_MAX_BYTES} bytes as JSON.`);
  }

  const created = new Date(clock()).toISOString();
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = generateCode(randomBytes);
    const result = await env.CLICKS.prepare(
      'INSERT OR IGNORE INTO links (code, destination, label, card, created) VALUES (?, ?, ?, ?, ?)',
    ).bind(code, destination, label, card, created).run();
    if (result?.meta?.changes === 1) {
      return json({ code, link: `${origin}/c/${code}`, numbers: `${origin}/numbers.html?c=${code}` }, 201);
    }
  }
  return apiError(500, 'code_exhausted', 'Could not find a free link code. Try again.');
}

async function followLink(code, request, env, ctx, clock) {
  const link = CODE_PATTERN.test(code)
    ? await env.CLICKS.prepare('SELECT destination FROM links WHERE code = ?').bind(code).first()
    : null;
  if (!link) return page(404, 'Link not found', 'This thro link does not exist. Check that it was copied in full.');

  // HEAD requests (link checkers, unfurlers) redirect without counting.
  if (request.method === 'GET') {
    const host = refererHost(request);
    const write = env.CLICKS.prepare('INSERT INTO clicks (code, at, referrer, source) VALUES (?, ?, ?, ?)')
      .bind(code, new Date(clock()).toISOString(), host, classifySource(host))
      .run()
      .catch(() => {}); // a failed count must never break the redirect
    if (ctx?.waitUntil) ctx.waitUntil(write);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: link.destination, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer-when-downgrade' },
  });
}

async function numbers(code, env, clock) {
  if (!CODE_PATTERN.test(code)) return apiError(404, 'not_found', 'No thro link has this code.');
  const link = await env.CLICKS.prepare('SELECT code, destination, label, card, created FROM links WHERE code = ?').bind(code).first();
  if (!link) return apiError(404, 'not_found', 'No thro link has this code.');

  const now = clock();
  const today = new Date(now).toISOString().slice(0, 10);
  const windowStart = new Date(Date.parse(today + 'T00:00:00.000Z') - (WINDOW_DAYS - 1) * DAY_MS).toISOString();
  const createdDay = link.created.slice(0, 10);
  const firstDay = createdDay > windowStart.slice(0, 10) ? createdDay : windowStart.slice(0, 10);

  const db = env.CLICKS;
  const [totalRow, dayRows, sourceRows, refRows] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS clicks FROM clicks WHERE code = ?').bind(code).first(),
    db.prepare('SELECT substr(at, 1, 10) AS day, COUNT(*) AS clicks FROM clicks WHERE code = ? AND at >= ? GROUP BY day ORDER BY day').bind(code, windowStart).all(),
    db.prepare('SELECT source, COUNT(*) AS clicks FROM clicks WHERE code = ? AND at >= ? GROUP BY source').bind(code, windowStart).all(),
    db.prepare("SELECT COALESCE(referrer, '') AS host, COUNT(*) AS clicks FROM clicks WHERE code = ? AND at >= ? GROUP BY host ORDER BY clicks DESC, host LIMIT 20").bind(code, windowStart).all(),
  ]);

  // Every day from the first counted day to today, zero-filled, so the chart has no gaps.
  const counted = new Map((dayRows.results || []).map((row) => [row.day, Number(row.clicks)]));
  const byDay = [];
  for (let t = Date.parse(firstDay + 'T00:00:00.000Z'); t <= Date.parse(today + 'T00:00:00.000Z'); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    byDay.push({ day, clicks: counted.get(day) || 0 });
  }
  const bySource = { youtube: 0, other: 0, direct: 0 };
  for (const row of sourceRows.results || []) bySource[row.source] = Number(row.clicks);
  const byReferrer = (refRows.results || []).map((row) => ({ host: row.host || null, clicks: Number(row.clicks) }));

  return json({
    code: link.code,
    label: link.label,
    destination: link.destination,
    card: link.card ? JSON.parse(link.card) : null,
    created: link.created,
    total: Number(totalRow?.clicks || 0),
    windowDays: WINDOW_DAYS,
    windowTotal: byDay.reduce((sum, d) => sum + d.clicks, 0),
    byDay,
    bySource,
    byReferrer,
    asOf: new Date(now).toISOString(),
  });
}

export function createClickWorker({ now = () => Date.now(), randomBytes = defaultRandomBytes } = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const path = url.pathname;
      const isApi = path.startsWith('/api/links') || path.startsWith('/api/numbers/');
      const isClick = path.startsWith('/c/');
      if (!isApi && !isClick) return env.ASSETS.fetch(request);

      if (!env.CLICKS) {
        return isClick ? page(503, 'Link temporarily unavailable', 'thro links are not set up on this deployment yet.') : noDatabase();
      }

      try {
        if (path === '/api/links') {
          if (request.method !== 'POST') return apiError(405, 'method_not_allowed', 'Use POST to create a link.');
          return await createLink(request, env, url.origin, now, randomBytes);
        }
        if (isClick) {
          if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'method_not_allowed', 'Tracked links answer GET only.');
          return await followLink(path.slice(3).toLowerCase(), request, env, ctx, now);
        }
        const match = path.match(/^\/api\/numbers\/([^/]+)$/);
        if (match) {
          if (request.method !== 'GET') return apiError(405, 'method_not_allowed', 'Use GET to read numbers.');
          return await numbers(decodeURIComponent(match[1]).toLowerCase(), env, now);
        }
        return apiError(404, 'not_found', 'Unknown API route.');
      } catch (error) {
        return apiError(500, 'internal', 'Click tracking failed: ' + (error?.message || String(error)));
      }
    },
  };
}

export default createClickWorker();
