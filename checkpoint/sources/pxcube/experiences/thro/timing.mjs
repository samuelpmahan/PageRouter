// How long a gesture takes, from the finger to the pixels, stage by stage (Sam, 23 Oct: "Make it not take almost a full second.
// Is this instrumented? Why not?"). Every stage is a User Timing measure (performance.measure, so it shows in the browser's own
// Performance panel too); the last gestures are kept on window.__thro.timing and drawn in the DTree. Nothing here changes behaviour.
//
// Conservation (engineering notebook, page 2; Sam, 23 Oct: "that's what spans are for, checking: is this conserved over this
// span?"). Three laws are kept as books and checked on every gesture:
//   1. Gestures: every gesture that begins ends exactly once, and says how: painted, superseded by a newer gesture, unchanged
//      (nothing to redraw), or failed. begun = painted + superseded + unchanged + failed + open, and open is 0 once things settle.
//   2. Time: a gesture's total is its top-level stages plus named remainders (before the first stage, between two stages, after
//      the last until the frame is shown). The remainders are named by their boundaries, never by a guess at their contents.
//      Stages that overlap are not sequential: the overlap is recorded, signed, not hidden.
//   3. Paints (recorded by thro-app.mjs on the gesture): its final pixels are painted exactly once; a repaint of the same pixels
//      is a duplicate.
// These are the replacement this file's own 3-second timeout needed: a gesture still open after 3 s is now a counted violation.
const keep = 12;
export const gestures = [];
export const books = { begun: 0, painted: 0, superseded: 0, unchanged: 0, failed: 0, staleAfter3s: 0 };
let current = null;
const now = () => performance.now();
const STALE = 3000;
const changed = () => { try { dispatchEvent(new CustomEvent('thro:books', { detail: books })); } catch { /* not in a page */ } };

/** A tap or drag starts a gesture; every span until it ends is one of its stages. A gesture still open is superseded. */
export function begin(label, at = now()) {
  if (current && !current.end && !current.closing) close(current, 'superseded'); // one already showing its pixels closes as painted
  current = { label, start: at, stages: [], end: null, outcome: null, paints: [] };
  books.begun++; changed();
  setTimeout(() => { if (current && !current.end && now() - current.start >= STALE && !current.stale) { current.stale = true; books.staleAfter3s++; changed(); } }, STALE + 50);
  return current;
}
/** Time one stage (sync or async); nested spans are kept with their depth. */
export function span(name, fn) {
  const g = current, start = now(), depth = g ? g.open = (g.open ?? 0) + 1 : 0;
  const done = () => {
    const end = now();
    try { performance.measure(`thro:${name}`, { start, end }); } catch { /* old browsers */ }
    if (g) { g.open--; g.stages.push({ name, start: start - g.start, ms: end - start, depth: depth - 1 }); }
  };
  let out;
  try { out = fn(); } catch (e) { done(); throw e; }
  if (out && typeof out.then === 'function') return out.then(v => { done(); return v; }, e => { done(); throw e; });
  done(); return out;
}
// The time ledger: top-level stages in order, and a named remainder for every gap between them.
function ledger(g) {
  // Top-level means not inside another stage's interval. (Counting open spans would mis-nest stages that merely overlap in
  // time, such as a microtask that starts while an unrelated async stage is still open.)
  const all = g.stages.filter(s => s.start < g.end).map(s => ({ name: s.name, from: Math.max(0, s.start), to: Math.min(g.end, s.start + s.ms) }));
  const inside = (a, b) => a !== b && b.from <= a.from && a.to <= b.to && (b.to - b.from > a.to - a.from || all.indexOf(b) < all.indexOf(a));
  const top = all.filter(a => !all.some(b => inside(a, b))).sort((a, b) => a.from - b.from);
  const rows = []; let at = 0, overlap = 0, prev = null;
  for (const s of top) {
    if (s.from > at) rows.push({ remainder: true, name: prev ? `between “${prev}” and “${s.name}”` : `from the finger to “${s.name}”`, ms: s.from - at });
    else if (s.from < at) overlap += Math.min(at, s.to) - s.from;
    rows.push({ name: s.name, ms: s.to - s.from }); at = Math.max(at, s.to); prev = s.name;
  }
  if (g.end > at) rows.push({ remainder: true, name: prev ? `after “${prev}”, until the frame is shown` : 'from the finger until the frame is shown', ms: g.end - at });
  const sum = rows.reduce((t, r) => t + r.ms, 0) - overlap; // stages counted twice where they overlapped
  return { rows, overlap, total: g.end, balance: sum - g.end };
}
function record(g) {
  g.ledger = ledger(g);
  gestures.push(g); if (gestures.length > keep) gestures.shift();
  if (current === g) current = null;
  try { performance.measure(`thro:gesture ${g.label} (${g.outcome})`, { start: g.start, end: g.start + g.end }); } catch { /* old browsers */ }
  books[g.outcome]++; changed();
  try { dispatchEvent(new CustomEvent('thro:timing', { detail: g })); } catch { /* not in a page */ }
}
function close(g, outcome) { g.end = now() - g.start; g.outcome = outcome; record(g); }
/** The pixels are on screen: wait for the next frame to be presented, then close the gesture as painted. */
export function end(g = current) {
  if (!g || g.end || g.closing) return;
  g.closing = true;
  requestAnimationFrame(() => setTimeout(() => { if (!g.end) close(g, 'painted'); }, 0));
}
/** Close the active gesture without pixels: 'unchanged' (nothing to redraw) or 'failed'. */
export function settle(outcome, g = current) { if (g && !g.end && !g.closing) close(g, outcome); }
/** The gesture still waiting for its pixels. Past 3 s it is no longer treated as active (it is counted above as a violation). */
export const active = () => (current && now() - current.start < STALE ? current : null);
/** The books balance: every gesture begun is accounted for, or still open. */
export const open = () => books.begun - books.painted - books.superseded - books.unchanged - books.failed;
if (typeof window !== 'undefined') { window.__thro ??= {}; window.__thro.timing = gestures; window.__thro.books = books; }
