// Handles on the parts of the card: the first Constraint Lab (Wed 21 Oct), on the real card (Sam, 24 Oct 10:26: "Have you even made a
// version of Constraint Lab as good as the first one yet?"). Each red handle sits on the part it changes and its shape says how:
//   ● on the disc centre   moves the disc on the plate's corner      ● on the disc rim   sizes the disc
//   ▮ on the plate edge    sets the plate's width                      ■ on the last tile   sets the number size
//   ▲ past the name's end  sets the largest name size              (the ■ sits past the last tile, never on a digit)
// Dragging pins that part; every part not pinned is derived by the renderer's rules (solveB01 in thro-card-core-r2.js) and the card
// re-forms around it. While the finger is down the page solves the same rules and outlines where every part will be; on release the
// renderer redraws the card. The recipe (each part: its value and whether it is a default, pinned, or derived) is shown under the card.
import { solveB01, B01_PARTS } from './vendor/discstudio-cards/thro-card-core-r2.js?v=28ac2b39fab85255';
import { begin, settle } from './gestures.mjs';
import { chromeAnchor, placeClear, spotsAround } from './editor-place.mjs';

const STYLE = `
.card-parts{position:absolute;inset:0;pointer-events:none;z-index:3}
.card-parts .cp-h{position:absolute;pointer-events:auto;touch-action:none;min-height:0;min-width:0;padding:0;background:#ff2d55;border:3px solid #fff;box-shadow:0 2px 8px #0008;cursor:grab;transform:translate(-50%,-50%)}
.card-parts .cp-h:focus-visible{outline:3px solid var(--accent,#b5d899);outline-offset:3px}
.card-parts .cp-dot{width:26px;height:26px;border-radius:50%}
.card-parts .cp-bar{width:14px;height:46px;border-radius:4px;cursor:ew-resize}
.card-parts .cp-square{width:22px;height:22px;border-radius:3px;cursor:nwse-resize}
.card-parts .cp-tri{width:30px;height:26px;background:transparent;border:0;box-shadow:none;cursor:ns-resize}
.card-parts .cp-tri::before{content:"";position:absolute;inset:0;background:#fff;clip-path:polygon(50% 0,100% 100%,0 100%)}
.card-parts .cp-tri::after{content:"";position:absolute;inset:5px 6px 3px;background:#ff2d55;clip-path:polygon(50% 0,100% 100%,0 100%)}
.card-parts .cp-ghost{position:absolute;border:2px dashed #fff;pointer-events:none;box-shadow:0 0 0 1px #0007}
.card-parts .cp-ghost.round{border-radius:50%}
.card-parts .cp-tip{position:absolute;pointer-events:none;transform:translate(-50%,calc(-100% - 18px));background:#0b100de8;color:#fff;border:1px solid #ff2d55;border-radius:6px;padding:3px 7px;font:700 12px/1.3 system-ui,sans-serif;white-space:nowrap}
@media (pointer:coarse){.card-parts .cp-dot{width:34px;height:34px}.card-parts .cp-bar{width:20px;height:56px}.card-parts .cp-square{width:30px;height:30px}.card-parts .cp-tri{width:38px;height:32px}}
.cp-recipe{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:8px 10px;border-top:1px solid #3a493b;background:#18221b;font:12px/1.4 system-ui,sans-serif;color:#c9d3c8}
.cp-recipe .cp-label{font-size:10px;letter-spacing:1.2px;color:#9fb19a;font-weight:700}
.cp-recipe .cp-part{display:inline-flex;gap:5px;align-items:baseline;border:1px solid #33443a;border-radius:12px;padding:2px 8px}
.cp-recipe .cp-part b{font-variant-numeric:tabular-nums;color:#eef3ea}
.cp-recipe .cp-state{font-size:9.5px;letter-spacing:.6px;text-transform:uppercase;font-weight:700}
.cp-recipe .cp-pinned{border-color:#ff2d55}.cp-recipe .cp-pinned .cp-state{color:#ff8fa6}
.cp-recipe .cp-derived .cp-state{color:#b5d899}.cp-recipe .cp-default .cp-state{color:#7f907c}
.cp-recipe .cp-msg{flex-basis:100%;color:#ffd166;font-size:11.5px}
.cp-recipe button{min-height:32px;padding:4px 10px;font-size:11.5px;border-radius:16px}
.cp-recipe .cp-part{flex-wrap:wrap;align-items:center}
.cp-recipe .cp-ctl{display:inline-flex;align-items:center;gap:3px}
.cp-recipe .cp-ctl button{min-height:26px;min-width:26px;padding:0 6px;border-radius:13px;font-weight:800}
.cp-recipe .cp-ctl input[type=range]{width:110px;min-height:0;padding:0;accent-color:#ff2d55}
.cp-recipe .cp-ctl button[aria-pressed=true]{background:#ff2d55;border-color:#ff2d55;color:#fff}
`;
const TITLES = { 'disc-centre': 'Drag to move the disc on the plate corner', 'disc-rim': 'Drag to size the disc', 'plate-edge': 'Drag to set the plate width', tile: 'Drag to set the number size', name: 'Drag up or down to set the largest name size' };
const clamp = (v, [a, b]) => Math.max(a, Math.min(b, v)), round3 = v => Math.round(v * 1000) / 1000;
const DISPLAY = '"DS Card Sans Condensed", "DejaVu Sans Condensed", "Nimbus Sans Narrow", "DejaVu Sans", sans-serif';
let measurer = null;
const nameWidthFor = name => px => { measurer ??= document.createElement('canvas').getContext('2d'); measurer.font = `800 ${px}px ${DISPLAY}`; return measurer.measureText(name.toUpperCase()).width; };
const range = k => [B01_PARTS[k].min, B01_PARTS[k].max];
const shown = (k, v) => (B01_PARTS[k].unit === 'px' ? `${Math.round(v)} px` : B01_PARTS[k].unit === 'choice' ? B01_PARTS[k].choices[Math.round(v)] : v.toFixed(2));
const snap = (k, v) => { const p = B01_PARTS[k], r = Math.min(p.max, Math.max(p.min, v)); return p.unit === 'px' || p.unit === 'choice' ? Math.round(r) : Math.round(r * 1000) / 1000; };

/** What dragging a handle by (dx, dy) native pixels pins, from the card as it is now drawn (the lab's own rules). */
export function pinFor(id, recipe, dx, dy) {
  const g = recipe.native, dir = recipe.dir, v = recipe.values;
  const edge = dir > 0 ? g.plate.x + g.plate.w : g.plate.x;
  if (id === 'disc-centre') return { discOX: round3(clamp(dir * (g.disc.cx + dx - edge) / g.disc.d, range('discOX'))), discOY: round3(clamp((g.disc.cy + dy - g.plate.y) / g.disc.d, range('discOY'))) };
  if (id === 'disc-rim') return { discD: Math.round(clamp(g.disc.d + 2 * dir * dx, range('discD'))) };
  if (id === 'plate-edge') return { plateW: Math.round(clamp(g.plate.w + dir * dx, range('plateW'))) };
  if (id === 'tile') return { tile: Math.round(clamp(g.tiles.size + dir * dx / 4, range('tile'))) };
  if (id === 'name') return { nameMax: Math.round(clamp(g.name.px - dy, range('nameMax'))) };
  return {};
}

/** Put the handles on the card. view(): canvas pixels → holder pixels (the editor's own mapping). Returns detach. */
export function attachCardParts(holder, layer, { recipe, design, name, view, onChange }) {
  if (!recipe?.handles?.length) return () => {};
  if (!document.getElementById('card-parts-style')) { const s = document.createElement('style'); s.id = 'card-parts-style'; s.textContent = STYLE; document.head.appendChild(s); }
  const parts = document.createElement('div'); parts.className = 'card-parts'; layer.appendChild(parts);
  const [a, b, c, d, e, f] = recipe.m, toCanvas = (x, y) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
  const pinned = { ...(design.nativeParts ?? {}) };

  // The recipe, under the card: each part, its value, and whether it is a default, pinned by you, or derived by the rules.
  const panel = document.createElement('div'); panel.className = 'cp-recipe'; panel.setAttribute('aria-label', 'Card recipe');
  const strip = holder.closest('.preview-column')?.querySelector(':scope > .ce-strip') ?? holder.parentElement?.querySelector(':scope > .ce-strip');
  (strip ?? chromeAnchor(holder)).after(panel);
  const renderPanel = (values = recipe.values, state = recipe.state, derived = recipe.derived, msgs = recipe.msgs) => {
    // Every part, both ways: drag the slider (continuous) or step it with − and + (discrete); a choice is a pair of buttons.
    const items = Object.keys(B01_PARTS).map(k => { const p = B01_PARTS[k], v = values[k];
      const ctl = p.unit === 'choice'
        ? `<span class="cp-ctl">${p.choices.map((c, i) => `<button type="button" data-set="${k}" data-value="${i}" aria-pressed="${Math.round(v) === i}">${c}</button>`).join('')}</span>`
        : `<span class="cp-ctl"><button type="button" data-step="${k}" data-dir="-1" aria-label="${p.label} down">−</button><input type="range" data-part="${k}" min="${p.min}" max="${p.max}" step="${p.unit === 'px' ? 1 : 0.01}" value="${v}" aria-label="${p.label}"><button type="button" data-step="${k}" data-dir="1" aria-label="${p.label} up">+</button></span>`;
      return `<span class="cp-part cp-${state[k]}" data-k="${k}">${p.label} <b>${shown(k, v)}</b> <span class="cp-state">${state[k]}</span>${ctl}</span>`; });
    items.push(`<span class="cp-part cp-derived">Plate height <b>${Math.round(derived.plateH)} px</b> <span class="cp-state">derived</span></span>`);
    items.push(`<span class="cp-part cp-derived">Name size <b>${Math.round(derived.namePx)} px</b> <span class="cp-state">derived</span></span>`);
    panel.innerHTML = `<span class="cp-label">RECIPE</span>${items.join('')}${Object.keys(pinned).length ? '<button type="button" class="cp-reset">Let every part follow the rules</button>' : ''}${(msgs ?? []).map(([, m]) => `<span class="cp-msg">${m}</span>`).join('')}`;
    panel.querySelector('.cp-reset')?.addEventListener('click', () => { begin('Unpin parts'); onChange({ parts: {} }, 'Every part follows the rules again'); });
    const pin = (k, v, how) => { begin(`Pin ${k} (${how})`); onChange({ parts: { ...pinned, [k]: snap(k, v) } }, `Pinned the ${B01_PARTS[k].label.toLowerCase()}`); };
    for (const b of panel.querySelectorAll('[data-step]')) b.addEventListener('click', () => { const k = b.dataset.step; pin(k, values[k] + Number(b.dataset.dir) * B01_PARTS[k].step, 'step'); });
    for (const b of panel.querySelectorAll('[data-set]')) b.addEventListener('click', () => pin(b.dataset.set, Number(b.dataset.value), 'choice'));
    for (const r of panel.querySelectorAll('input[data-part]')) {
      const k = r.dataset.part, chip = r.closest('.cp-part');
      // While the slider moves, the dashed outlines show where every part will go; letting go pins it and the card is redrawn.
      r.addEventListener('input', () => { const { boxes } = preview({ ...pinned, [k]: snap(k, Number(r.value)) }); drawGhosts(boxes); chip.querySelector('b').textContent = shown(k, Number(r.value)); });
      r.addEventListener('change', () => { for (const g of Object.values(ghosts)) g.remove(); pin(k, Number(r.value), 'slider'); });
    }
  };
  renderPanel();

  const handles = recipe.handles.map(h => {
    const el = document.createElement('button'); el.type = 'button'; el.className = `cp-h cp-${h.shape}`; el.title = TITLES[h.id];
    el.setAttribute('aria-label', TITLES[h.id]); el.dataset.part = h.id; parts.appendChild(el); return { h, el };
  });
  const ghosts = { plate: Object.assign(document.createElement('div'), { className: 'cp-ghost' }), disc: Object.assign(document.createElement('div'), { className: 'cp-ghost round' }),
    tiles: Object.assign(document.createElement('div'), { className: 'cp-ghost' }) };
  const tip = Object.assign(document.createElement('div'), { className: 'cp-tip' });
  // The card's content in holder pixels: the name as drawn, the row of tiles and the disc. The name and tile handles sit just past
  // the end of what they size, never on a letter or a digit (Sam's screenshot, 30 Oct: the name handle sat on the S of SERVO).
  const nameSpan = nameWidthFor(name);
  const content = m => {
    const g = recipe.native, dir = recipe.dir, box = (x0, y0, x1, y1) => { const p = toCanvas(Math.min(x0, x1), Math.min(y0, y1)), q = toCanvas(Math.max(x0, x1), Math.max(y0, y1)); return { x: m.x(p.x), y: m.y(p.y), w: (q.x - p.x) * m.s, h: (q.y - p.y) * m.s }; };
    const nw = nameSpan(g.name.px), t = g.tiles, row = 4 * t.size + 3 * t.gap;
    return { name: box(g.name.x, g.name.y - g.name.px * 0.75, g.name.x + dir * nw, g.name.y), tiles: box(t.x, t.y, t.x + dir * row, t.y + t.size),
      disc: box(g.disc.cx - g.disc.d / 2, g.disc.cy - g.disc.d / 2, g.disc.cx + g.disc.d / 2, g.disc.cy + g.disc.d / 2) };
  };
  const shownAt = new Map(); // where each handle is drawn (holder pixels): a drag starts from there
  // avoid: the card editor's own marks (its size knob) in holder pixels, which no handle may touch.
  let lastAvoid = [];
  const place = (avoid = lastAvoid) => {
    lastAvoid = avoid;
    const m = view(), c = content(m), hw = holder.clientWidth, hh = holder.clientHeight, ahead = recipe.dir > 0 ? 'after' : 'before';
    const keep = [c.name, c.tiles];
    for (const { h, el } of handles) {
      if (h.id === 'tile' || h.id === 'name') continue;
      if (h.id === 'plate-edge') {
        // The plate bar stays on the plate's edge but slides along it, up first, until it clears the size knob: with a wide plate the
        // edge runs into the card's corner, where the knob sits (thro.dev/editor, plate 1824 px: bar and knob touched).
        const x = m.x(h.x), y = m.y(h.y), step = el.offsetHeight / 2 + 4, along = [0, -1, -2, -3, 1, 2].map(k => ({ x, y: y + k * step }));
        const b = placeClear(el, along, avoid, hw, hh, 0); shownAt.set(el, { x: b.x + b.w / 2, y: b.y + b.h / 2 }); continue;
      }
      Object.assign(el.style, { left: `${m.x(h.x)}px`, top: `${m.y(h.y)}px` }); shownAt.set(el, { x: m.x(h.x), y: m.y(h.y) });
    }
    for (const id of ['tile', 'name']) {
      const found = handles.find(({ h }) => h.id === id); if (!found) continue;
      const target = id === 'tile' ? c.tiles : c.name, el = found.el;
      const b = placeClear(el, spotsAround(target, el.offsetWidth, el.offsetHeight, [ahead, 'above', 'below'], 6), [...keep, c.disc], hw, hh);
      keep.push(b); shownAt.set(el, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    }
  };
  place();

  // Where every part would be with these pins: the same rules the renderer runs, outlined over the card while dragging.
  const measure = nameWidthFor(name);
  const preview = pins => {
    const s = solveB01(pins, measure), g = s.geometry, mirror = recipe.dir < 0, mx = x => (mirror ? 1920 - x : x);
    const rect = r => { const x0 = mirror ? 1920 - r.x - r.w : r.x, p = toCanvas(x0, r.y), q = toCanvas(x0 + r.w, r.y + r.h); return { x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y }; };
    const disc = (() => { const p = toCanvas(mx(g.disc.cx) - g.disc.d / 2, g.disc.cy - g.disc.d / 2), q = toCanvas(mx(g.disc.cx) + g.disc.d / 2, g.disc.cy + g.disc.d / 2); return { x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y }; })();
    const t = g.tiles, row = { x: t.x, y: t.y, w: 4 * t.size + 3 * t.gap, h: t.size };
    return { solved: s, boxes: { plate: rect(g.plate), disc, tiles: rect(row) } };
  };
  const drawGhosts = boxes => { const m = view(); for (const [k, box] of Object.entries(boxes)) { const el = ghosts[k]; if (!el.isConnected) parts.appendChild(el); Object.assign(el.style, { left: `${m.x(box.x)}px`, top: `${m.y(box.y)}px`, width: `${box.w * m.s}px`, height: `${box.h * m.s}px` }); } };

  for (const { h, el } of handles) {
    el.addEventListener('pointerdown', ev => {
      if (ev.button > 0) return; ev.preventDefault(); ev.stopPropagation();
      const id = ev.pointerId, x0 = ev.clientX, y0 = ev.clientY, m = view(), k = recipe.k * m.s, landed = ev.timeStamp, from = shownAt.get(el) ?? { x: m.x(h.x), y: m.y(h.y) };
      try { el.setPointerCapture(id); } catch { /* capture is a nicety */ }
      let next = null; layer.classList.add('is-dragging'); parts.appendChild(tip);
      const move = mv => {
        if (mv.pointerId !== id) return;
        const dx = (mv.clientX - x0) / k, dy = (mv.clientY - y0) / k;
        next = { ...pinned, ...pinFor(h.id, recipe, dx, dy) };
        Object.assign(el.style, { left: `${from.x + mv.clientX - x0}px`, top: `${from.y + mv.clientY - y0}px` });
        const { solved, boxes } = preview(next); drawGhosts(boxes); renderPanel(solved.values, solved.state, solved.derived, solved.msgs);
        const changed = Object.keys(pinFor(h.id, recipe, 0, 0)).map(p => `${B01_PARTS[p].label} ${shown(p, next[p])}`).join(' · ');
        tip.textContent = changed; Object.assign(tip.style, { left: el.style.left, top: el.style.top });
      };
      const up = u => {
        if (u.pointerId !== id) return;
        removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true);
        layer.classList.remove('is-dragging'); tip.remove(); for (const g of Object.values(ghosts)) g.remove();
        const same = next && Object.keys(next).length === Object.keys(pinned).length && Object.entries(next).every(([p, v]) => pinned[p] === v);
        if (!next || u.type === 'pointercancel' || same) { place(); renderPanel(); if (next && !same) return; return; }
        begin(`Pin ${h.id}`, landed);
        const what = Object.keys(pinFor(h.id, recipe, 0, 0)).map(p => B01_PARTS[p].label.toLowerCase()).join(' and ');
        onChange({ parts: next }, `Pinned the ${what}`);
      };
      addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
    });
    // Keys too: arrows move a handle by 8 native pixels (shift: 40).
    el.addEventListener('keydown', ev => {
      const step = ev.shiftKey ? 40 : 8, dd = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (!dd) return; ev.preventDefault(); ev.stopPropagation();
      begin(`Pin ${h.id} (keys)`); onChange({ parts: { ...pinned, ...pinFor(h.id, recipe, dd[0], dd[1]) } }, 'Part pinned');
    });
  }
  void settle;
  // The boxes the controls must keep clear of (the card editor's Side and Colour badges): the content and the handles as drawn.
  const occupied = () => { const m = view(), c = content(m), o = holder.getBoundingClientRect();
    return [c.name, c.tiles, ...handles.map(({ el }) => { const r = el.getBoundingClientRect(); return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }; })]; };
  return { place, occupied, detach: () => { parts.remove(); panel.remove(); } };
}
