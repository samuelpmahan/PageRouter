// On-card editing for Thro Single cards: the Constraint Lab, merged into Thro.
// Drag the card to move it from its corner, pull the knob to size it, tap Side, Colour or Plate on the card next to what each one changes; a hover or a press and hold says how it is set and what a tap does
// (the first Constraint Lab, f75a060; Sam, 23 Oct: "immediate sensorimotor feedback is just as important to ground symbols for
// humans as it is for agents"). The strip under the preview groups the same controls and names their state; each strip control
// and its badge on the card are one action, and pointing at either outlines the piece it changes and lights its twin.
// Every gesture becomes one of the card renderer's own inputs (nudge, scale, discSide,
// highlightTarget, plate). The plate is see-through by default, as it always was, and one tap makes it dark (Sam, 31 Oct: "Keep
// see-through"; 30 Oct: "make it simple to make the plate dark"). Pointing at a control opens a small bubble saying how it is set
// now and what a tap does; on a touch screen a press and hold (half a second) opens it without acting (Sam, 30 Oct: "you should be
// able to hover it and it shows the state"). Nothing here draws the card: the preview only moves the
// existing pixels while a finger is down, and the renderer redraws on release.
const STYLE = `
.card-editor{position:absolute;inset:0;pointer-events:none;z-index:2}
.card-editor .ce-card{position:absolute;pointer-events:auto;cursor:grab;touch-action:none;border:1.5px dashed #ffffffa6;border-radius:4px;outline-offset:3px}
.card-editor .ce-card:active{cursor:grabbing}
.card-editor .ce-card:focus-visible{outline:3px solid var(--accent,#b5d899)}
.card-editor .ce-ghost{position:absolute;border:2px solid #fff;border-radius:4px;background:#ffffff14;pointer-events:none}
.ce-strip{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;border-top:1px solid #3a493b;background:#1b261e}
.ce-strip .ce-label{font-size:10px;letter-spacing:1.2px;color:#9fb19a;font-weight:700;margin-right:2px}
.ce-strip .ce-act{min-height:36px;padding:6px 12px;border-radius:18px;font-size:12px;font-weight:650;border:1px solid #5a6f55;background:#243026;color:#eef3ea;white-space:nowrap}
.ce-strip .ce-act b{color:var(--accent,#b5d899);font-weight:700}
.card-editor .ce-hint{position:absolute;border:2px solid var(--accent,#b5d899);border-radius:6px;box-shadow:0 0 0 2px #0009;pointer-events:none;display:none}
.card-editor .ce-hint.round{border-radius:50%}
.card-editor .ce-hint.on{display:block}
.card-editor .ce-badge{position:absolute;pointer-events:auto;transform:translate(-50%,-50%);min-height:30px;min-width:30px;height:30px;padding:0 10px;border-radius:15px;border:2px solid #fff;background:#0b100ddb;color:#fff;font:700 12px/26px system-ui,sans-serif;white-space:nowrap;cursor:pointer;touch-action:manipulation;box-shadow:0 2px 8px #0007}
.card-editor .ce-badge:hover:not(:disabled),.card-editor .ce-badge.lit{background:#000;border-color:var(--accent,#b5d899)}
.card-editor .ce-badge{-webkit-touch-callout:none;user-select:none;-webkit-user-select:none}
.card-editor .ce-tip{position:absolute;z-index:3;max-width:240px;padding:7px 10px;border-radius:8px;background:#0b100d;color:#eef3ea;border:1px solid var(--accent,#b5d899);font:500 12px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px #000a;pointer-events:none;transform:translate(-50%,calc(-100% - 22px));display:none;white-space:normal;width:max-content}
.card-editor .ce-tip b{color:var(--accent,#b5d899);font-weight:700}
.card-editor .ce-tip.on{display:block}
.card-editor .ce-tip.ce-under{transform:translate(-50%,22px)}
.card-editor .ce-badge.ce-pressed,.ce-strip .ce-act.ce-pressed{background:var(--accent,#b5d899);border-color:#fff;color:#0b100d}
.ce-strip .ce-act.lit{border-color:var(--accent,#b5d899);background:#2c3a2e}
@media (pointer:coarse){.card-editor .ce-badge{min-height:40px;height:40px;line-height:36px;border-radius:20px;padding:0 12px}}
.card-editor .ce-knob{position:absolute;pointer-events:auto;width:32px;height:32px;min-height:32px;min-width:32px;margin:-16px 0 0 -16px;padding:0;border-radius:50%;border:3px solid #fff;background:#e2402f;color:#fff;font:700 14px/1 system-ui,sans-serif;touch-action:none;cursor:nwse-resize;box-shadow:0 2px 8px #0007}
.card-editor.is-dragging .ce-knob,.card-editor.is-dragging .ce-badge,.card-editor.is-dragging .ce-tip{visibility:hidden}
.ce-strip .ce-tap-hint{display:none;flex-basis:100%;font-size:11px;line-height:1.4;color:#b8c6a6}
/* On a phone the card's own marks (the size knob, the five red handles, the Side, Colour and Plate badges) would sit on the flight numbers, so they stay
   away until the card is tapped; the strip under the card has the same three actions all along. Tap the card again to put them away. */
@media (max-width:760px){
  .card-editor:not(.ce-armed) .ce-knob,.card-editor:not(.ce-armed) .ce-badge,.card-editor:not(.ce-armed) .ce-hint,.card-editor:not(.ce-armed) .card-parts{display:none}
  .ce-strip .ce-tap-hint{display:block}
}
`;
import { begin, settle } from './gestures.mjs';
import { attachCardParts } from './card-parts.mjs';
import { onPhone, chromeAnchor, clearChrome, placeClear, spotsAround } from './editor-place.mjs';
let armed = false; // phone: the card's marks are shown after a tap on the card (see STYLE); kept across redraws
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
 *  onChange(controls, note): controls are { nudge } | { scale } | { side } | { highlight } | { plate } | { revision }. */
export function attachCardEditor(holder, { graphic, layout, bounds = null, design, fixedRevision, onChange }) {
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
    // Where the preview sits without the drag's own offset (the box and badges carry that offset themselves).
    const [tx = 0, ty = 0] = (svg.style.translate || '').split(' ').map(parseFloat).map(n => (Number.isFinite(n) ? n : 0));
    const ox = r.left - tx - h.left + (r.width - v.width * s) / 2, oy = r.top - ty - h.top + (r.height - v.height * s) / 2;
    return { s, x: x => ox + (x - v.x) * s, y: y => oy + (y - v.y) * s };
  };
  const put = (e, b, m) => Object.assign(e.style, { left: `${m.x(b.x)}px`, top: `${m.y(b.y)}px`, width: `${b.w * m.s}px`, height: `${b.h * m.s}px` });
  const at = (e, x, y, m, maxX, maxY) => Object.assign(e.style, { left: `${clamp(m.x(x), 18, maxX - 18)}px`, top: `${clamp(m.y(y), 16, maxY - 16)}px` });

  layer.classList.toggle('ce-armed', armed);
  const box = el('div', 'ce-card', { tabIndex: 0, title: 'Drag to move the card. Arrow keys nudge it.' });
  box.setAttribute('role', 'button'); box.setAttribute('aria-label', 'Card position: drag, or use the arrow keys');
  // The knob sits on the corner away from the frame edges the card hugs; that corner stays put while sizing.
  const hugLeft = card.x < W - (card.x + card.w), hugTop = card.y < H - (card.y + card.h);
  const anchor = { x: hugLeft ? card.x : card.x + card.w, y: hugTop ? card.y : card.y + card.h };
  const corner = { x: hugLeft ? card.x + card.w : card.x, y: hugTop ? card.y + card.h : card.y };
  const knob = el('button', 'ce-knob', { type: 'button', textContent: '⤡', title: 'Drag to size the card' });
  knob.setAttribute('aria-label', `Card size ${Math.round(scale0 * 100)}%: drag to change`);
  const side = design.nativeSide, other = side === 'left' ? 'right' : 'left', tiles = design.nativeHighlight === 'tiles', dark = design.nativePlate === 'solid';
  // The strip names each control's current state; hovering or focusing one outlines the piece it changes.
  clearChrome(holder);
  const strip = document.createElement('div'); strip.className = 'ce-strip'; strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'Card controls');
  strip.innerHTML = '<span class="ce-label">ON THE CARD</span>';
  const tapHint = document.createElement('span'); tapHint.className = 'ce-tap-hint';
  const hintText = () => { tapHint.textContent = armed ? 'Handles are on the card. Drag one, or tap the card again to put them away.' : 'Tap the card to show its handles for moving and sizing.'; };
  hintText(); strip.appendChild(tapHint);
  chromeAnchor(holder).after(strip);
  // One record per control: what it is, how it is set now and what a tap does. The badge, its bubble, the strip button and the
  // screen reader's name are all written from it, so they cannot disagree. Each badge sits beside what it changes, on the first
  // spot that covers none of the card's content or the other controls (Sam, 30 Oct: the badges sat on the S of SERVO, on the tiles
  // and off the plate's edge): Side beside the disc, away from the plate first; Colour just past the end of the numbers row; Plate
  // under the plate's corner away from the disc.
  const actions = [
    { what: 'Disc', now: `on the ${side}`, tap: `put it on the ${other}`, label: '⇄ Side', target: layout.photo, round: true,
      act: () => onChange({ side: other }, `Disc on the ${other}`), where: 'disc' },
    { what: 'Colour', now: `on the ${tiles ? 'tiles' : 'digits'}`, tap: `put it on the ${tiles ? 'digits' : 'tiles'}`, label: '# Colour', target: layout.numbers,
      act: () => onChange({ highlight: tiles ? 'digits' : 'tiles' }, tiles ? 'Colour on the digits' : 'Colour on the tiles'), where: 'row' },
    // The dark plate is the renderer's own solid plate (appearance.plate 'solid'), so a saved package reads as it always did.
    { what: 'Plate', now: dark ? 'dark' : 'see-through', tap: dark ? 'let the video show through it' : 'make it dark', label: dark ? 'See-through plate' : '◐ Dark plate', target: bounds ?? card,
      act: () => onChange({ plate: dark ? 'see-through' : 'solid' }, dark ? 'See-through plate' : 'Dark plate'), where: 'plate' },
  ];
  // A saved card keeps the drawing it was made with; moving it to the fixed card is a person's choice.
  if (fixedRevision !== undefined && design.nativeRevision !== fixedRevision) {
    actions.push({ what: 'Drawing', now: 'the one this card was saved with', tap: `use the fixed card: half numbers as a small raised .5${String(design.study).endsWith(':b01') ? ', disc drawn upright' : ''}`,
      label: '✦ Fixed card', target: layout.numbers ?? card, act: () => onChange({ revision: fixedRevision }, 'Fixed card applied'), where: 'row' });
  }
  const touch = matchMedia('(pointer:coarse)').matches, verb = touch ? 'Tap' : 'Click';
  const controls = actions.filter(a => a.target).map(({ what, now, tap, label, target, round, act, where }) => {
    const sentence = `${what}: ${now}. ${verb} to ${tap}.`, stateful = () => [`${what}: `, Object.assign(document.createElement('b'), { textContent: now })];
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ce-act'; b.title = sentence; b.setAttribute('aria-label', sentence);
    b.append(...stateful());
    const hint = el('div', `ce-hint${round ? ' round' : ''}`);
    // The same action, on the card where it acts, with a bubble that says how it is set and what a tap does.
    const badge = el('button', 'ce-badge', { type: 'button', textContent: label }); badge.setAttribute('aria-label', sentence);
    const tip = el('div', 'ce-tip'); tip.setAttribute('role', 'tooltip'); tip.id = `ce-tip-${what.toLowerCase()}`; badge.setAttribute('aria-describedby', tip.id);
    tip.append(...stateful(), `. ${verb} to ${tap}.`);
    const placeTip = () => {
      const bb = badge.getBoundingClientRect(), hb = holder.getBoundingClientRect(), half = Math.min(tip.offsetWidth, holder.clientWidth - 8) / 2;
      // Over its badge when there is room, else under it: the bubble never covers the badge it describes.
      const under = bb.top - hb.top < tip.offsetHeight + 26; tip.classList.toggle('ce-under', under);
      Object.assign(tip.style, { left: `${clamp(bb.left + bb.width / 2 - hb.left, half + 4, holder.clientWidth - half - 4)}px`, top: `${under ? bb.bottom - hb.top : bb.top - hb.top}px` });
    };
    const show = on => { hint.classList.toggle('on', on); badge.classList.toggle('lit', on); b.classList.toggle('lit', on); tip.classList.toggle('on', on); if (on) placeTip(); };
    // Mouse: the bubble opens on hover. Keyboard: on focus. A phone's tap focuses too, and that is no ask for the bubble.
    for (const t of [b, badge]) {
      t.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(true); }); t.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') show(false); });
      t.addEventListener('focus', () => { if (t.matches(':focus-visible')) show(true); }); t.addEventListener('blur', () => show(false));
    }
    // Touch: press and hold for half a second opens the bubble and keeps that press from acting; a quick tap still acts at once.
    // The gesture starts when the finger lands (pointerdown), not when the click is delivered after it lifts.
    let landed = null, held = false, timer = 0, hide = 0;
    for (const t of [b, badge]) {
      t.addEventListener('contextmenu', e => e.preventDefault());
      t.addEventListener('pointerdown', e => {
        landed = e.timeStamp; held = false; if (t === badge) e.stopPropagation();
        if (e.pointerType !== 'mouse') { clearTimeout(timer); timer = setTimeout(() => { held = true; clearTimeout(hide); show(true); hide = setTimeout(() => show(false), 2500); }, 500); }
      });
      for (const end of ['pointerup', 'pointercancel', 'pointerleave']) t.addEventListener(end, () => clearTimeout(timer));
    }
    // Pressed at once, in the same frame as the tap; the new card replaces the whole layer when it is drawn.
    const go = e => { e.stopPropagation(); if (held) { held = false; landed = null; return; } begin(label, landed ?? e.timeStamp); landed = null; badge.classList.add('ce-pressed'); b.classList.add('ce-pressed'); act(); };
    badge.addEventListener('click', go); b.addEventListener('click', go); strip.appendChild(b);
    return { hint, target, badge, where, tip, placeTip };
  });
  let partsUI = null;
  function place() {
    if (!layer.isConnected) return stop();
    const m = view(), hw = holder.clientWidth, hh = holder.clientHeight;
    put(box, card, m); at(knob, corner.x, corner.y, m, hw, hh);
    const inHolder = b => b && { x: m.x(b.x), y: m.y(b.y), w: b.w * m.s, h: b.h * m.s };
    const knobBox = { x: knob.offsetLeft, y: knob.offsetTop, w: knob.offsetWidth, h: knob.offsetHeight }; // its negative margin centres it on left/top
    // A 6 px collar round the knob keeps every handle off it.
    partsUI?.place([{ x: knobBox.x - 6, y: knobBox.y - 6, w: knobBox.w + 12, h: knobBox.h + 12 }]);
    const keep = [inHolder(layout.photo), inHolder(layout.name), inHolder(layout.numbers), ...(layout.other ?? []).map(inHolder), knobBox, ...(partsUI?.occupied?.() ?? [])];
    // Side goes to the disc's outer side first (away from the plate, where the frame is empty), then above or below it.
    const discOut = layout.photo.x + layout.photo.w / 2 > card.x + card.w / 2 ? ['after', 'above', 'below', 'before'] : ['before', 'above', 'below', 'after'];
    // Colour goes just past the end of the numbers row, a step further out when a handle is there (2213cc3: a bar under the
    // preview never hides it), then under or over it.
    const rowEnd = layout.photo.x + layout.photo.w / 2 > (layout.numbers?.x ?? card.x) ? 'after' : 'before';
    // B05 draws its stamp (a small copy of the disc) just past the numbers row, and the layout does not report it, so there Colour
    // goes under the row first, into the plate's empty band.
    const stampAfterRow = String(design.study).endsWith(':b05');
    const rowSpots = (t, w, h) => stampAfterRow ? [...spotsAround(t, w, h, ['below', 'above'])] : [...spotsAround(t, w, h, [rowEnd]), ...spotsAround(t, w, h, ['below', 'above'])];
    // Plate goes under the plate's corner away from the disc, its edge lined up with the plate's, then over that corner.
    const discRight = layout.photo.x + layout.photo.w / 2 > card.x + card.w / 2;
    const plateSpots = (t, w, h) => { const x = discRight ? t.x + w / 2 : t.x + t.w - w / 2; return [{ x, y: t.y + t.h + 8 + h / 2 }, { x, y: t.y - 8 - h / 2 }, ...spotsAround(t, w, h, ['below', 'above'])]; };
    // What a badge must never sit on, even on a phone where nothing is clear: the knob, the parts' handles and the badges before it.
    const o = holder.getBoundingClientRect();
    const hard = [knobBox, ...[...layer.querySelectorAll('.cp-h')].filter(el => el.offsetParent).map(el => { const r = el.getBoundingClientRect(); return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }; })];
    for (const { hint, target, badge, where } of controls) {
      put(hint, { x: target.x - 6 / m.s, y: target.y - 6 / m.s, w: target.w + 12 / m.s, h: target.h + 12 / m.s }, m);
      const t = inHolder(target), w = badge.offsetWidth, h = badge.offsetHeight;
      const took = placeClear(badge, where === 'plate' ? plateSpots(t, w, h) : where === 'disc' ? spotsAround(t, w, h, discOut) : rowSpots(t, w, h), keep, hw, hh, 4, hard);
      keep.push(took); hard.push(took);
    }
    for (const c of controls) if (c.tip.classList.contains('on')) c.placeTip(); // an open bubble follows its badge
  }
  const resize = new ResizeObserver(place), watch = new MutationObserver(place);
  resize.observe(holder); watch.observe(svg, { attributes: true, attributeFilter: ['viewBox', 'style', 'class'] });
  function stop() { resize.disconnect(); watch.disconnect(); strip.remove(); partsUI?.detach(); }
  place();
  // Handles on the card's parts, where the renderer reports them (B01 revision 2 so far).
  if (layout.recipe) { partsUI = attachCardParts(holder, layer, { recipe: layout.recipe, design, name: layout.recipe.name, view, onChange }); place(); } // badges step clear of the handles

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
    const to = home ? { x: 0, y: 0 } : next;
    if (to.x === nudge0.x && to.y === nudge0.y) return null; // where it already is: nothing to redraw
    onChange({ nudge: to }, home ? 'Back in its corner' : 'Card moved');
    return { x: to.x - nudge0.x, y: to.y - nudge0.y }; // where the new card will be drawn, from where this one is
  };
  box.addEventListener('pointerdown', e => {
    const m = view(); let dx = 0, dy = 0;
    track(box, e, (x, y) => { dx = x; dy = y; svg.style.translate = `${x}px ${y}px`; box.style.translate = `${x}px ${y}px`; },
      (moved, cancelled) => {
        if (!moved && !cancelled && onPhone()) { armed = !armed; layer.classList.toggle('ce-armed', armed); hintText(); place(); return; }
        const to = moved && !cancelled ? (begin('Move'), commitNudge(dx / m.s, dy / m.s)) : null;
        if (moved && !cancelled && !to) settle('unchanged'); // dropped where it already was: nothing to redraw
        // The card stays where the finger left it (or settles into its corner) until the redrawn card replaces it; it never
        // jumps back to where it started while the new pixels are drawn. A redraw that never comes lets go after 2 s.
        const at = to ? `${to.x * m.s}px ${to.y * m.s}px` : '';
        svg.style.translate = at; box.style.translate = at; layer.classList.toggle('is-dragging', Boolean(to)); // badges come back on the new card
        if (to) setTimeout(() => { if (svg.isConnected) { svg.style.translate = ''; box.style.translate = ''; layer.classList.remove('is-dragging'); } }, 2000);
      });
  });
  box.addEventListener('keydown', e => {
    const step = e.shiftKey ? 40 : 8, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return; e.preventDefault(); begin('Nudge (keys)'); if (!commitNudge(d[0], d[1])) settle('unchanged');
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
      (moved, cancelled) => { ghost.remove(); knob.textContent = '⤡'; place(); if (moved && !cancelled && next !== scale0) begin('Size'), onChange({ scale: next }, `Card at ${Math.round(next * 100)}%`); });
  });
  return () => { stop(); layer.remove(); };
}
/** Remove the editor and its strip (kept versions, Battle and Bag show no controls). */
export function detachCardEditor(holder) {
  holder.querySelector(':scope > .card-editor')?.remove();
  clearChrome(holder);
}
