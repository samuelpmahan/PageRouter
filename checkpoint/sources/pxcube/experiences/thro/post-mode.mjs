// Post: your Single cards, as many as you pick (1–4), on one frame with a background and your own words (Sam, 30 Oct 16:30:
// "make the one card that already edited like that edit over a background. Put text on it"; 16:40: "accommodate a dynamic layout
// over forcing identical posts every time").
// Every card here is a Single card: drawn by the same workspace.single() call with the same design, and edited with the same
// on-card editor (Side, Colour, Plate, the Recipe handles). The post only places the drawn card pixels, cropped to the card,
// on its frame. The starting layout follows how many cards there are and their shapes; drag a card or a line of text and your
// place wins. One drawing makes both the preview and the download, so what you see is what you get.
// The post is kept in this browser (localStorage), apart from the saved workspace, whose modes stay Single, Battle and Bag.

const KEY = 'thro-post-v1';
export const postFrames = Object.freeze([['4:5', '4:5 · 1080 × 1350', 1080, 1350], ['1:1', '1:1 · 1080 × 1080', 1080, 1080], ['9:16', '9:16 · 1080 × 1920', 1080, 1920]]);
const backdrops = [['paper', 'Paper'], ['ink', 'Ink'], ['accent', 'Accent colour'], ['none', 'Transparent']];
const INK = '#2b2420', PAPER = '#f3e8d2', MUTED = '#6f6253';
const PAD = 64, GAP = 36;

let api = null, state = null, drawn = null, drawToken = 0;
const graphics = new Map(); // disc + design → the Single card graphic (the workspace keeps its own pixel cache too)
const images = new Map();   // card PNG data → decoded image

export function loadPost() {
  try { state = JSON.parse(localStorage.getItem(KEY)) ?? null; } catch { state = null; }
  return state;
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* the post still works for this visit */ } };
export const postActive = () => Boolean(loadPost()?.active);
export function setPostActive(on) { loadPost(); if (!state) return; state.active = on; save(); }

function freshState(a) {
  const first = a.rows[0]?.address;
  return { active: true, frame: '4:5', backdrop: 'paper', accent: '#e0632e', logo: true,
    eyebrow: 'Putter check', headline: 'Which putter do you use?', credit: 'made with thro',
    cards: first ? [newCard(a, first)] : [], selected: 0, text: {} };
}
function newCard(a, disc) {
  const design = a.nativeDesign({ ...a.design() }, 'discstudio:b01');
  const revision = a.latestCardRevision('discstudio:b01');
  if (revision !== undefined) design.nativeRevision = revision;
  return { disc, design, box: null };
}

const frameOf = () => postFrames.find(f => f[0] === state.frame) ?? postFrames[0];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const opt = (v, label, chosen) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(label)}</option>`;

// ---- Drawing: one canvas for the preview and the download ----
const pngHref = svg => /href=["'](data:image\/png;base64,[^"']+)["']/.exec(svg)?.[1];
function decode(src) {
  if (!images.has(src)) images.set(src, new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; }));
  if (images.size > 40) images.delete(images.keys().next().value);
  return images.get(src);
}
async function cardGraphic(card) {
  const design = { ...card.design, accent: state.accent };
  const key = JSON.stringify([card.disc, design]);
  if (!graphics.has(key)) graphics.set(key, api.single(card.disc, design).then(r => r.graphic));
  if (graphics.size > 30) graphics.delete(graphics.keys().next().value);
  const graphic = await graphics.get(key);
  const layout = api.cardLayout(graphic.svg), b = layout?.card;
  const bounds = b ? { x: Math.max(0, Math.floor(b.x)), y: Math.max(0, Math.floor(b.y)), w: Math.ceil(b.w), h: Math.ceil(b.h) } : { x: 0, y: 0, w: graphic.width, h: graphic.height };
  return { graphic, layout, bounds, design, image: await decode(pngHref(graphic.svg)) };
}

function wrap(ctx, words, max) {
  const lines = []; let line = '';
  for (const w of String(words).split(/\s+/).filter(Boolean)) { const next = line ? `${line} ${w}` : w; if (line && ctx.measureText(next).width > max) { lines.push(line); line = w; } else line = next; }
  if (line) lines.push(line);
  return lines;
}
const fonts = () => Promise.all(['700 30px Jost', '800 88px Jost', '700 24px Jost'].map(f => document.fonts?.load(f).catch(() => null)));
let logoImage = null;
function logo(colour) {
  const svg = document.querySelector('.wordmark svg');
  if (!svg) return Promise.resolve(null);
  const src = svg.outerHTML.replace(/fill="#2b2420"/gi, `fill="${colour}"`); // the wordmark takes the text colour; its arrow keeps thro orange
  const standalone = /xmlns=/.test(src.slice(0, src.indexOf('>'))) ? src : src.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  if (logoImage?.src === src) return logoImage.image;
  const image = decode(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(standalone)}`).catch(() => null);
  logoImage = { src, image }; return image;
}

/** The arrangement for this many cards, of these shapes, in this area: the column count that draws the smallest card largest. */
function arrange(shapes, area) {
  let best = null;
  for (let cols = 1; cols <= shapes.length; cols++) {
    const rows = Math.ceil(shapes.length / cols), cw = (area.w - GAP * (cols - 1)) / cols, ch = (area.h - GAP * (rows - 1)) / rows;
    const fits = shapes.map(s => Math.min(cw / s.w, ch / s.h, 1.6));
    const smallest = Math.min(...fits);
    if (!best || smallest > best.smallest + 1e-6) best = { cols, rows, cw, ch, fits, smallest };
  }
  // One shared scale, so the cards read as one family. Rows sit together (one gap apart) and the block is centred in the room;
  // each card is centred in its column and sits on its row's baseline.
  const s = best.smallest, sized = shapes.map(sh => ({ w: sh.w * s, h: sh.h * s }));
  const rowsOf = Array.from({ length: best.rows }, (_, r) => sized.slice(r * best.cols, r * best.cols + best.cols));
  const rowH = rowsOf.map(row => Math.max(...row.map(c => c.h))), blockH = rowH.reduce((t, h) => t + h, 0) + GAP * (best.rows - 1);
  let y = area.y + Math.max(0, (area.h - blockH) / 2);
  const out = [];
  rowsOf.forEach((row, r) => {
    const rowW = row.length * best.cw + (row.length - 1) * GAP, x0 = area.x + (area.w - rowW) / 2;
    row.forEach((c, k) => out.push({ x: x0 + k * (best.cw + GAP) + (best.cw - c.w) / 2, y: y + rowH[r] - c.h, w: c.w, h: c.h }));
    y += rowH[r] + GAP;
  });
  return out;
}

async function compose() {
  const [, , W, H] = frameOf();
  const cards = await Promise.all(state.cards.map(cardGraphic));
  await fonts();
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const ink = state.backdrop === 'ink' ? PAPER : INK, quiet = state.backdrop === 'ink' ? '#cdbfa6' : state.backdrop === 'accent' ? INK : MUTED;
  if (state.backdrop !== 'none') { ctx.fillStyle = state.backdrop === 'ink' ? INK : state.backdrop === 'accent' ? state.accent : PAPER; ctx.fillRect(0, 0, W, H); }
  const rects = { text: {} };
  // Words: eyebrow and headline at the top, the credit and the logo at the bottom; each one movable.
  let top = PAD;
  const place = (id, x, y, w, h) => { const p = state.text[id]; const r = p ? { x: p.x, y: p.y, w, h } : { x, y, w, h }; rects.text[id] = r; return r; };
  if (state.eyebrow.trim()) {
    ctx.font = '700 30px Jost'; ctx.letterSpacing = '6px';
    const t = state.eyebrow.toUpperCase(), r = place('eyebrow', PAD, top, ctx.measureText(t).width, 34);
    ctx.fillStyle = state.backdrop === 'accent' ? ink : state.accent; ctx.textBaseline = 'top'; ctx.fillText(t, r.x, r.y);
    ctx.letterSpacing = '0px'; if (!state.text.eyebrow) top += 34 + 18;
  }
  if (state.headline.trim()) {
    ctx.font = '800 88px Jost';
    const lines = wrap(ctx, state.headline, W - PAD * 2).slice(0, 4), lh = 88 * 0.98;
    const r = place('headline', PAD, top, Math.max(...lines.map(l => ctx.measureText(l).width)), lines.length * lh);
    ctx.fillStyle = ink; ctx.textBaseline = 'top'; lines.forEach((l, i) => ctx.fillText(l, r.x, r.y + i * lh));
    if (!state.text.headline) top += lines.length * lh;
  }
  let bottom = H - PAD;
  if (state.logo || state.credit.trim()) {
    const rule = H - 118;
    ctx.fillStyle = ink; ctx.fillRect(PAD, rule, W - PAD * 2, 4);
    if (state.logo) { const img = await logo(ink).catch(() => null); if (img) { const h = 54, w = h * (img.width / img.height || 2.9); ctx.drawImage(img, PAD, H - 44 - h, w, h); } }
    if (state.credit.trim()) {
      ctx.font = '700 24px Jost'; ctx.letterSpacing = '3px';
      const t = state.credit.toUpperCase(), tw = ctx.measureText(t).width, r = place('credit', W - PAD - tw, H - 44 - 24 - 6, tw, 28);
      ctx.fillStyle = quiet; ctx.textBaseline = 'top'; ctx.fillText(t, r.x, r.y); ctx.letterSpacing = '0px';
    }
    bottom = rule;
  }
  // Cards: the auto arrangement in the room the words leave, unless the card has been placed by hand.
  const area = { x: PAD, y: top + (top > PAD ? GAP : 0), w: W - PAD * 2, h: bottom - GAP - (top + (top > PAD ? GAP : 0)) };
  const auto = cards.length ? arrange(cards.map(c => c.bounds), area) : [];
  rects.cards = cards.map((c, i) => {
    const box = state.cards[i].box, r = box ? { x: box.x, y: box.y, w: box.w, h: box.w * c.bounds.h / c.bounds.w } : auto[i];
    ctx.drawImage(c.image, c.bounds.x, c.bounds.y, c.bounds.w, c.bounds.h, r.x, r.y, r.w, r.h);
    return r;
  });
  return { canvas, rects, cards, W, H };
}

// ---- Page ----
function markup(a) {
  const [, , W, H] = frameOf(), cards = state.cards;
  const shelf = `<aside class="shelf panel is-multiple" aria-labelledby="post-shelf-title"><div class="section-heading"><div><span class="eyebrow">STEP 1 · PICK</span><h2 id="post-shelf-title">Your discs</h2></div><span class="count">${a.rows.length}</span></div><p class="subtle">Tap discs to put them in the post (1–4). Each one is its Single card.</p><div class="disc-shelf">${a.rows.map((row, index) => {
    const on = cards.some(c => c.disc === row.address);
    return `<button type="button" class="disc-choice ${on ? 'is-selected' : ''}" data-post-disc="${esc(row.address)}" aria-pressed="${on}" aria-label="${esc(row.seed.manufacturer)} ${esc(a.rowName(row))}"><span class="disc-thumb"><img src="${esc(row.art)}" alt="" loading="${index < 4 ? 'eager' : 'lazy'}"><span class="selection-mark" aria-hidden="true">${on ? '✓' : '+'}</span></span><span class="disc-copy"><span class="disc-maker">${esc(row.seed.manufacturer)}</span><strong>${esc(a.rowName(row))}</strong></span></button>`;
  }).join('')}</div><div class="lineup-total"><strong>${cards.length} in the post</strong><span>1–4 cards</span></div></aside>`;
  const preview = `<section class="preview-column" aria-labelledby="post-preview-title"><div class="preview-heading"><div><span class="eyebrow">YOUR POST</span><h2 id="post-preview-title">${cards.length ? 'Tap a card to edit it. Drag cards and words to move them.' : 'Pick a disc to start.'}</h2></div></div><div class="preview-shell"><div class="preview-toolbar"><span class="preview-dimensions">${W} × ${H}</span><button type="button" id="post-reset" class="text-button">Put everything back in the automatic layout</button></div><div id="post-stage" class="post-stage preview-checker" style="aspect-ratio:${W} / ${H}"><img id="post-image" alt="Your post"><div id="post-layer" class="post-layer"></div></div></div><div id="post-strip"></div><div class="export-bar"><div class="export-copy"><span class="eyebrow">STEP 3 · POST IT</span><p>One ${W} × ${H} PNG, exactly as shown.</p></div><div class="export-actions"><button id="post-download" type="button" class="button-primary">Download PNG <span aria-hidden="true">↓</span></button></div></div></section>`;
  const studies = a.nativeStudies.map(s => [s.id, s.name]);
  const cardRows = cards.map((c, i) => { const row = a.rows.find(r => r.address === c.disc); return `<div class="post-card-row${i === state.selected ? ' is-selected' : ''}"><button type="button" class="text-button" data-post-select="${i}">${i + 1}. ${esc(row ? a.rowName(row) : 'Disc')}${i === state.selected ? ' · editing' : ''}</button><label><span class="sr-only">Layout</span><select data-post-study="${i}">${studies.map(([id, n]) => opt(id, n, c.design.study)).join('')}</select></label></div>`; }).join('');
  const controls = `<aside class="controls-panel panel" aria-labelledby="post-style-title"><div class="section-heading"><div><span class="eyebrow">STEP 2 · STYLE</span><h2 id="post-style-title">Make it yours</h2></div></div><form id="post-form" class="post-form">
    <div class="field-pair"><label>Frame<select id="post-frame">${postFrames.map(([id, n]) => opt(id, n, state.frame)).join('')}</select></label><label>Accent<input id="post-accent" type="color" value="${esc(state.accent)}"></label></div>
    <div class="swatches" role="group" aria-label="Accent colour">${a.palette.map(([hex, name]) => `<button type="button" class="swatch-choice${hex.toLowerCase() === state.accent.toLowerCase() ? ' is-selected' : ''}" data-post-swatch="${hex}" aria-label="${name}" title="${name}"><span style="background:${hex}"></span></button>`).join('')}<button type="button" class="swatch-choice${state.accent.toLowerCase() === '#e0632e' ? ' is-selected' : ''}" data-post-swatch="#e0632e" aria-label="thro orange" title="thro orange"><span style="background:#e0632e"></span></button></div>
    <label>Background<select id="post-backdrop">${backdrops.map(([id, n]) => opt(id, n, state.backdrop)).join('')}</select></label>
    <label>Small label <span class="optional">above the headline</span><input id="post-eyebrow" value="${esc(state.eyebrow)}" placeholder="Leave empty for none"></label>
    <label>Headline<textarea id="post-headline" rows="2" placeholder="Leave empty for none">${esc(state.headline)}</textarea></label>
    <label>Credit <span class="optional">bottom right</span><input id="post-credit" value="${esc(state.credit)}" placeholder="@maker · made with thro"></label>
    <label class="post-check"><input id="post-logo" type="checkbox"${state.logo ? ' checked' : ''}> thro logo and line at the bottom</label>
    ${cards.length ? `<div class="post-cards"><span class="eyebrow">CARDS</span>${cardRows}</div>` : ''}
  </form></aside>`;
  return `<div class="studio-grid post-grid">${shelf}${preview}${controls}</div>`;
}

const STYLE = `
.post-stage{position:relative;width:100%;overflow:hidden;border-radius:0}
.post-stage>img{position:absolute;inset:0;width:100%;height:100%;display:block}
.post-layer{position:absolute;inset:0}
.post-box{position:absolute;border:1.5px dashed transparent;border-radius:6px;cursor:grab;touch-action:none}
.post-box:hover,.post-box:focus-visible{border-color:#2b242080}
.post-box.is-selected{border-color:var(--accent);border-style:solid;box-shadow:0 0 0 2px #fff8}
.post-box.is-text:hover{border-color:var(--accent)}
.post-knob{position:absolute;right:-14px;bottom:-14px;width:28px;height:28px;min-height:0;padding:0;border-radius:50%;background:#ff2d55;border:3px solid #fff;color:#fff;font-size:13px;cursor:nwse-resize;touch-action:none;box-shadow:0 2px 8px #0006}
.post-card-holder{position:absolute;pointer-events:none}
.post-card-holder>svg{position:absolute;inset:0;width:100%;height:100%;opacity:0}
.post-card-holder .card-editor .ce-card,.post-card-holder .card-editor .ce-knob{display:none}
.post-card-holder .card-editor{pointer-events:none}
#post-strip .ce-strip,#post-strip .cp-recipe{border-radius:0}
.post-form textarea{width:100%;min-height:64px;border:1px solid var(--line);border-radius:8px;padding:10px;background:#f8f0df;color:var(--ink);font:600 14px/1.3 "Jost",sans-serif;resize:vertical}
.post-check{flex-direction:row;align-items:center;gap:10px}.post-check input{width:20px;height:20px;min-height:0}
.post-cards{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--line);padding-top:14px}
.post-card-row{display:flex;flex-direction:column;align-items:stretch;gap:2px;padding:6px 8px;border-radius:10px}
.post-card-row>.text-button{align-self:flex-start;font-size:13px;font-weight:700;color:var(--ink);padding:4px 0;min-height:30px}
.post-card-row.is-selected{background:#ead9b8}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.swatch-choice{min-height:34px;width:34px;padding:4px;border-radius:50%}
.swatch-choice span{display:block;width:100%;height:100%;border-radius:50%}
.swatch-choice.is-selected{border:2px solid var(--ink)}
`;

export function paintPost(root, a) {
  api = a; if (!loadPost() || !state.cards) state = freshState(a); state.active = true; save();
  if (!document.getElementById('post-style')) { const s = document.createElement('style'); s.id = 'post-style'; s.textContent = STYLE; document.head.append(s); }
  root.querySelector('.studio-grid')?.remove();
  root.querySelector('.captures')?.remove();
  root.insertAdjacentHTML('beforeend', markup(a));
  bind(root);
  redraw();
}

function rerender(root) { const grid = root.querySelector('.post-grid'); grid?.remove(); root.insertAdjacentHTML('beforeend', markup(api)); bind(root); redraw(); }

function bind(root) {
  root.querySelectorAll('[data-post-disc]').forEach(b => b.onclick = () => {
    const disc = b.dataset.postDisc, at = state.cards.findIndex(c => c.disc === disc);
    if (at >= 0) { state.cards.splice(at, 1); state.selected = Math.min(state.selected, state.cards.length - 1); }
    else if (state.cards.length >= 4) { api.message('A post holds up to four cards. Tap one in the post to take it out first.'); return; }
    else { const card = newCard(api, disc); const like = state.cards[state.selected] ?? state.cards[0]; if (like) card.design = { ...like.design }; state.cards.push(card); state.selected = state.cards.length - 1; }
    state.cards.forEach(c => { c.box = null; }); // a different set of cards gets a fresh arrangement
    save(); rerender(root);
  });
  const form = root.querySelector('#post-form');
  const read = () => {
    state.frame = form.querySelector('#post-frame').value; state.backdrop = form.querySelector('#post-backdrop').value;
    state.accent = form.querySelector('#post-accent').value; state.eyebrow = form.querySelector('#post-eyebrow').value;
    state.headline = form.querySelector('#post-headline').value; state.credit = form.querySelector('#post-credit').value;
    state.logo = form.querySelector('#post-logo').checked;
  };
  let typing = 0;
  form.oninput = e => { read(); save(); clearTimeout(typing); typing = setTimeout(redraw, e.target.matches('input[type=text], input:not([type]), textarea') ? 250 : 0); };
  form.onchange = e => {
    read();
    if (e.target.id === 'post-frame') { state.cards.forEach(c => { c.box = null; }); state.text = {}; save(); rerender(root); return; }
    save(); redraw();
  };
  form.querySelectorAll('[data-post-swatch]').forEach(b => b.onclick = () => { state.accent = b.dataset.postSwatch; save(); rerender(root); });
  form.querySelectorAll('[data-post-select]').forEach(b => b.onclick = () => { state.selected = Number(b.dataset.postSelect); save(); rerender(root); });
  form.querySelectorAll('[data-post-study]').forEach(s => s.onchange = e => {
    e.stopPropagation(); const i = Number(s.dataset.postStudy), card = state.cards[i];
    card.design = api.nativeDesign(card.design, s.value); const rev = api.latestCardRevision(s.value); if (rev !== undefined) card.design.nativeRevision = rev;
    card.box = null; state.selected = i; save(); rerender(root);
  });
  root.querySelector('#post-reset').onclick = () => { state.cards.forEach(c => { c.box = null; }); state.text = {}; save(); redraw(); };
  root.querySelector('#post-download').onclick = download;
}

async function redraw() {
  const token = ++drawToken, stage = document.getElementById('post-stage');
  if (!stage) return;
  try {
    const result = await compose();
    if (token !== drawToken || !stage.isConnected) return;
    drawn = result;
    document.getElementById('post-image').src = result.canvas.toDataURL('image/png');
    overlays(stage);
    api.message(`Post ready · ${result.W} × ${result.H}.`);
  } catch (error) { if (token === drawToken) api.message(`The post could not be drawn: ${error.message ?? error}`, true); }
}

// ---- Moving, sizing and editing on the post ----
function overlays(stage) {
  const layer = stage.querySelector('#post-layer'), { W, H, rects, cards } = drawn;
  layer.innerHTML = '';
  stage.querySelector('.post-card-holder')?.remove();
  document.getElementById('post-strip').innerHTML = '';
  const pct = r => ({ left: `${r.x / W * 100}%`, top: `${r.y / H * 100}%`, width: `${r.w / W * 100}%`, height: `${r.h / H * 100}%` });
  const scale = () => stage.getBoundingClientRect().width / W;
  const drag = (el, onMove, onUp) => el.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('.post-knob')) return;
    e.preventDefault(); const x0 = e.clientX, y0 = e.clientY, s = scale(); let moved = false;
    const mv = ev => { const dx = (ev.clientX - x0) / s, dy = (ev.clientY - y0) / s; if (!moved && Math.hypot(dx, dy) * s < 5) return; moved = true; onMove(dx, dy); };
    const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); onUp(moved, (ev.clientX - x0) / s, (ev.clientY - y0) / s); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  rects.cards.forEach((r, i) => {
    const box = Object.assign(document.createElement('div'), { className: `post-box${i === state.selected ? ' is-selected' : ''}`, tabIndex: 0, title: 'Tap to edit this card. Drag to move it.' });
    Object.assign(box.style, pct(r)); box.setAttribute('role', 'button'); box.setAttribute('aria-label', `Card ${i + 1}: tap to edit, drag to move`);
    drag(box, (dx, dy) => { box.style.translate = `${dx * scale()}px ${dy * scale()}px`; }, (moved, dx, dy) => {
      if (!moved) { if (state.selected !== i) { state.selected = i; save(); rerender(stage.closest('#workspace')); } return; }
      state.cards[i].box = { x: Math.round(r.x + dx), y: Math.round(r.y + dy), w: Math.round(r.w) }; state.selected = i; save(); redraw();
    });
    if (i === state.selected) {
      const knob = Object.assign(document.createElement('button'), { type: 'button', className: 'post-knob', textContent: '⤡', title: 'Drag to size this card' });
      knob.setAttribute('aria-label', 'Card size: drag to change');
      knob.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); const x0 = e.clientX, s = scale(); let w = r.w;
        const mv = ev => { w = Math.max(120, r.w + (ev.clientX - x0) / s); box.style.width = `${w / W * 100}%`; box.style.height = `${w * r.h / r.w / H * 100}%`; };
        const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); state.cards[i].box = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(w) }; save(); redraw(); };
        addEventListener('pointermove', mv); addEventListener('pointerup', up);
      });
      box.append(knob);
    }
    layer.append(box);
  });
  for (const [id, r] of Object.entries(rects.text)) {
    const box = Object.assign(document.createElement('div'), { className: 'post-box is-text', title: 'Drag to move these words' });
    Object.assign(box.style, pct({ x: r.x - 8, y: r.y - 6, w: r.w + 16, h: r.h + 12 }));
    drag(box, (dx, dy) => { box.style.translate = `${dx * scale()}px ${dy * scale()}px`; }, (moved, dx, dy) => {
      if (!moved) return; state.text[id] = { x: Math.round(r.x + dx), y: Math.round(r.y + dy) }; save(); redraw();
    });
    layer.append(box);
  }
  // The selected card gets the Single card editor: its badges and Recipe handles, over the card's own pixels in the post.
  const i = state.selected, c = cards[i], r = rects.cards[i];
  if (!c || !r) return;
  const holder = Object.assign(document.createElement('div'), { className: 'post-card-holder' });
  Object.assign(holder.style, pct(r));
  holder.innerHTML = c.graphic.svg;
  const svg = holder.querySelector('svg');
  svg.setAttribute('viewBox', `${c.bounds.x} ${c.bounds.y} ${c.bounds.w} ${c.bounds.h}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.removeAttribute('width'); svg.removeAttribute('height');
  stage.append(holder);
  const strip = document.getElementById('post-strip');
  api.attachCardEditor(holder, { graphic: c.graphic, layout: c.layout, bounds: c.bounds, design: c.design, fixedRevision: api.latestCardRevision(c.design.study), onChange: (controls, note) => {
    const card = state.cards[i];
    if (controls.nudge || controls.scale !== undefined) return; // on a post, the post moves and sizes the card
    card.design = api.nativeControlDesign(card.design, { study: card.design.study, ...controls }); save();
    api.message(`${note}. Drawing…`); redraw();
  } });
  holder.querySelectorAll('.card-editor .ce-badge, .card-parts .cp-h').forEach(e => { e.style.pointerEvents = 'auto'; });
  for (const el of [...stage.parentElement.children].filter(e => e.matches('.ce-strip, .cp-recipe'))) strip.append(el);
  for (const el of [...stage.children].filter(e => e.matches('.ce-strip, .cp-recipe'))) strip.append(el);
}

async function download() {
  if (!drawn) return;
  const blob = await new Promise(ok => drawn.canvas.toBlob(ok, 'image/png'));
  const hash = await api.sha256(blob), slug = (state.headline || state.eyebrow || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'post';
  const filename = `thro-${slug}-${drawn.W}x${drawn.H}-${hash.slice(0, 8)}.png`;
  api.downloadBlob(blob, filename);
  api.message(`PNG ready · ${drawn.W} × ${drawn.H}. Download requested (${filename}).`);
}
