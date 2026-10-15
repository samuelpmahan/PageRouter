import { WORK } from './paths.mjs';
// One contract, many implementations, selected per run. Every implementation × every truth-set photo, with receipts.
import fs from 'node:fs';
import { createWorld } from '../../src/kernel.mjs';
const I = await import('./impls.mjs');
const idx = JSON.parse(fs.readFileSync(`${WORK}/raw/index.json`, 'utf8'));
const w = createWorld({ name: 'rimfit' });
const ellipse = { type: 'object', properties: { cx: { type: 'number' }, cy: { type: 'number' }, rx: { type: 'number' }, ry: { type: 'number' }, angle: { type: 'number' } }, required: ['cx', 'cy', 'rx', 'ry', 'angle'] };
w.contract({ id: 'disc.rimfit', description: 'the outer rim of the disc in a photo, as an ellipse in source pixels, or an abstention',
  in: { photo: { type: 'object', required: ['path', 'width', 'height', 'sha256'] } },
  out: { status: { type: 'string', enum: ['MAYBE', 'ABSTAIN'] }, ellipse: { oneOf: [ellipse, { type: 'null' }] }, evidence: { type: 'object' } } });
const S = (slot) => `disc.rimfit#${slot}`;
const call = (ctx, photo, slot) => { const r = ctx.call('disc.rimfit', { photo }, { slot }); return { status: r.status.value, ellipse: r.ellipse.value, evidence: r.evidence.value }; };
const leaf = (id, description, f) => w.implement({ id, implements: 'disc.rimfit', description, run: ({ photo }) => f(photo.value) });
leaf('rimfit/v3@chromium', 'RimFit v3 + rim refinement exactly as the app runs it in Chromium (recorded receipts)', I.v3Chromium);
leaf('rimfit/v3@node', 'the same RimFit v3 + refinement source, run live on Node', I.v3);
leaf('rimfit/candidate-circle', "the app's circle search, top candidate, clamped inside the photo", (p) => I.candidateCircle(p));
leaf('rimfit/past-frame', 'v3 + refinement on the photo padded with its border colour, so a disc touching the edge can close', (p) => I.pastFrame(p));
w.implement({ id: 'rimfit/app-6.6.0', implements: 'disc.rimfit', uses: [S('v3'), S('circle')],
  description: "today's app: v3 if it and its refinement say MAYBE (rounded to the range controls), otherwise the top circle",
  run: ({ photo }, ctx) => { const v = call(ctx, photo, 'v3'); if (v.status === 'MAYBE') return { status: 'MAYBE', ellipse: I.appQuantize(photo.value, v.ellipse), evidence: { stage: 'app: v3', from: v.evidence } };
    const c = call(ctx, photo, 'circle'); return { status: c.status, ellipse: c.ellipse, evidence: { stage: 'app: circle fallback', v3: v.evidence.abstainReasons ?? v.evidence.refinementReason ?? null, from: c.evidence } }; } });
const seeded = (id, description, f) => w.implement({ id, implements: 'disc.rimfit', uses: [S('seed')], description,
  run: ({ photo }, ctx) => { const sd = call(ctx, photo, 'seed'); if (!sd.ellipse) return { status: 'ABSTAIN', ellipse: null, evidence: { stage: id, reason: 'seed abstained', seed: sd.evidence } };
    const r = f(photo.value, sd.ellipse); return { ...r, evidence: { ...r.evidence, seed: sd.ellipse } }; } });
seeded('rimfit/outward-snap', 'walk out from the seed to where colour stops looking like the disc and starts looking like the background', I.outwardSnap);
seeded('rimfit/outward-edge', 'the outermost strong colour edge in a band 0–15% beyond the seed', I.outwardEdge);
seeded('rimfit/segment-band', 'k-means disc/background colour classes around the seed, then the outer edge of the disc region', I.segmentBand);
w.implement({ id: 'rimfit/referee', implements: 'disc.rimfit', uses: [S('a'), S('b'), S('c'), S('d')],
  description: 'runs four candidates and keeps the one with the strongest boundary evidence (contrast across the ellipse × coverage × share in frame); never sees the truth',
  run: ({ photo }, ctx) => { const rows = ['a', 'b', 'c', 'd'].map((sl) => { const r = call(ctx, photo, sl); return { slot: sl, ...r, judged: I.boundaryScore(photo.value, r.ellipse) }; });
    const best = rows.filter((r) => r.ellipse).sort((x, y) => y.judged.score - x.judged.score)[0];
    return best ? { status: 'MAYBE', ellipse: best.ellipse, evidence: { stage: 'referee', picked: best.slot, scores: rows.map((r) => ({ slot: r.slot, score: r.judged.score, contrast: r.judged.medianContrast ?? null, coverage: r.judged.coverage ?? null, inFrame: r.judged.inFrame ?? null })) } }
      : { status: 'ABSTAIN', ellipse: null, evidence: { stage: 'referee', reason: 'every candidate abstained' } }; } });

// selections: name -> fill. Each is one way to fill the contract; nothing is overwritten.
const base = { [S('v3')]: 'rimfit/v3@chromium', [S('circle')]: 'rimfit/candidate-circle' };
export const SELECTIONS = {
  'app 6.6.0 (today)': { 'disc.rimfit': 'rimfit/app-6.6.0', ...base },
  'v3 alone (Chromium)': { 'disc.rimfit': 'rimfit/v3@chromium' },
  'v3 alone (Node)': { 'disc.rimfit': 'rimfit/v3@node' },
  'circle alone': { 'disc.rimfit': 'rimfit/candidate-circle' },
  'circle → outward-snap': { 'disc.rimfit': 'rimfit/outward-snap', [S('seed')]: 'rimfit/candidate-circle' },
  'circle → outward-edge': { 'disc.rimfit': 'rimfit/outward-edge', [S('seed')]: 'rimfit/candidate-circle' },
  'circle → segment-band': { 'disc.rimfit': 'rimfit/segment-band', [S('seed')]: 'rimfit/candidate-circle' },
  'app → outward-edge': { 'disc.rimfit': 'rimfit/outward-edge', [S('seed')]: 'rimfit/app-6.6.0', ...base },
  'past-frame v3': { 'disc.rimfit': 'rimfit/past-frame' },
  'referee (app, snap, edge, segment)': { 'disc.rimfit': 'rimfit/referee', ...base, [S('a')]: 'rimfit/app-6.6.0', [S('b')]: 'rimfit/outward-snap', [S('c')]: 'rimfit/outward-edge', [S('d')]: 'rimfit/segment-band', [S('seed')]: 'rimfit/candidate-circle' },
};
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null, sel = process.env.SEL ? new RegExp(process.env.SEL) : null;
const receipts = [];
for (const photo of idx) {
  if (only && !only.test(photo.name)) continue;
  const input = { photo: { name: photo.name, path: photo.path, width: photo.width, height: photo.height, working: photo.working, sha256: photo.sha256 } };
  for (const [name, fill] of Object.entries(SELECTIONS)) {
    if (sel && !sel.test(name)) continue;
    const t0 = Date.now();
    try { const r = w.run('disc.rimfit', input, { fill, allowUnusedFill: true });
      receipts.push({ photo: photo.name, selection: name, fill, ...r.outputs, ms: Date.now() - t0, calls: r.trace?.calls?.length ?? null, runId: r.runId ?? null });
    } catch (e) { receipts.push({ photo: photo.name, selection: name, fill, status: 'ERROR', ellipse: null, evidence: { error: String(e.message).slice(0, 300) }, ms: Date.now() - t0 }); }
  }
  process.stdout.write('.');
}
fs.writeFileSync(process.env.OUT ?? `${WORK}/receipts.json`, JSON.stringify({ selections: SELECTIONS, implementations: w.implementationsOf('disc.rimfit').map((i) => ({ id: i.id, description: i.description, uses: i.slots })), receipts }, null, 1));
console.log('\n', receipts.length, 'receipts;', receipts.filter((r) => r.status === 'ERROR').length, 'errors');
