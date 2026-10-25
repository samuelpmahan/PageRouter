// thro ask: "Which card would you put on screen?" (Sam, 24 Oct 18:56: "These people don't want ThroCards. I am requesting their
// time, taste and judgement on my work"). One screen: every card layout up close on a real tee shot, drawn by the renderer exactly
// as the editor draws it. Tap one or two, optionally say what you'd change, Send. Then everyone's picks show on the cards.
// An answer holds only: the picks, the note, seconds spent, phone or desktop, and the time. No name, address or browser details.
// Answers go to POST ./api/judgments (_worker.js, D1). Where this preview has no store yet, they stay on this device and the page
// says so.
import { loadFixture } from './prepared-fixture.mjs';
import { nativeStudies, cardRevisions } from './native-cards.mjs';
const V = '?v=28ac2b39fab85255';
const adapter = await import(`./vendor/discstudio-cards/thro-adapter.mjs${V}`);
const molds = await import(`./vendor/discstudio-cards/mold-library.js${V}`);
const $ = id => document.getElementById(id);
const opened = performance.now(), MAX_PICKS = 2, LOCAL = 'thro.ask.local';

const fixture = await loadFixture(), disc = fixture.find(d => d.name === 'Servo') ?? fixture[0];
const tee = await image('./assets/tee-shot-original.jpg');
function image(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error(`Could not load ${src}`)); i.src = src; }); }
const blobImage = async blob => { const url = URL.createObjectURL(blob); try { return await image(url); } finally { URL.revokeObjectURL(url); } };
function flightsOf(d) {
  const base = molds.moldRecord(d.mold)?.flight ?? []; // the catalog's [speed, glide, turn, fade]; the sample's cited correction goes on top
  return ['speed', 'glide', 'turn', 'fade'].map((f, i) => d.flightOverrides?.[f] ?? base[i] ?? null);
}

const picked = new Set(), tiles = [];
for (const study of nativeStudies) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'card'; b.setAttribute('aria-pressed', 'false'); b.dataset.preset = study.preset;
  const [code, ...rest] = study.name.split(' · ');
  b.innerHTML = `<canvas width="${study.orientation === 'portrait' ? 300 : 480}" height="${study.orientation === 'portrait' ? 420 : 300}"></canvas><span class="wait">drawing…</span><span class="name">${code} · ${rest.join(' · ')}</span><span class="check" aria-hidden="true">✓</span>`;
  b.setAttribute('aria-label', `${study.name}: pick this card`);
  b.onclick = () => {
    if (sent) return;
    if (picked.has(study.preset)) picked.delete(study.preset);
    else { if (picked.size >= MAX_PICKS) { const first = [...picked][0]; picked.delete(first); tiles.find(t => t.study.preset === first).el.setAttribute('aria-pressed', 'false'); } picked.add(study.preset); }
    b.setAttribute('aria-pressed', String(picked.has(study.preset))); status();
  };
  $(study.orientation === 'portrait' ? 'portrait' : 'landscape').append(b);
  tiles.push({ study, el: b });
}
// Each tile: a window onto the full frame, centred on the card with room around it, so the card is big enough to judge and the
// shot around it is still there.
for (const { study, el } of tiles) {
  const c = el.querySelector('canvas'), ctx = c.getContext('2d');
  try {
    const r = await adapter.renderDiscStudioCard({ disc: { id: disc.id, mold: disc.mold, name: disc.name, manufacturer: disc.manufacturer, plastic: disc.plastic ?? null, weight: null },
      photoSrc: disc.depiction.src, flights: flightsOf(disc), preset: study.preset, revision: cardRevisions[study.preset],
      appearance: { discSide: study.side, highlightTarget: study.highlight, accentColor: study.accent } });
    const card = await blobImage(r.png), W = r.width, H = r.height, b = r.layout.card;
    const frame = Object.assign(document.createElement('canvas'), { width: W, height: H }), f = frame.getContext('2d'), s0 = Math.max(W / tee.width, H / tee.height);
    f.drawImage(tee, (W - tee.width * s0) / 2, (H - tee.height * s0) / 2, tee.width * s0, tee.height * s0); f.drawImage(card, 0, 0);
    const aspect = c.width / c.height; let w = b.w * 1.45, h = b.h * 1.45;
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    w = Math.min(w, W); h = Math.min(h, H);
    const x = Math.max(0, Math.min(W - w, b.x + b.w / 2 - w / 2)), y = Math.max(0, Math.min(H - h, b.y + b.h / 2 - h / 2));
    ctx.drawImage(frame, x, y, w, h, 0, 0, c.width, c.height);
    el.querySelector('.wait').remove();
  } catch (e) { el.querySelector('.wait').textContent = 'could not draw'; console.error(e); }
}
$('main').setAttribute('aria-busy', 'false');

let sent = false;
function status() {
  if (sent) return;
  $('send').disabled = !picked.size;
  $('status').innerHTML = picked.size ? `<b>${[...picked].map(p => p.toUpperCase()).join(' and ')}</b>${picked.size < MAX_PICKS ? ' · pick one more, or Send' : ''}` : 'Tap one or two.';
}
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL) ?? '[]'); } catch { return []; } };
async function send(answer) {
  try {
    const res = await fetch('./api/judgments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(answer) });
    if (res.ok) return { stored: 'shared', tally: (await res.json()).tally };
  } catch { /* no store on this preview */ }
  const all = [...readLocal(), answer]; try { localStorage.setItem(LOCAL, JSON.stringify(all)); } catch { /* private mode */ }
  const tally = {}; for (const a of all) for (const p of a.picks) tally[p] = (tally[p] ?? 0) + 1;
  return { stored: 'local', tally: { answers: all.length, picks: tally } };
}
$('send').onclick = async () => {
  if (!picked.size || sent) return;
  sent = true; $('send').disabled = true; $('send').textContent = 'Sending…';
  const answer = { picks: [...picked], note: $('note').value.trim().slice(0, 600), seconds: Math.round((performance.now() - opened) / 1000),
    device: matchMedia('(pointer:coarse)').matches ? 'phone' : 'desktop', at: new Date().toISOString() };
  const { stored, tally } = await send(answer);
  for (const { study, el } of tiles) {
    const n = tally.picks[study.preset] ?? 0, share = tally.answers ? n / tally.answers : 0;
    const t = document.createElement('span'); t.className = 'tally'; t.innerHTML = `<i style="width:${Math.round(share * 70)}%"></i>${n} of ${tally.answers}`; el.append(t);
  }
  $('send').textContent = 'Sent';
  $('note').disabled = true;
  $('status').innerHTML = stored === 'shared' ? `<b>Thank you.</b> That's how everyone has picked so far.` : `<b>Thank you.</b> (This preview has no shared store yet: your answer stayed on this device.)`;
};
status();
