// Reading-order handles on the card itself (Sam, 22 Oct, 23:27: "the red handles each indicating its usage intuitively by its
// location and shape"; "convivial is not the computer telling you what you're allowed to do").
// Beside each measured part of the card on screen (disc photo, mold name, flight numbers, the largest other text) sit two marks:
//   a small grey square: the order this card is actually read in, by measured size (a plain fact, like a ruler);
//   a gold handle: the person's own order (gold, not red: the card editor's red knob already means resize). Drag a handle onto another part to swap them, or use the arrow keys.
// No prompts, no suggestions, no verdicts on the card. The DTree's demonstration re-derives from the person's order.
// Boxes are the renderer's measurements in frame pixels, mapped through the preview SVG's screen transform,
// so they sit right in Close-up and Whole frame alike.
import { PARTS, measuredOrder, readingOf } from './thro-world.mjs';
import { viewer, swapParts } from './viewer.mjs';

const css = `
.rh-toggle{position:absolute;z-index:57;min-width:44px;height:32px;padding:0 9px;border-radius:16px;border:1px solid #ffffff55;background:#101812d9;color:#fff;font:800 12px/1 system-ui,sans-serif;letter-spacing:.06em;cursor:pointer;display:flex;align-items:center;gap:3px}
.rh-toggle.rh-toggle[aria-pressed="true"]{background:#ffd166!important;border-color:#ffd166!important;color:#1d1600!important}.rh-toggle[aria-pressed="true"] i{background:#1d160022}
.rh-toggle i{font-style:normal;display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#ffffff26;font-size:10px}
.rh-layer{position:absolute;z-index:56;overflow:hidden;pointer-events:none}
.rh-part{position:absolute;border:1.5px dashed #ffffffb3;border-radius:6px;box-shadow:0 0 0 1px #0006}
.rh-part.drop{border-color:#ffd166;border-style:solid;background:#ffd16626}
.rh-marks{position:absolute;right:calc(100% + 4px);top:50%;transform:translateY(-50%);flex-direction:row-reverse;display:flex;align-items:center;gap:4px;pointer-events:none}
.rh-part.rh-right .rh-marks{right:auto;left:calc(100% + 4px);flex-direction:row}
.rh-fact{display:grid;place-items:center;min-width:20px;height:20px;padding:0 3px;border-radius:5px;background:#2b2f2c;color:#d8ddd9;font:700 12px/1 system-ui,sans-serif;box-shadow:0 1px 3px #0008}
.rh-handle{pointer-events:auto;touch-action:none;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#ffd166;color:#1d1600;border:2px solid #1d1600;font:800 15px/1 system-ui,sans-serif;box-shadow:0 2px 8px #000a;cursor:grab;user-select:none}
.rh-handle:focus-visible{outline:3px solid #ffd166;outline-offset:2px}
.rh-ghost{position:fixed;z-index:80;pointer-events:none;transform:translate(-50%,-50%) scale(1.15)}
`;
const KEY = 'thro-handles';
let on = false, dragging = false; try { on = localStorage.getItem(KEY) === 'on'; } catch { /* default off */ }

async function start() {
  for (let i = 0; i < 100 && !window.__thro; i++) await new Promise(r => setTimeout(r, 100));
  if (!window.__thro) return;
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  const toggle = Object.assign(document.createElement('button'), { type: 'button', className: 'rh-toggle' });
  toggle.innerHTML = '<i>1</i><i>2</i><i>3</i>'; toggle.setAttribute('aria-label', 'Reading order on the card');
  const layer = Object.assign(document.createElement('div'), { className: 'rh-layer' });
  document.body.append(layer, toggle);
  toggle.onclick = () => { on = !on; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* per page */ } draw(); };

  // The parts of each card on screen, with their measured boxes and reading (one card for Single, one per disc for a lineup).
  function cards() {
    const sc = window.__thro.screen; if (!sc || sc.error) return [];
    const inputs = sc.receipt.inputValues ?? {}, recipe = sc.outputs.recipe;
    const list = recipe.cards ? recipe.cards.map((c, i) => [inputs.layouts?.[i], c]) : [[inputs.layout, recipe]];
    return list.filter(([layout]) => layout).map(([layout, c]) => {
      const reading = readingOf(layout, c.disc?.name, c.flights);
      const biggest = (layout.other ?? []).reduce((best, item) => (item.size > (best?.size ?? 0) ? item : best), null);
      const boxes = { disc: layout.photo, name: layout.name, numbers: layout.numbers, other: biggest };
      return { reading, boxes, measured: measuredOrder(reading) };
    });
  }
  function draw() {
    if (dragging) return; // never pull the handle out from under a finger
    toggle.setAttribute('aria-pressed', String(on));
    const preview = document.getElementById('graphic-preview'), svg = preview?.querySelector('svg');
    const sc = window.__thro.screen, usable = Boolean(svg && sc && !sc.error);
    toggle.hidden = !usable; layer.hidden = !usable || !on; layer.innerHTML = '';
    if (!usable) return;
    const r = preview.getBoundingClientRect();
    // Top-left of the preview: the card editor's resize knob lives at the card's top-right.
    Object.assign(toggle.style, { left: `${r.left + scrollX + 8}px`, top: `${r.top + scrollY + 8}px` });
    if (!on) return;
    Object.assign(layer.style, { left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px` });
    const ctm = svg.getScreenCTM(); if (!ctm) return;
    const toLayer = (x, y) => { const p = new DOMPoint(x, y).matrixTransform(ctm); return { x: p.x - r.left, y: p.y - r.top }; };
    const intended = viewer().order ?? [...PARTS];
    cards().forEach((card, c) => {
      for (const part of PARTS) {
        const box = card.boxes[part]; if (!box) continue;
        const a = toLayer(box.x, box.y), b = toLayer(box.x + box.w, box.y + box.h);
        const el = document.createElement('div'); el.className = `rh-part${a.x < 64 ? ' rh-right' : ''}`; el.dataset.part = part; el.dataset.card = String(c); // no room on the left: marks go right
        Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${Math.max(8, b.x - a.x)}px`, height: `${Math.max(8, b.y - a.y)}px` });
        const fact = card.measured.indexOf(part) + 1, mine = intended.indexOf(part) + 1;
        el.innerHTML = `<div class="rh-marks"><span class="rh-fact" title="Read ${fact}${['st', 'nd', 'rd', 'th'][Math.min(fact, 4) - 1]} (measured)">${fact}</span><span class="rh-handle" role="button" tabindex="0" data-handle="${part}" aria-label="Your order ${mine}: ${part}. Drag onto another part, or use the arrow keys.">${mine}</span></div>`;
        layer.append(el);
      }
    });
    layer.querySelectorAll('[data-handle]').forEach(bindHandle);
  }
  function bindHandle(handle) {
    const part = handle.dataset.handle;
    handle.addEventListener('keydown', e => {
      const order = viewer().order ?? [...PARTS], i = order.indexOf(part), j = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : -1;
      if (j < 0 || j >= order.length) return;
      e.preventDefault(); swapParts(part, order[j]); requestAnimationFrame(() => layer.querySelector(`[data-handle="${part}"]`)?.focus());
    });
    handle.addEventListener('pointerdown', e => {
      e.preventDefault(); dragging = true;
      const ghost = handle.cloneNode(true); ghost.className = 'rh-handle rh-ghost'; document.body.append(ghost);
      const move = ev => { Object.assign(ghost.style, { left: `${ev.clientX}px`, top: `${ev.clientY}px` }); layer.querySelectorAll('.rh-part').forEach(p => p.classList.toggle('drop', p === target(ev) && p.dataset.part !== part)); };
      const target = ev => { const rects = [...layer.querySelectorAll('.rh-part')]; return rects.find(p => { const b = p.getBoundingClientRect(); return ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom; }) ?? null; };
      move(e);
      const up = ev => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); ghost.remove(); dragging = false;
        const onto = ev.type === 'pointerup' ? target(ev) : null;
        if (onto && onto.dataset.part !== part) swapParts(part, onto.dataset.part); else draw();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
  }
  let queued = false; const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };
  addEventListener('thro:screen', soon); addEventListener('thro:viewer', soon); addEventListener('resize', soon);
  // The app repaints the preview (framing, background, layout) without a screen run: follow the SVG, not the event.
  const ours = n => n.nodeType !== 1 || n === layer || n === toggle || n.classList?.contains('rh-ghost') || n.classList?.contains('dtree-toast') || n.classList?.contains('dtree-lit');
  const relevant = m => !layer.contains(m.target) && m.target !== toggle && (m.attributeName === 'viewBox' || (m.type === 'childList' && ![...m.addedNodes, ...m.removedNodes].every(ours)));
  new MutationObserver(records => { if (records.some(relevant)) soon(); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['viewBox'] });
  window.__handles = { draw, toggle: v => { on = v ?? !on; draw(); }, state: () => ({ on, parts: [...layer.querySelectorAll('.rh-part')].map(p => ({ part: p.dataset.part, card: Number(p.dataset.card), fact: Number(p.querySelector('.rh-fact').textContent), mine: Number(p.querySelector('.rh-handle').textContent), box: p.getBoundingClientRect().toJSON() })) }) };
  draw();
}
start();
