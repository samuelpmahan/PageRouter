// thro ask: "Which card would you put on screen?" (Sam, 24 Oct 18:56: "These people don't want ThroCards. I am requesting their
// time, taste and judgement on my work"). One screen: every card layout up close on a real tee shot, drawn by the renderer exactly
// as the editor draws it. Tap every card you'd use (or Select all), optionally say what you'd change, then Copy feedback.
// Copy feedback puts the answer on the clipboard as plain text, to paste back into the Slack thread (Sam, 19:02: discussion in
// Slack draws in outside interest). Nothing is sent or stored anywhere.
import { loadFixture } from './prepared-fixture.mjs';
import { nativeStudies, cardRevisions } from './native-cards.mjs';
const V = '?v=28ac2b39fab85255';
const adapter = await import(`./vendor/discstudio-cards/thro-adapter.mjs${V}`);
const molds = await import(`./vendor/discstudio-cards/mold-library.js${V}`);
const $ = id => document.getElementById(id);
const opened = performance.now();

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
        if (picked.has(study.preset)) picked.delete(study.preset);
    else picked.add(study.preset);
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

function status() {
  $('send').disabled = !picked.size;
  $('status').innerHTML = picked.size ? `<b>${picked.size} of ${tiles.length}</b> picked` : 'Tap every card you\'d use.';
  $('all').textContent = picked.size === tiles.length ? 'Clear all' : 'Select all';
}
const nameOf = preset => nativeStudies.find(s => s.preset === preset).name;
function feedback() {
  const note = $('note').value.trim(), seconds = Math.round((performance.now() - opened) / 1000);
  return [`My pick${picked.size > 1 ? 's' : ''}: ${[...document.querySelectorAll('.card[aria-pressed=true]')].map(el => nameOf(el.dataset.preset)).join(', ')}`, note && `What I'd change: ${note}`, `(${seconds}s, on ${matchMedia('(pointer:coarse)').matches ? 'a phone' : 'a computer'})`].filter(Boolean).join('\n');
}
$('send').onclick = async () => {
  if (!picked.size) return;
  const text = feedback(), box = $('copy-fallback');
  try { await navigator.clipboard.writeText(text); $('status').innerHTML = '<b>Copied.</b> Paste it in the Slack thread.'; box.hidden = true; }
  catch { box.value = text; box.hidden = false; box.focus(); box.select(); $('status').innerHTML = '<b>Copy this</b> and paste it in the Slack thread.'; }
  $('send').textContent = 'Copied ✓'; setTimeout(() => { $('send').textContent = 'Copy feedback'; }, 2500);
};
$('all').onclick = () => {
  const every = picked.size !== tiles.length;
  for (const { study, el } of tiles) { every ? picked.add(study.preset) : picked.delete(study.preset); el.setAttribute('aria-pressed', String(every)); }
  status();
};
$('note').addEventListener('input', () => { $('copy-fallback').hidden = true; });
status();
