// thro preview worker (Cloudflare Pages, advanced mode). Handles only /api/judgments; every other request goes to the static site
// unchanged (env.ASSETS).
//   POST /api/judgments   one answer from ask.html: { picks: [1–2 layout ids], note ≤ 600 chars, seconds, device, at }
//                         → { tally: { answers, picks: { layout: count } } }
//   GET  /api/judgments   the tally; with ?key= matching the RESULTS_KEY secret, also every answer with its note, newest first
//                         (ask-results.html reads this). Notes are never public.
// Storage: Cloudflare D1 bound as env.JUDGMENTS (table below). Without that binding both routes answer 503 and ask.html keeps the
// answer on the visitor's device. An answer holds only what the visitor gave: no IP address, no user agent, no cookie.
//   CREATE TABLE IF NOT EXISTS judgments (id INTEGER PRIMARY KEY, at TEXT NOT NULL, picks TEXT NOT NULL, note TEXT, seconds INTEGER, device TEXT);
const LAYOUTS = new Set(['u01', 'u02', 'u03-front', 'u03-behind', 'u04', 'u05', 'b01', 'b02', 'b03', 'b04', 'b05']);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function tally(db) {
  const { results } = await db.prepare('SELECT picks FROM judgments').all();
  const picks = {}; for (const r of results) for (const p of JSON.parse(r.picks)) picks[p] = (picks[p] ?? 0) + 1;
  return { answers: results.length, picks };
}
export function validAnswer(a) {
  if (!a || typeof a !== 'object' || !Array.isArray(a.picks) || a.picks.length < 1 || a.picks.length > 2) return null;
  if (!a.picks.every(p => LAYOUTS.has(p)) || new Set(a.picks).size !== a.picks.length) return null;
  const note = typeof a.note === 'string' ? a.note.trim().slice(0, 600) : '';
  const seconds = Number.isInteger(a.seconds) && a.seconds >= 0 && a.seconds < 86400 ? a.seconds : null;
  const device = a.device === 'phone' || a.device === 'desktop' ? a.device : null;
  return { picks: a.picks, note, seconds, device };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/judgments') return env.ASSETS.fetch(request);
    const db = env.JUDGMENTS;
    if (!db) return json({ error: 'This preview has no answer store.' }, 503);
    if (request.method === 'POST') {
      const text = await request.text();
      if (text.length > 4096) return json({ error: 'Too large.' }, 413);
      let a; try { a = validAnswer(JSON.parse(text)); } catch { a = null; }
      if (!a) return json({ error: 'Pick one or two cards.' }, 400);
      await db.prepare('INSERT INTO judgments (at, picks, note, seconds, device) VALUES (?, ?, ?, ?, ?)')
        .bind(new Date().toISOString(), JSON.stringify(a.picks), a.note || null, a.seconds, a.device).run();
      return json({ tally: await tally(db) });
    }
    if (request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!env.RESULTS_KEY || key !== env.RESULTS_KEY) return json({ tally: await tally(db) });
      const { results } = await db.prepare('SELECT at, picks, note, seconds, device FROM judgments ORDER BY id DESC').all();
      return json({ answers: results.map(r => ({ ...r, picks: JSON.parse(r.picks) })), tally: await tally(db) });
    }
    return json({ error: 'Use GET or POST.' }, 405);
  },
};
