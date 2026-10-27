// thro ask: "Which card would you put on screen?" (Sam, 24 Oct 18:56: "These people don't want ThroCards. I am requesting their
// time, taste and judgement on my work"). One screen: every card layout up close on a real tee shot, drawn by the renderer exactly
// as the editor draws it. Tap every card you'd use (or Select all), optionally say what you'd change, then Send.
// Send does two things in one tap (Sam, 27 Oct: hook it up to an actual backend): it copies the answer as plain text for the Slack
// thread (Sam, 19:02: discussion in Slack draws in outside interest) and saves it to thro's backend (POST /api/feedback, Cloudflare
// D1 table feedback). The reply carries how many answers picked each card; those counts are shown only after you send, so they
// cannot sway your own picks. Notes are stored but never shown to other visitors.
// Every send carries an identity the server dedupes on: answerId (one random UUID per page visit) + revision (1, 2, 3 ... bumped only
// when the picks or the note change). A triple-click, a double-submit, a retry after a flaky network or "Send update" can therefore never
// create a duplicate answer: the same (answerId, revision) is stored once and answered "duplicate" afterwards.
import { loadFixture } from './prepared-fixture.mjs';
import { nativeStudies, cardRevisions } from './native-cards.mjs';
import { renderPaperCard, storyImage } from './paper-card.mjs';
const V = '?v=28ac2b39fab85255';
const adapter = await import(`./vendor/discstudio-cards/thro-adapter.mjs${V}`);
const molds = await import(`./vendor/discstudio-cards/mold-library.js${V}`);
const $ = id => document.getElementById(id);
const opened = performance.now();
const CLIENT_VERSION = 'ask@2026-10-27.3';   // stored with every answer as provenance; bump when what this page sends changes
const ANSWER_ID = mintId();                   // one per page visit
function mintId() {                           // crypto.randomUUID needs a secure context; the fallback keeps plain-http previews working
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 0x0f | 0x40; b[8] = b[8] & 0x3f | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// <post-answer> (test/feedback.test.mjs loads exactly this block, so keep it free of DOM access)
// One POST of an already-frozen payload. Retries at most twice (400 ms, then 1.2 s later) and ONLY when the request itself fails
// (offline, dropped, timed out): any answer from the server, including 429/503/400, is final. Every attempt sends the identical bytes
// with the identical (answerId, revision), so a retry whose first attempt actually landed is answered "duplicate", not stored twice.
const RETRY_DELAYS_MS = [400, 1200], ATTEMPT_TIMEOUT_MS = 10000;
async function postAnswer(payload, { fetchFn = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), delays = RETRY_DELAYS_MS, timeoutMs = ATTEMPT_TIMEOUT_MS } = {}) {
  const body = JSON.stringify(payload);
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchFn('./api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ctl.signal });
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch { /* the edge answered with something that is not ours */ }
      return { saved: r.ok && j?.ok === true, status: r.status, error: j?.error ?? null, duplicate: j?.duplicate === true, tally: j?.tally ?? null, attempts: attempt + 1 };
    } catch {
      if (attempt >= delays.length) return { saved: false, status: 0, error: 'network', duplicate: false, tally: null, attempts: attempt + 1 };
      await sleep(delays[attempt]);
    } finally { clearTimeout(timer); }
  }
}
// </post-answer>

const fixture = await loadFixture(), disc = fixture.find(d => d.name === 'Servo') ?? fixture[0];
const tee = await image('./assets/tee-shot-original.jpg');
function image(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error(`Could not load ${src}`)); i.src = src; }); }
const blobImage = async blob => { const url = URL.createObjectURL(blob); try { return await image(url); } finally { URL.revokeObjectURL(url); } };
function flightsOf(d) {
  const base = molds.moldRecord(d.mold)?.flight ?? []; // the catalog's [speed, glide, turn, fade]; the sample's cited correction goes on top
  return ['speed', 'glide', 'turn', 'fade'].map((f, i) => d.flightOverrides?.[f] ?? base[i] ?? null);
}

// Every card on this page wears thro's orange (Sam, 27 Oct 14:37: the same orange detail as everything else), and the paper card
// (P01, the Mid-Century Retro ThroCard from Sam's first reel) joins the eleven overlay layouts.
const ACCENT = '#e0632e';
const studies = [...nativeStudies, { preset: 'p01', name: 'P01 · Paper card', orientation: 'portrait', paper: true }];
const logoSrc = (() => { const svg = document.querySelector('.brandbar svg'); return svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)) : null; })();
const picked = new Set(), tiles = [];
for (const study of studies) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'card'; b.setAttribute('aria-pressed', 'false'); b.dataset.preset = study.preset;
  const [code, ...rest] = study.name.split(' · ');
  b.innerHTML = `<canvas width="${study.orientation === 'portrait' ? 300 : 480}" height="${study.orientation === 'portrait' ? 420 : 300}"></canvas><span class="wait">drawing…</span><span class="name"><b>${code}</b> ${rest.join(' · ')}</span><span class="check" aria-hidden="true">✓</span><span class="tally" hidden><span class="bar"><i style="width:0"></i></span><span class="n"></span></span>`;
  b.setAttribute('aria-label', `${study.name}: pick this card`);
  const tile = document.createElement('div'); tile.className = 'tile';
  const story = document.createElement('button'); story.type = 'button'; story.className = 'story'; story.disabled = true;
  story.innerHTML = 'Share as a story <span aria-hidden="true">↗</span>'; story.setAttribute('aria-label', `${study.name}: save or share as an Instagram or TikTok story`);
  b.onclick = () => {
        if (picked.has(study.preset)) picked.delete(study.preset);
    else picked.add(study.preset);
    b.setAttribute('aria-pressed', String(picked.has(study.preset))); changed();
  };
  tile.append(b, story);
  $(study.orientation === 'portrait' ? 'portrait' : 'landscape').append(tile);
  const entry = { study, el: b, story, card: null };
  story.onclick = () => shareStory(entry);
  tiles.push(entry);
}
// Each tile: a window onto the full frame, centred on the card with room around it, so the card is big enough to judge and the
// shot around it is still there.
for (const entry of tiles) {
  const { study, el } = entry, c = el.querySelector('canvas'), ctx = c.getContext('2d');
  try {
    let W, H, b, card;
    if (study.paper) {
      // the paper card is a whole card, not an overlay: shown sitting in the corner of the same portrait frame
      W = 1080; H = 1920;
      const pc = await renderPaperCard({ name: disc.name, manufacturer: disc.manufacturer, plastic: disc.plastic ?? null, weight: disc.weight ?? null,
        flights: flightsOf(disc), photoSrc: disc.depiction.src, logoSrc, accent: ACCENT, width: 900 });
      const cw = 560, ch = cw * pc.height / pc.width; b = { x: 64, y: H - 120 - ch, w: cw, h: ch }; entry.card = pc;
      card = Object.assign(document.createElement('canvas'), { width: W, height: H }); card.getContext('2d').drawImage(pc, b.x, b.y, b.w, b.h);
    } else {
      const r = await adapter.renderDiscStudioCard({ disc: { id: disc.id, mold: disc.mold, name: disc.name, manufacturer: disc.manufacturer, plastic: disc.plastic ?? null, weight: null },
        photoSrc: disc.depiction.src, flights: flightsOf(disc), preset: study.preset, revision: cardRevisions[study.preset],
        appearance: { discSide: study.side, highlightTarget: study.highlight, accentColor: ACCENT } });
      card = await blobImage(r.png); W = r.width; H = r.height; b = r.layout.card;
      const only = Object.assign(document.createElement('canvas'), { width: Math.round(b.w), height: Math.round(b.h) });   // the card alone, for its story
      only.getContext('2d').drawImage(card, b.x, b.y, b.w, b.h, 0, 0, only.width, only.height); entry.card = only;
    }
    const frame = Object.assign(document.createElement('canvas'), { width: W, height: H }), f = frame.getContext('2d'), s0 = Math.max(W / tee.width, H / tee.height);
    f.drawImage(tee, (W - tee.width * s0) / 2, (H - tee.height * s0) / 2, tee.width * s0, tee.height * s0); f.drawImage(card, 0, 0);
    const aspect = c.width / c.height; let w = b.w * 1.45, h = b.h * 1.45;
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    w = Math.min(w, W); h = Math.min(h, H);
    const x = Math.max(0, Math.min(W - w, b.x + b.w / 2 - w / 2)), y = Math.max(0, Math.min(H - h, b.y + b.h / 2 - h / 2));
    ctx.drawImage(frame, x, y, w, h, 0, 0, c.width, c.height);
    el.querySelector('.wait').remove(); entry.story.disabled = false;
  } catch (e) { el.querySelector('.wait').textContent = 'could not draw'; console.error(e); }
}
// Share as a story: the card alone, centred on ink at 1080x1920 (Instagram and TikTok story size). On a phone the share sheet opens,
// so it goes straight to Instagram; where sharing files is not supported, the image downloads instead.
async function shareStory({ study, card, story }) {
  if (!card) return;
  const label = story.innerHTML; story.disabled = true;
  try {
    const s = await storyImage(card), blob = await new Promise(ok => s.toBlob(ok, 'image/png'));
    const file = new File([blob], `throcard-${study.preset}-story.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch { /* the person closed the share sheet */ } }
    else { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  } finally { story.disabled = false; story.innerHTML = label; }
}
$('main').setAttribute('aria-busy', 'false');

const sendDisabled = () => sending || !picked.size || (sentText !== null && feedbackKey() === sentText);
function status() {
  $('send').disabled = sendDisabled();
  $('status').innerHTML = picked.size ? `<b>${picked.size} of ${tiles.length}</b> picked` : 'Tap every card you\'d use.';
  $('all').textContent = picked.size === tiles.length ? 'Clear all' : 'Select all';
}
const nameOf = preset => studies.find(s => s.preset === preset).name;
function feedback() {
  const note = $('note').value.trim(), seconds = Math.round((performance.now() - opened) / 1000);
  return [`My pick${picked.size > 1 ? 's' : ''}: ${[...document.querySelectorAll('.card[aria-pressed=true]')].map(el => nameOf(el.dataset.preset)).join(', ')}`, note && `What I'd change: ${note}`, `(${seconds}s, on ${matchMedia('(pointer:coarse)').matches ? 'a phone' : 'a computer'})`].filter(Boolean).join('\n');
}
let sentText = null;   // what was last saved; Send re-enables once the picks or the note change
let revision = 0, attempted = null, pending = null, sending = false;   // revision/attempted/pending: the identity and frozen payload of the newest content
function changed() { status(); if (sentText !== null && feedbackKey() !== sentText) { $('send').textContent = 'Send update'; } }
const feedbackKey = () => JSON.stringify([[...picked].sort(), $('note').value.trim()]);
function showTally(t) {
  if (!t?.total) return;
  for (const { study, el } of tiles) {
    const n = t.counts?.[study.preset] ?? 0, box = el.querySelector('.tally');
    box.hidden = false; box.querySelector('i').style.width = `${Math.round(100 * n / t.total)}%`;
    box.querySelector('.n').textContent = `${n} of ${t.total}`;
    box.title = `${n} of ${t.total} answers so far would put this card on screen`;
  }
}
$('send').onclick = async () => {
  if (sending || !picked.size) return;                 // a second click while a request is in flight does nothing
  sending = true; $('send').disabled = true; $('send').textContent = 'Sending…';
  const text = feedback(), box = $('copy-fallback'), key = feedbackKey();
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; box.hidden = true; }
  catch { box.value = text; box.hidden = false; box.focus(); box.select(); }
  if (key !== attempted) {   // new picks or note -> next revision, payload frozen now; the same content again (retry after a failure) reuses both
    attempted = key; revision += 1;
    pending = { answerId: ANSWER_ID, revision, picks: [...picked].sort(), note: $('note').value.trim(), seconds: Math.round((performance.now() - opened) / 1000),
      device: matchMedia('(pointer:coarse)').matches ? 'phone' : 'computer', clientVersion: CLIENT_VERSION };
  }
  let r;
  try { r = await postAnswer(pending); } finally { sending = false; }   // never leave Send stuck disabled
  const saved = r.saved;
  if (saved) sentText = key;
  const why = r.error === 'daily_cap_reached' ? 'Saving is paused for today' : r.error === 'rate_limited' ? 'Too many sends just now' : 'Couldn\'t save just now';
  $('status').innerHTML = saved
    ? (copied ? '<b>Sent, and copied.</b> Paste it in the Slack thread.' : '<b>Sent.</b> Copy the text below for the Slack thread.')
    : (copied ? `<b>Copied.</b> ${why}; paste it in the Slack thread.` : '<b>Copy this</b> and paste it in the Slack thread.');
  $('send').textContent = saved && sentText === feedbackKey() ? 'Sent ✓' : sentText !== null ? 'Send update' : 'Send';
  $('send').disabled = sendDisabled();
  if (saved) showTally(r.tally);
};
$('all').onclick = () => {
  const every = picked.size !== tiles.length;
  for (const { study, el } of tiles) { every ? picked.add(study.preset) : picked.delete(study.preset); el.setAttribute('aria-pressed', String(every)); }
  changed();
};
$('note').addEventListener('input', () => { $('copy-fallback').hidden = true; changed(); });
status();
