// Flip book: a picture built up one thing at a time, checked frame by frame.
// Extracted from three flip books written by hand first (now patterns/books.mjs).
//
// A flip book is one of three shapes (a union):
//   { title, steps:  [{ label, points, state }], render(state) -> html }   frame k = render(steps[k].state)
//   { title, picture: html, layers: [{ label, points, hide: [css selectors] }] }  frame k = picture with layers > k hidden
//   { title, url, steps: [{ label, act(page), read(page), expect(value) }] }   a live page driven step by step (shootFlow)
// Every frame carries `points`: the data it shows (a call, a tick and run, a layer, a value read off the page).
// The first two promise "each frame only adds"; a flow changes screens, so it promises "each frame's claim holds".
// shoot() renders every frame on one fixed canvas with pinned fonts, and for each frame reports
//   added      pixels that appeared        (must be > 0: every frame adds something)
//   disturbed  pixels already drawn that changed (should be ~0: earlier content never moves)
//   box        where the change is (outlined in red on the contact sheet by the checker, never by the drawing)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Turn either shape into frames: [{ label, points, html }]. */
export function frames(book) {
  if (Array.isArray(book.steps) && typeof book.render === 'function') {
    return book.steps.map((s) => ({ label: s.label, points: s.points ?? null, html: book.render(s.state) }));
  }
  if (typeof book.picture === 'string' && Array.isArray(book.layers)) {
    return book.layers.map((l, k) => {
      const later = book.layers.slice(k + 1).flatMap((x) => x.hide ?? []);
      return { label: l.label, points: l.points ?? null, html: `${later.length ? `<style>${later.join(',')}{display:none}</style>` : ''}${book.picture}` };
    });
  }
  throw new Error('a flip book has either { steps, render } or { picture, layers }');
}

/** Render, check and lay out a flip book. Returns the per-frame report; writes <out>.png (contact sheet). */
export function shoot(book, out, { width = 900 } = {}) {
  const fr = frames(book);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(`${out}.frames.json`, JSON.stringify({ title: book.title, frames: fr.map(({ label, points, html }) => ({ label: points ? `${label}` : label, points, html })) }));
  execFileSync('python3', [path.join(here, 'flipbook_shoot.py'), `${out}.frames.json`, out, String(width)], { stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(fs.readFileSync(`${out}.report.json`, 'utf8')).map((r, k) => ({ ...r, points: fr[k].points }));
}

/** The flip book's promise: every frame adds something, and nothing already drawn moves (beyond antialiasing).
 *  For a flow: every frame's claim holds, and every step after the first changed the screen. */
export function problems(report, { tolerance = 0.1 } = {}) {
  if (report.some((r) => 'claim' in r)) {
    return report.flatMap((r) => [
      ...(r.claim ? [] : [`frame ${r.frame} (${r.label}) claim failed: read ${JSON.stringify(r.points?.value)}`]),
      ...(r.frame > 0 && r.acted && r.added + r.disturbed === 0 ? [`frame ${r.frame} (${r.label}) acted but changed nothing on screen`] : []),
    ]);
  }
  return report.slice(1).flatMap((r) => [
    ...(r.added === 0 ? [`frame ${r.frame} (${r.label}) added nothing`] : []),
    ...(r.disturbed > tolerance * r.added ? [`frame ${r.frame} (${r.label}) disturbed ${r.disturbed} px of earlier content (added ${r.added})`] : []),
  ]);
}

// ---------------------------------------------------------------- step sources found while building (more get added as they recur)

/** A kernel run, one call at a time in execution order (call ids are execution order). */
export function callSteps(trace) {
  const upTo = (n, k) => ({ ...n, calls: n.calls.filter((c) => c.id <= k).map((c) => upTo(c, k)) });
  const all = []; (function walk(n) { all.push(n); n.calls.forEach(walk); })(trace);
  return all.map((n) => ({ label: `${n.id === trace.id ? '' : '+ '}#${n.id} ${n.contract}`, points: { call: n.id }, state: upTo(trace, n.id) }));
}

/** A drive, one tick at a time: each receipt's output state, pointing at its tick and run. */
export function tickSteps(receipts, part, { port = 'state', label = (s, r) => `tick ${r.tick}` } = {}) {
  return receipts.map((r) => { const s = part(r.outputs[port]); return { label: label(s, r), points: { run: r.runId, tick: r.tick }, state: s }; });
}

/** One picture, no comparison: a flip book of a single frame, kept whole (no contact sheet). Writes <out>.png. */
export function snap(html, out, { title = '', width = 900 } = {}) {
  const report = shoot({ title, steps: [{ label: title, state: html }], render: (h) => h }, out, { width });
  fs.copyFileSync(`${out}-frames/00.png`, `${out}.png`);
  return report;
}

/**
 * Drive a live page one step at a time and shoot each step. A step:
 *   act(page)       what the person does (click, choose, type); omitted for the first frame
 *   read(page)      the value this frame shows, read off the page (it becomes the frame's points and its label)
 *   expect(value)   the claim: true when the page shows what this step should produce
 *   label           string, or (value) => string so the label displays the data it points at
 *   name            short name used when the step cannot be done (the frame then says what failed)
 *   focus           optional selector scrolled into view before the shot
 *   mark            optional selector outlined in red: the element whose value the label shows
 *                   (focus and mark may also be (page) => locator, for an element inside an iframe)
 * Returns the report; each row has claim (true/false) and points { value }. Writes <out>.png like shoot().
 */
export async function shootFlow(book, out, { width = 430, height = 900 } = {}) {
  const { chromium } = await import('playwright');
  fs.mkdirSync(`${out}-frames`, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(book.url);
  const fr = [];
  try {
    for (const [k, step] of book.steps.entries()) {
      // A step the page will not let the person do is a result, not a crash: shoot it as a failed claim and stop there.
      let failedAct = null;
      if (step.act) { try { await step.act(page); } catch (e) { failedAct = String(e.message ?? e).split('\n')[0].slice(0, 90); } }
      const value = failedAct ? { couldNot: failedAct } : step.read ? await step.read(page) : null;
      const ok = !failedAct && (step.expect ? !!step.expect(value) : true);
      const where = (sel) => (typeof sel === 'function' ? sel(page) : page.locator(sel)).first();
      if (step.focus) await where(step.focus).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const png = `${out}-frames/${String(k).padStart(2, '0')}.png`;
      await page.screenshot({ path: png });
      const bb = step.mark && !failedAct ? await where(step.mark).boundingBox().catch(() => null) : null;
      const box = bb ? [Math.round(bb.x), Math.round(bb.y), Math.round(bb.x + bb.width), Math.round(bb.y + bb.height)] : null;
      const label = failedAct ? `${step.name ?? `step ${k}`}: could not do it (${failedAct})` : typeof step.label === 'function' ? step.label(value) : step.label;
      fr.push({ label, png, ok, acted: !!step.act, points: { value }, ...(box ? { box } : {}) });
      if (failedAct) break;
    }
  } finally { await browser.close(); }
  fs.writeFileSync(`${out}.frames.json`, JSON.stringify({ title: book.title, promise: 'claims', frames: fr }));
  execFileSync('python3', [path.join(here, 'flipbook_shoot.py'), `${out}.frames.json`, out, String(width)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const report = JSON.parse(fs.readFileSync(`${out}.report.json`, 'utf8'));
  return report.map((r, k) => ({ ...r, added: r.added ?? 0, disturbed: r.disturbed ?? 0, claim: fr[k].ok, acted: fr[k].acted, points: fr[k].points, pageErrors: k === report.length - 1 ? errors : undefined }));
}
