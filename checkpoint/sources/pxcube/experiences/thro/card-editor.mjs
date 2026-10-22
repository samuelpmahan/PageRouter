// On-card editing for Thro Single cards: the Constraint Lab, merged into Thro.
// Drag the card to move it from its corner, pull the knob to size it, tap Side, Colour or Plate.
// Every gesture becomes one of the card renderer's own inputs (nudge, scale, discSide,
// highlightTarget, plate). Nothing here draws the card: the preview only moves the
// existing pixels while a finger is down, and the renderer redraws on release.
const STYLE = `
.card-editor{position:absolute;inset:0;pointer-events:none;z-index:2}
.card-editor .ce-card{position:absolute;pointer-events:auto;cursor:grab;touch-action:none;border:1.5px dashed #ffffffa6;border-radius:4px;outline-offset:3px}
.card-editor .ce-card:active{cursor:grabbing}
.card-editor .ce-card:focus-visible{outline:3px solid var(--accent,#b5d899)}
.card-editor .ce-ghost{position:absolute;border:2px solid #fff;border-radius:4px;background:#ffffff14;pointer-events:none}
.card-editor .ce-badge{position:absolute;pointer-events:auto;transform:translate(-50%,-50%);min-height:30px;min-width:30px;height:30px;padding:0 10px;border-radius:15px;border:2px solid #fff;background:#0b100ddb;color:#fff;font:700 12px/26px system-ui,sans-serif;white-space:nowrap;cursor:pointer;touch-action:manipulation;box-shadow:0 2px 8px #0007}
.card-editor .ce-badge:hover:not(:disabled){background:#000;border-color:#fff}
.card-editor .ce-badge.ce-right{transform:translate(6px,-50%)}
.card-editor .ce-knob{position:absolute;pointer-events:auto;width:32px;height:32px;min-height:32px;min-width:32px;margin:-16px 0 0 -16px;padding:0;border-radius:50%;border:3px solid #fff;background:#e2402f;color:#fff;font:700 14px/1 system-ui,sans-serif;touch-action:none;cursor:nwse-resize;box-shadow:0 2px 8px #0007}
.card-editor.is-dragging .ce-badge,.card-editor.is-dragging .ce-knob{visibility:hidden}
`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const union = boxes => {
  const list = boxes.filter(b => b && Number.isFinite(b.x) && b.w > 0 && b.h > 0);
  if (!list.length) return null;
  const x = Math.min(...list.map(b => b.x)), y = Math.min(...list.map(b => b.y));
  return { x, y, w: Math.max(...list.map(b => b.x + b.w)) - x, h: Math.max(...list.map(b => b.y + b.h)) - y };
};

/** Attach the editor to a Single preview that shows a native card. Returns a detach function.
 *  layout: the boxes the renderer reported for this exact card (canvas pixels).
 *  bounds: the card's visible pixels, plate included (canvas pixels), when known.
 *  onChange(controls, note): controls are { nudge } | { scale } | { side } | { highlight } | { plate }. */
export function attachCardEditor(holder, { graphic, layout, bounds = null, design, onChange }) {
  holder.querySelector(':scope > .card-editor')?.remove();
  const svg = holder.querySelector(':scope > svg');
  const card = union([bounds, layout?.photo, layout?.name, layout?.numbers, ...(layout?.other ?? [])]);
  if (!svg || !card || !layout.photo) return () => {};
  if (!document.getElementById('card-editor-style')) { const s = document.createElement('style'); s.id = 'card-editor-style'; s.textContent = STYLE; document.head.appendChild(s); }
  const W = graphic.width, H = graphic.height, scale0 = design.nativeScale ?? 0.66, nudge0 = design.nativeNudge ?? { x: 0, y: 0 };
  const layer = document.createElement('div'); layer.className = 'card-editor'; holder.appendChild(layer);
  const el = (tag, cls, attrs = {}) => { const e = document.createElement(tag); e.className = cls; Object.assign(e, attrs); layer.appendChild(e); return e; };

  // Canvas pixels to holder pixels, through the preview's own crop (viewBox) and CSS framing.
  const view = () => {
    const vb = svg.viewBox?.baseVal, v = vb && vb.width ? vb : { x: 0, y: 0, width: W, height: H };
    const r = svg.getBoundingClientRect(), h = holder.getBoundingClientRect(), s = Math.min(r.width / v.width, r.height / v.height);
    const ox = r.left - h.left + (r.width - v.width * s) / 2, oy = r.top - h.top + (r.height - v.height * s) / 2;
    return { s, x: x => ox + (x - v.x) * s, y: y => oy + (y - v.y) * s };
  };
  const put = (e, b, m) => Object.assign(e.style, { left: `${m.x(b.x)}px`, top: `${m.y(b.y)}px`, width: `${b.w * m.s}px`, height: `${b.h * m.s}px` });
  const at = (e, x, y, m, maxX, maxY) => Object.assign(e.style, { left: `${clamp(m.x(x), 18, maxX - 18)}px`, top: `${clamp(m.y(y), 16, maxY - 16)}px` });

  const box = el('div', 'ce-card', { tabIndex: 0, title: 'Drag to move the card. Arrow keys nudge it.' });
  box.setAttribute('role', 'button'); box.setAttribute('aria-label', 'Card position: drag, or use the arrow keys');
  // The knob sits on the corner away from the frame edges the card hugs; that corner stays put while sizing.
  const hugLeft = card.x < W - (card.x + card.w), hugTop = card.y < H - (card.y + card.h);
  const anchor = { x: hugLeft ? card.x : card.x + card.w, y: hugTop ? card.y : card.y + card.h };
  const corner = { x: hugLeft ? card.x + card.w : card.x, y: hugTop ? card.y + card.h : card.y };
  const knob = el('button', 'ce-knob', { type: 'button', textContent: '⤡', title: 'Drag to size the card' });
  knob.setAttribute('aria-label', `Card size ${Math.round(scale0 * 100)}%: drag to change`);
  const side = design.nativeSide, other = side === 'left' ? 'right' : 'left';
  const badges = [
    ['⇄ Side', 'Put the disc on the other side', layout.photo, 'c', () => onChange({ side: other }, `Disc on the ${other}`)],
    ['# Colour', 'Accent on the tiles or the digits', layout.numbers, 'right', () => onChange({ highlight: design.nativeHighlight === 'tiles' ? 'digits' : 'tiles' }, design.nativeHighlight === 'tiles' ? 'Accent on the digits' : 'Accent on the tiles')],
    ['Plate', 'Solid or see-through plate', layout.name, 'corner', () => onChange({ plate: design.nativePlate === 'solid' ? 'see-through' : 'solid' }, design.nativePlate === 'solid' ? 'See-through plate' : 'Solid plate')],
  ].filter(([, , target]) => target).map(([label, aria, target, where, act]) => {
    const b = el('button', `ce-badge${where === 'right' ? ' ce-right' : ''}`, { type: 'button', textContent: label, title: aria }); b.setAttribute('aria-label', aria);
    b.addEventListener('pointerdown', e => e.stopPropagation()); b.addEventListener('click', e => { e.stopPropagation(); act(); });
    return { b, target, where };
  });
  function place() {
    if (!layer.isConnected) return stop();
    const m = view(), hw = holder.clientWidth, hh = holder.clientHeight;
    put(box, card, m); at(knob, corner.x, corner.y, m, hw, hh);
    for (const { b, target: t, where } of badges) {
      const awayFromDisc = layout.photo.x + layout.photo.w / 2 > t.x + t.w / 2;
      // Colour sits just past the end of the numbers row, so a sticky bar under the preview never hides it.
      if (where === 'right') { Object.assign(b.style, { left: `${Math.min(m.x(t.x + t.w), hw - b.offsetWidth - 10)}px`, top: `${clamp(m.y(t.y + t.h / 2), 16, hh - 16)}px` }); continue; }
      const x = where === 'c' ? t.x + t.w / 2 : awayFromDisc ? t.x : t.x + t.w, y = where === 'c' ? t.y + t.h / 2 : t.y;
      at(b, x, y, m, hw, hh);
    }
  }
  const resize = new ResizeObserver(place), watch = new MutationObserver(place);
  resize.observe(holder); watch.observe(svg, { attributes: true, attributeFilter: ['viewBox', 'style', 'class'] });
  function stop() { resize.disconnect(); watch.disconnect(); }
  place();

  function track(target, e, move, up) {
    if (e.button > 0) return;
    e.preventDefault();
    const id = e.pointerId, x0 = e.clientX, y0 = e.clientY; let moved = false;
    try { target.setPointerCapture(id); } catch { /* capture is a nicety */ }
    const mv = ev => { if (ev.pointerId !== id) return; const dx = ev.clientX - x0, dy = ev.clientY - y0; if (!moved && Math.hypot(dx, dy) < 6) return; if (!moved) layer.classList.add('is-dragging'); moved = true; move(dx, dy); };
    const end = ev => { if (ev.pointerId !== id) return; removeEventListener('pointermove', mv, true); removeEventListener('pointerup', end, true); removeEventListener('pointercancel', end, true); layer.classList.remove('is-dragging'); up(moved, ev.type === 'pointercancel'); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true);
  }
  // Move: the card's pixels follow the finger; on release the nudge goes to the renderer.
  const commitNudge = (dx, dy) => {
    // keep the card inside the frame; a nudge within 32 px of the corner snaps back to it
    const x = clamp(card.x + dx, 0, W - card.w) - card.x, y = clamp(card.y + dy, 0, H - card.h) - card.y;
    const next = { x: Math.round(nudge0.x + x), y: Math.round(nudge0.y + y) }, home = Math.hypot(next.x, next.y) < 32;
    onChange({ nudge: home ? { x: 0, y: 0 } : next }, home ? 'Back in its corner' : 'Card moved');
  };
  box.addEventListener('pointerdown', e => {
    const m = view(); let dx = 0, dy = 0;
    track(box, e, (x, y) => { dx = x; dy = y; svg.style.translate = `${x}px ${y}px`; box.style.translate = `${x}px ${y}px`; },
      (moved, cancelled) => { svg.style.translate = ''; box.style.translate = ''; if (moved && !cancelled) commitNudge(dx / m.s, dy / m.s); });
  });
  box.addEventListener('keydown', e => {
    const step = e.shiftKey ? 40 : 8, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return; e.preventDefault(); commitNudge(d[0], d[1]);
  });
  // Size: a ghost shows the new size from the corner the card hugs; on release the scale goes to the renderer.
  knob.addEventListener('pointerdown', e => {
    const m = view(), ax = m.x(anchor.x), ay = m.y(anchor.y), kx = m.x(corner.x), ky = m.y(corner.y), d0 = Math.hypot(kx - ax, ky - ay) || 1;
    let next = scale0; const ghost = el('div', 'ce-ghost');
    const draw = s => { const k = s / scale0, x1 = ax + (kx - ax) * k, y1 = ay + (ky - ay) * k;
      Object.assign(ghost.style, { left: `${Math.min(ax, x1)}px`, top: `${Math.min(ay, y1)}px`, width: `${Math.abs(x1 - ax)}px`, height: `${Math.abs(y1 - ay)}px` });
      Object.assign(knob.style, { left: `${x1}px`, top: `${y1}px`, visibility: 'visible' }); knob.textContent = `${Math.round(s * 100)}`; };
    draw(scale0);
    track(knob, e, (dx, dy) => { next = Math.round(clamp(scale0 * Math.hypot(kx + dx - ax, ky + dy - ay) / d0, 0.5, 1.5) * 100) / 100; draw(next); },
      (moved, cancelled) => { ghost.remove(); knob.textContent = '⤡'; place(); if (moved && !cancelled && next !== scale0) onChange({ scale: next }, `Card at ${Math.round(next * 100)}%`); });
  });
  return () => { stop(); layer.remove(); };
}
