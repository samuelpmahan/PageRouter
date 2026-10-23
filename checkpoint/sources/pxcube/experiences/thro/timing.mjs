// How long a gesture takes, from the finger to the pixels, stage by stage (Sam, 23 Oct: "Make it not take almost a full second.
// Is this instrumented? Why not?"). Every stage is a User Timing measure (performance.measure, so it shows in the browser's own
// Performance panel too); the last gestures are kept on window.__thro.timing and drawn in the DTree. Nothing here changes behaviour.
const keep = 12;
export const gestures = [];
let current = null;
const now = () => performance.now();

/** A tap or drag starts a gesture; every span until it ends is one of its stages. */
export function begin(label, at = now()) {
  current = { label, start: at, stages: [], end: null };
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
/** The pixels are on screen: wait for the next frame to be presented, then close the gesture. */
export function end(g = current) {
  if (!g || g.end) return;
  requestAnimationFrame(() => setTimeout(() => {
    g.end = now() - g.start; g.stages.sort((a, b) => a.start - b.start);
    try { performance.measure(`thro:gesture ${g.label}`, { start: g.start, end: g.start + g.end }); } catch { /* old browsers */ }
    gestures.push(g); if (gestures.length > keep) gestures.shift();
    if (current === g) current = null;
    dispatchEvent(new CustomEvent('thro:timing', { detail: g }));
  }, 0));
}
// A gesture that never reached its pixels (an error, a card with no handles) stops counting as active after 3 s.
export const active = () => (current && now() - current.start < 3000 ? current : null);
if (typeof window !== 'undefined') { window.__thro ??= {}; window.__thro.timing = gestures; }
