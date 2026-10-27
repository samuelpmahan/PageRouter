// thro card feedback (ask.html, "Which cards would you put on screen?").
// POST /api/feedback  {picks: [preset, ...], note?: string, seconds?: number, device?: "phone"|"computer"}
//   -> stores one answer in D1 (table feedback) and returns {ok, id, tally}.
// GET  /api/feedback  -> {total, counts: {preset: n}}: how many answers picked each card. Notes are never returned here.
const PRESET = /^[a-z0-9-]{1,16}$/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function tally(db) {
  const { results } = await db.prepare('SELECT picks FROM feedback').all();
  const counts = {};
  for (const r of results) for (const p of JSON.parse(r.picks)) counts[p] = (counts[p] ?? 0) + 1;
  return { total: results.length, counts };
}

export async function onRequestGet({ env }) {
  return json(await tally(env.FEEDBACK));
}

export async function onRequestPost({ request, env }) {
  const text = await request.text();
  if (text.length > 4096) return json({ ok: false, error: 'too large' }, 413);
  let b; try { b = JSON.parse(text); } catch { return json({ ok: false, error: 'not JSON' }, 400); }
  const picks = Array.isArray(b?.picks) ? [...new Set(b.picks)] : [];
  if (!picks.length || picks.length > 30 || !picks.every(p => typeof p === 'string' && PRESET.test(p))) return json({ ok: false, error: 'picks must be 1..30 card ids' }, 400);
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 600) : '';
  const seconds = Number.isInteger(b.seconds) && b.seconds >= 0 && b.seconds <= 86400 ? b.seconds : null;
  const device = b.device === 'phone' || b.device === 'computer' ? b.device : null;
  const id = crypto.randomUUID();
  await env.FEEDBACK.prepare('INSERT INTO feedback (id, received_at, picks, note, seconds, device, page) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, new Date().toISOString(), JSON.stringify(picks), note || null, seconds, device, 'ask').run();
  return json({ ok: true, id, tally: await tally(env.FEEDBACK) });
}
