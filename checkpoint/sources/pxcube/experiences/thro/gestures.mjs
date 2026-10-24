// Every gesture is a PxC run, and every stage of it a kernel call, so the kernel times them (seq 63; Sam, 23 Oct: "PxC is designed
// to auto instrument every Calculation"). This replaces timing.mjs, which kept its own spans. Nothing here changes behaviour.
//
// The run: world 'thro.gestures', contract thro.gesture (one run per tap, drag or key), whose stages are calls to thro.stage, one slot
// per stage name ('draw the card', 'save the change', …). A stage's work is the app's own function, so thro.stage is impure; its
// inputs name the job, its output only says it finished. The kernel's side record gives every stage ms, selfMs and a ledger whose
// remainders are signed and named by where they sit; the gesture's ledger is that record, relabelled for people.
//
// The parent is passed explicitly. A stage started while another stage's function is running (synchronously) is that stage's
// child; any other stage is a child of the gesture it is given (span(name, fn, gesture)), or else of the gesture still being
// answered. There is no "current stage" that has to survive an await: code that waits keeps its place with here() and passes it
// back (span(name, fn, place), or within(place, fn) for code it calls), as native-cards.mjs and workspace.mjs do.
//
// Conservation (engineering notebook, page 2). Three laws are kept as books and checked on every gesture:
//   1. Gestures: every gesture that begins ends exactly once, and says how: painted, superseded by a newer gesture, unchanged
//      (nothing to redraw), or failed. begun = painted + superseded + unchanged + failed + open, and open is 0 once things settle.
//      A gesture still undecided after 3 s is a counted violation.
//   2. Time: the kernel's ledger of the gesture, from the finger until its last work (the save) is done: stages plus named,
//      signed remainders, minus the overlap of stages that ran at the same time, equals the total. `end` marks the pixels.
//   3. Paints (recorded by thro-app.mjs on the gesture): its final pixels are painted exactly once.
import { createWorld } from './pxc/kernel.mjs';

const keep = 12;
const STALE = 3000;
export const gestures = [];
export const books = { begun: 0, painted: 0, superseded: 0, unchanged: 0, failed: 0, staleAfter3s: 0 };
const now = () => performance.now();
const changed = () => { try { dispatchEvent(new CustomEvent('thro:books', { detail: books })); } catch { /* not in a page */ } };
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

// The clock is the page's own (performance.now), except that a gesture's run starts at the finger: the event's timeStamp is a
// reading of the same clock, taken earlier. It is held only until the gesture's implementation starts.
let clockAt = null;
export const world = createWorld({ name: 'thro.gestures', clock: () => clockAt ?? performance.now() });
world.contract({ id: 'thro.gesture', description: 'One tap, drag or key, from the finger until its last work is done.', in: { label: { type: 'string' } }, out: { outcome: { type: 'string' } } });
world.contract({ id: 'thro.stage', description: 'One stage of a gesture: the app\'s own function, timed by the kernel.', in: { job: { type: 'integer' } }, out: { done: { type: 'boolean' } } });

let starting = null;
world.implement({ id: 'thro.gesture/finger', implements: 'thro.gesture', uses: ['thro.stage'], pure: false,
  description: 'Waits until the gesture is decided, every stage it started has finished and nothing still holds it.',
  run: async (_, ctx) => {
    clockAt = null;
    const g = starting; starting = null;
    g.ctx = ctx; g.live = true;
    while (!g.outcome || g.holds > 0 || g.kids.size) await new Promise(resolve => { g.poke = resolve; });
    g.live = false;
    return { outcome: g.outcome };
  } });

const jobs = new Map(); let jobSeq = 0;
const stack = []; // the stages whose functions are running right now, innermost last (synchronous only, so always balanced)
world.implement({ id: 'thro.stage/app', implements: 'thro.stage', uses: ['thro.stage'], pure: false,
  description: 'Runs the app\'s function for this stage, and waits for any stage it started inside it.',
  run: ({ job }, ctx) => {
    const j = jobs.get(job.value);
    stack.push({ g: j.g, ctx, j });
    let out;
    try { out = j.fn(); } catch (error) { j.error = error; j.sync = true; j.closed = true; throw error; } finally { stack.pop(); }
    // A stage is done when its function is and every stage started under it is too; from then on it takes no new children.
    const kids = async () => { while (j.kids.size) await Promise.allSettled([...j.kids]); j.closed = true; };
    if (out && typeof out.then === 'function') {
      return out.then(async value => { j.result = value; await kids(); return { done: true }; }, error => { j.error = error; j.closed = true; throw error; });
    }
    j.result = out; j.sync = true;
    if (!j.kids.size) { j.closed = true; return { done: true }; }
    return kids().then(() => ({ done: true }));
  } });

let current = null;
const slotOf = name => String(name).replace(/[#/]/g, '·');

/** A tap or drag starts a gesture. One still undecided is superseded (one already showing its pixels closes as painted). */
export function begin(label, at = now()) {
  if (current && !current.outcome && !current.closing) decide(current, 'superseded');
  const g = { label, start: at, end: null, outcome: null, paints: [], stages: [], ledger: null, kids: new Set(), holds: 0, live: false, closing: false, poke: () => {} };
  current = g; books.begun++; changed();
  setTimeout(() => { if (!g.outcome && !g.stale) { g.stale = true; books.staleAfter3s++; changed(); } }, Math.max(0, STALE + 50 - (now() - at)));
  starting = g; clockAt = Math.min(at, now());
  world.runAsync('thro.gesture', { label }).then(r => record(g, r.timing, r.receipt), error => record(g, error.timing, error.receipt));
  clockAt = null;
  return g;
}

/** Where a stage started now would go: the stage whose function is running, else the gesture being answered. Keep it to pass
 *  to span after an await, so a stage that waits keeps its children (the parent passed explicitly, never guessed). */
export const here = () => stack.at(-1) ?? current;
/** Run fn with `at` (from here()) as the running stage, for code that resumes after an await: the explicit way back to a parent. */
export function within(at, fn) {
  if (!at?.j || at.j.closed) return fn();
  stack.push(at);
  try { return fn(); } finally { stack.pop(); }
}
/** Time one stage (sync or async) as a kernel call. `where` is a gesture or a place from here(); the stage whose function is
 *  running right now, if it belongs to the same gesture, is used first. */
export function span(name, fn, where = current) {
  const top = stack.at(-1), g0 = where?.j ? where.g : where;
  let parent = top && (!g0 || top.g === g0) ? top : null;
  if (!parent && where?.j && !where.j.closed) parent = where;
  const g = parent?.g ?? g0;
  if (!g || !g.live) return measured(name, fn);
  const id = ++jobSeq, j = { g, fn, kids: new Set(), sync: false };
  jobs.set(id, j);
  const p = (parent?.ctx ?? g.ctx).callAsync('thro.stage', { job: id }, { slot: slotOf(name) });
  const settled = p.then(() => { jobs.delete(id); }, () => { jobs.delete(id); });
  const owner = parent ? parent.j.kids : g.kids;
  owner.add(settled); settled.then(() => { owner.delete(settled); g.poke(); });
  if (j.sync) { if ('error' in j) throw j.error; return j.result; } // it finished (or failed) before callAsync returned
  return p.then(() => j.result, error => { throw j.error ?? error; });
}
// Outside a gesture a stage is not booked; it still shows in the browser's own Performance panel.
function measured(name, fn) {
  const start = now(), done = () => { try { performance.measure(`thro:${name}`, { start, end: now() }); } catch { /* old browsers */ } };
  let out;
  try { out = fn(); } catch (error) { done(); throw error; }
  if (out && typeof out.then === 'function') return out.then(v => { done(); return v; }, e => { done(); throw e; });
  done(); return out;
}

/** Keep a gesture's run open until the work it started (a save) is done: hold(g) returns release. */
export function hold(g = current) {
  if (!g || !g.live) return () => {};
  g.holds++; let released = false;
  return () => { if (released) return; released = true; g.holds--; g.poke(); };
}

function decide(g, outcome) {
  if (g.outcome) return;
  g.outcome = outcome; g.end = now() - g.start;
  if (current === g) current = null;
  books[outcome]++; changed(); g.poke();
}
/** The pixels are on screen: wait for that frame to be presented (a stage of its own), then the gesture is painted. */
export function end(g = current) {
  if (!g || g.outcome || g.closing) return;
  g.closing = true;
  Promise.resolve(span('wait for the frame to be shown', nextFrame, g)).then(() => decide(g, 'painted'), () => decide(g, 'painted'));
}
/** Decide the active gesture without pixels: 'unchanged' (nothing to redraw) or 'failed'. */
export function settle(outcome, g = current) { if (g && !g.outcome && !g.closing) decide(g, outcome); }
/** The gesture still waiting for its pixels. Past 3 s it is no longer treated as active (it is counted above as a violation). */
export const active = () => (current && !current.outcome && now() - current.start < STALE ? current : null);
/** The books balance: every gesture begun is accounted for, or still open. */
export const open = () => books.begun - books.painted - books.superseded - books.unchanged - books.failed;

// The gesture's record, read from the kernel's side record once its run is done.
const nameOf = c => (c.contract === 'thro.stage' ? c.slot : c.contract === 'thro.gesture' ? 'the gesture' : c.contract);
const plain = text => text.replaceAll('“thro.stage#', '“').replace('from the start of “thro.gesture” to', 'from the finger to')
  .replace(', until “thro.gesture” returns', ', until the gesture\'s last work is done').replace('inside “thro.gesture”, not itemised', 'from the finger until the gesture was decided, with no stage');
function record(g, timing, receipt) {
  if (timing) {
    const top = timing.calls[0], parent = new Map();
    for (const c of timing.calls) for (const r of c.rows) if (r.call) parent.set(r.call, c.id);
    const depth = id => { let d = -1; for (let p = parent.get(id); p !== undefined; p = parent.get(p)) d++; return d; };
    g.stages = timing.calls.slice(1).map(c => ({ name: nameOf(c), start: c.start, ms: c.ms, selfMs: c.selfMs, depth: depth(c.id), ...(c.error ? { error: c.error } : {}) }));
    g.ledger = top && { rows: top.rows.map(r => ({ name: plain(r.name), ms: r.ms, ...(r.remainder ? { remainder: true } : {}), ...(r.overlaps ? { overlaps: r.overlaps } : {}) })),
      overlap: top.overlap, total: top.ms, balance: top.rows.reduce((t, r) => t + r.ms, 0) - top.overlap - top.ms, closes: timing.closes };
    g.opaque = timing.opaque.filter(o => o.call !== null).map(o => ({ name: nameOf(timing.calls.find(c => c.id === o.call)), selfMs: o.selfMs, share: o.share }));
    g.runId = timing.runId;
    for (const s of g.stages) try { performance.measure(`thro:${s.name}`, { start: g.start + s.start, end: g.start + s.start + s.ms }); } catch { /* old browsers */ }
    try { performance.measure(`thro:gesture ${g.label} (${g.outcome})`, { start: g.start, end: g.start + (g.end ?? timing.ms) }); } catch { /* old browsers */ }
  }
  g.receipt = receipt ?? null;
  delete g.ctx;
  gestures.push(g); if (gestures.length > keep) gestures.shift();
  try { dispatchEvent(new CustomEvent('thro:timing', { detail: g })); } catch { /* not in a page */ }
}
if (typeof window !== 'undefined') { window.__thro ??= {}; window.__thro.timing = gestures; window.__thro.books = books; window.__thro.gestureWorld = world; }
