// ?console — the whole editor on one screen, mapped to the phone page it came from (Sam, 24 Oct 17:17: "a single screen that
// somehow maps to the big ol Thro reach phone image ... make a giant extremely comprehensive thing and refine into a nice
// intuitive UI"). Nothing is redrawn or rewired: the page's own controls are moved into columns that each fit the screen.
// Down the left edge is the phone page as it is today (390 × 844, measured by local/test/thro-console-map.mjs), every control
// outlined where it sits there. Each control here carries a tag: which phone screen it was on, and how much of the card was on
// screen while your finger was on it. Point at a control and its place on the phone page lights up, and the other way round.
// No thresholds and no verdicts: the numbers are the measurement, the reading is yours. Without ?console nothing changes.

// The controls, and a key that names the same control on any page width: its label, and which occurrence of that label it is.
const visible = el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 4 && b.height > 4; };
const labelOf = el => (el.getAttribute('aria-label') || el.title || el.closest('label')?.innerText?.split('\n')[0] || el.innerText || el.id || el.name || el.tagName)
  .trim().replace(/\s+/g, ' ').slice(0, 60);
export function controls(root = document) {
  const seen = new Map();
  return [...root.querySelectorAll('button, select, input:not([type=hidden]), [role=radio]')]
    .filter(el => !el.closest('dialog, .console-map-ui') && visible(el))
    .map(el => { const label = labelOf(el), n = (seen.get(label) ?? 0) + 1; seen.set(label, n); return { el, label, key: `${label}#${n}` }; });
}
window.__consoleControls = () => controls();

const on = new URLSearchParams(location.search).has('console');
if (on) start();

async function start() {
  const map = await fetch('./console-map/phone.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (!map) return;
  const byKey = new Map(map.rows.map(r => [r.key, r]));
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  document.documentElement.classList.add('console-map');

  // The phone page, scaled to the screen's height, with every control outlined where it sits on it.
  const rail = document.createElement('aside'); rail.className = 'console-map-ui cm-rail'; rail.setAttribute('aria-label', 'The phone page today');
  rail.innerHTML = `<div class="cm-rail-head"><b>Phone page today</b><span>390 × 844 · ${(map.page / map.screen).toFixed(1)} screens · ${map.rows.length} controls</span></div>
    <button type="button" class="cm-toggle">Show the phone page</button>
    <div class="cm-phone"><img src="./console-map/phone.webp" alt="The thro editor on a phone, the whole page" draggable="false"><div class="cm-boxes"></div></div>`;
  document.body.append(rail);
  const phone = rail.querySelector('.cm-phone'), boxes = rail.querySelector('.cm-boxes');
  const ink = shown => `hsl(${Math.round(1.2 * shown)} 85% 55%)`; // 0% red … 100% green: the measured share, drawn as a colour, not a pass mark
  phone.style.aspectRatio = `${map.width} / ${map.page}`;
  const cardBox = Object.assign(document.createElement('div'), { className: 'cm-card' }); boxes.append(cardBox);
  const pct = (v, of) => `${(100 * v / of).toFixed(3)}%`;
  Object.assign(cardBox.style, { left: pct(map.card.x, map.width), top: pct(map.card.y, map.page), width: pct(map.card.w, map.width), height: pct(map.card.h, map.page) });
  for (let s = 1; s * map.screen < map.page; s++) { const t = document.createElement('div'); t.className = 'cm-screen'; t.style.top = pct(s * map.screen, map.page); t.dataset.n = `screen ${s + 1}`; boxes.append(t); }
  const railBox = new Map();
  for (const r of map.rows) {
    const b = document.createElement('div'); b.className = 'cm-box'; b.dataset.key = r.key; b.title = `${r.label}\nscreen ${(1 + r.y / map.screen).toFixed(1)} · card ${r.shown}% on screen while touched`;
    Object.assign(b.style, { left: pct(r.x, map.width), top: pct(r.y, map.page), width: pct(r.w, map.width), height: pct(r.h, map.page), borderColor: ink(r.shown) });
    boxes.append(b); railBox.set(r.key, b);
  }

  // Tags on the live controls, and a line from a control to its place on the phone page.
  const layer = document.createElement('div'); layer.className = 'console-map-ui cm-layer'; document.body.append(layer);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); line.classList.add('console-map-ui', 'cm-line');
  line.innerHTML = '<path fill="none" stroke-width="2.5" stroke-dasharray="6 4"/>'; document.body.append(line);
  let live = [], lit = null;
  const tagFor = new WeakMap();
  function annotate() {
    live = controls(document.getElementById('workspace') ?? document);
    layer.replaceChildren();
    for (const c of live) {
      const r = byKey.get(c.key), t = document.createElement('span');
      t.className = 'cm-tag'; t.textContent = r ? `s${(1 + r.y / map.screen).toFixed(1)} · ${r.shown}%` : 'new';
      if (r) t.style.setProperty('--ink', ink(r.shown)); else t.classList.add('cm-new');
      layer.append(t); tagFor.set(c.el, t);
      if (!c.el.dataset.cmBound) {
        c.el.dataset.cmBound = '1';
        for (const ev of ['pointerenter', 'focus']) c.el.addEventListener(ev, () => light(c.el));
        for (const ev of ['pointerleave', 'blur']) c.el.addEventListener(ev, () => light(null));
      }
    }
    place();
  }
  function keyOf(el) { return live.find(c => c.el === el)?.key; }
  function light(el) {
    lit = el; for (const b of boxes.querySelectorAll('.is-lit')) b.classList.remove('is-lit');
    for (const c of live) c.el.classList.remove('cm-lit');
    const key = el && keyOf(el), box = key && railBox.get(key);
    if (box) box.classList.add('is-lit');
    if (el) el.classList.add('cm-lit');
    drawLine(el, box);
  }
  function drawLine(el, box) {
    const path = line.querySelector('path');
    if (!el || !box) { path.setAttribute('d', ''); return; }
    const a = box.getBoundingClientRect(), b = el.getBoundingClientRect(), x0 = a.right, y0 = a.top + a.height / 2, x1 = b.left, y1 = b.top + b.height / 2;
    path.setAttribute('d', `M${x0},${y0} C${x0 + 80},${y0} ${x1 - 80},${y1} ${x1},${y1}`);
    path.setAttribute('stroke', box.style.borderColor);
  }
  function place() {
    for (const c of live) {
      const t = tagFor.get(c.el), b = c.el.getBoundingClientRect();
      if (!t) continue;
      const col = c.el.closest('.shelf, .preview-column, .controls-panel, .captures, .workspace-heading');
      const clip = col?.getBoundingClientRect();
      const out = !b.width || (clip && (b.bottom < clip.top || b.top > clip.bottom));
      t.hidden = out; if (out) continue;
      Object.assign(t.style, { left: `${b.right}px`, top: `${b.top}px` });
    }
    if (lit) drawLine(lit, railBox.get(keyOf(lit)));
  }
  boxes.addEventListener('pointerover', e => { const key = e.target.dataset?.key, c = key && live.find(x => x.key === key); if (c) { c.el.scrollIntoView({ block: 'nearest' }); light(c.el); } });
  boxes.addEventListener('pointerleave', () => light(null));
  rail.querySelector('.cm-toggle').addEventListener('click', e => {
    const one = document.documentElement.classList.toggle('console-map');
    e.currentTarget.textContent = one ? 'Show the phone page' : 'Show one screen';
    requestAnimationFrame(annotate);
  });
  let soon = 0; const later = () => { cancelAnimationFrame(soon); soon = requestAnimationFrame(annotate); };
  new MutationObserver(later).observe(document.getElementById('workspace'), { childList: true, subtree: true });
  addEventListener('resize', later); addEventListener('scroll', () => requestAnimationFrame(place), true);
  annotate();
}

const CSS = `
html.console-map,html.console-map body{height:100%;overflow:hidden}
html.console-map .app-header,html.console-map .app-status,html.console-map .diagnostics,html.console-map .conflict-banner:not([hidden]){display:none}
html.console-map #workspace,html.console-map .studio-grid{display:contents}
html.console-map body{display:grid;grid-template-columns:var(--cm-rail,170px) minmax(250px,.9fr) minmax(480px,2.6fr) minmax(330px,1.15fr);grid-template-rows:auto 1fr;gap:10px 14px;padding:10px 14px 10px 0;box-sizing:border-box}
html.console-map .cm-rail{grid-column:1;grid-row:1 / 3}
html.console-map .workspace-heading{grid-column:2;grid-row:1;margin:0;display:flex;flex-direction:column;align-items:stretch;gap:8px}
html.console-map .workspace-heading h1{font-size:18px;letter-spacing:-.4px}
html.console-map .workspace-heading .mode-nav{width:100%}
html.console-map .workspace-heading .mode-nav button{flex:1}
html.console-map .shelf{grid-column:2;grid-row:2;overflow:auto;min-height:0;align-self:stretch}
html.console-map .preview-column{grid-column:3;grid-row:1 / 3;overflow:auto;min-height:0;display:flex;flex-direction:column}
html.console-map .preview-column .export-bar{position:static}
html.console-map .controls-panel{grid-column:4;grid-row:1 / 3;overflow:auto;min-height:0;align-self:stretch}
html.console-map .captures{grid-column:2;grid-row:2;align-self:end;margin:0;max-height:34vh;overflow:auto}
html.console-map .shelf{max-height:calc(100vh - 140px - 34vh)}
html.console-map .composition-picker{grid-template-columns:repeat(3,minmax(0,1fr))}
.cm-rail{display:flex;flex-direction:column;gap:6px;min-height:0;padding:10px 0 10px 10px;background:#0b120d;border-right:1px solid #2a382d;font:11px/1.35 system-ui,sans-serif;color:#c9d3c8;z-index:6}
html:not(.console-map) .cm-rail{position:fixed;right:8px;top:8px;padding:6px;border:1px solid #2a382d;border-radius:10px}
html:not(.console-map) .cm-rail>:not(.cm-toggle){display:none}
.cm-rail-head{display:flex;flex-direction:column;gap:2px}.cm-rail-head span{color:#8fa08b;font-size:10px}
.cm-phone{position:relative;flex:0 1 auto;min-height:0;height:calc(100vh - 150px);max-width:100%;align-self:flex-start;border:1px solid #3a493b;border-radius:8px;overflow:hidden;background:#111a14}
.cm-phone img{display:block;width:100%;height:100%;object-fit:fill;opacity:.82}
.cm-boxes{position:absolute;inset:0}
.cm-card{position:absolute;border:2px solid #4aa3ff;box-shadow:0 0 0 1px #000a;pointer-events:none}
.cm-screen{position:absolute;left:0;right:0;border-top:1px dashed #ffffffaa}
.cm-screen::after{content:attr(data-n);position:absolute;left:2px;top:1px;font-size:8px;color:#fff;text-shadow:0 0 2px #000}
.cm-box{position:absolute;border:1.5px solid;border-radius:2px;cursor:pointer}
.cm-box.is-lit{background:#fff6;box-shadow:0 0 0 3px #fff,0 0 12px 4px #fff8;z-index:2}
.cm-toggle{min-height:32px;font-size:11px;padding:6px 8px}
.cm-layer{position:fixed;inset:0;pointer-events:none;z-index:7}
.cm-tag{position:fixed;transform:translate(-100%,-55%);font:700 9px/1 ui-monospace,monospace;padding:2px 4px;border-radius:4px;background:#0b120dee;color:var(--ink,#fff);border:1px solid var(--ink,#fff);white-space:nowrap}
.cm-tag.cm-new{--ink:#9ab0ff}
.cm-line{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:8}
.cm-lit{outline:3px solid #fff!important;outline-offset:2px}
`;
