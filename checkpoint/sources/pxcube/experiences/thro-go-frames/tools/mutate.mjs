// Builder mutation test: one small bug at a time, injected into a COPY of the code, then the whole test suite is run on the copy.
//   node tools/mutate.mjs [name ...]      writes data/mutants.json (killed / survived, and which tests failed)
// A mutant is KILLED when at least one test fails. The Critic's round 1 list (tools/critic-mutate.mjs) is included, remapped to the Round 2 code, plus
// mutants for what Round 2 added (time zone, window as a terminal, Short split, null for unmeasurable, relative sponsor buckets).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = new URL('../', import.meta.url).pathname;
const out = path.join(root, 'tools/mutants-tmp');
export const MUTANTS = [
  // the Critic's round 1 survivors (and the ones it killed), remapped
  ['deal-end-off-by-one', 'world.mjs', 'd.t.start <= day && day <= d.t.end', 'd.t.start <= day && day < d.t.end', 'critic'],
  ['deal-start-off-by-one', 'world.mjs', 'd.t.start <= day && day <= d.t.end', 'd.t.start < day && day <= d.t.end', 'critic'],
  ['release-day-is-prerelease', 'world.mjs', 'if (month ? p > r1 : p >= r0) return null;', 'if (month ? p > r1 : p > r0) return null;', 'critic'],
  ['release-window-31', 'metrics.mjs', 'lo <= rel.t.windowDays ?', 'lo <= rel.t.windowDays + 1 ?', 'critic'],
  ['release-window-29', 'metrics.mjs', 'lo <= rel.t.windowDays ?', 'lo <= rel.t.windowDays - 1 ?', 'critic'],
  // Widening only one of the two end guards is an equivalent mutant (hasIntervalAt and the appearance end both exclude the last second), so the mutant widens both.
  ['click-ts-end-inclusive', 'enrich.mjs', 'a.start <= ts && ts < a.end && a.hasCard && hasIntervalAt(placementsOf(W, video.id, link.t.discId), ts)', 'a.start <= ts && ts <= a.end && a.hasCard && placementsOf(W, video.id, link.t.discId).some((p) => p.t.startSec <= ts && ts <= p.t.endSec)', 'critic'],
  ['ignore-given-clamp', 'enrich.mjs', 'b = clamp.clampEndTo; }', 'b = card ? clamp.clampEndTo : b; }', 'critic'],
  ['views-first-snapshot', 'world.mjs', 'snaps[snaps.length - 1].views', 'snaps[0].views', 'critic'],
  ['quarter-wrong', 'util.mjs', 'Math.ceil(+iso.slice(5, 7) / 3)', 'Math.floor(+iso.slice(5, 7) / 3) + 1', 'critic'],
  ['per-thousand-scale', 'metrics.mjs', 'scale: 1000', 'scale: 100', 'critic'],
  ['no-overlap-merge-same-disc', 'enrich.mjs', 'if (g && it.a <= g.b)', 'if (false && g && it.a <= g.b)', 'critic'],
  ['no-union-across-discs', 'metrics.mjs', 'const intervals = mergeIntervals(g.apps.map((a) => [a.start, a.end]));', 'const intervals = g.apps.map((a) => [a.start, a.end]);', 'critic'],
  ['ignore-placement-clamp', 'enrich.mjs', 'b = clamp.clampEndTo; }', 'b = card ? b : clamp.clampEndTo; }', 'critic'],
  ['month-last-day-off', 'util.mjs', "-01`, -1);", "-01`, 0);", 'critic'],
  ['zero-views-as-zero', 'metrics.mjs', "attention[a.id] = { value: null, state: v.retentionState", "attention[a.id] = { value: 0, state: v.retentionState", 'critic'],
  ['mold-not-covered-ignored', 'world.mjs', "const covering = same.find((d) => d.t.moldsCovered === 'all' || d.t.moldsCovered.includes(mold.id));", "const covering = same[0];", 'critic'],
  ['dip-threshold', 'metrics.mjs', 'threshold: 0.05', 'threshold: 0.5', 'critic'],
  ['zero-length-kept', 'frames.mjs', "X('hasLength', 'It is on screen for more than zero seconds.', (v, i) => v !== i.t.startSec,", "X('hasLength', 'It is on screen for more than zero seconds.', () => true,", 'critic'],
  // what round 2 added
  ['window-hard-coded-30', 'metrics.mjs', 'lo <= rel.t.windowDays ?', 'lo <= 30 ?', 'round2'],
  ['time-zone-ignored', 'world.mjs', "localDay(video.t.publishedAt, W.get(video.t.channelId)?.t.utcOffsetHours ?? 0)", "localDay(video.t.publishedAt, 0)", 'round2'],
  ['short-folded-into-long', 'metrics.mjs', "list.filter((a) => E.videos[a.videoId].format === f)", "list.filter((a) => f === 'long' || E.videos[a.videoId].format === f)", 'round2'],
  ['unmeasurable-sum-is-zero', 'metrics.mjs', "{ out: { value: null }, receipt: null }", "{ out: { value: 0 }, receipt: null }", 'round2'],
  ['first-deal-only', 'world.mjs', "const same = deals.filter((d) => d.t.manufacturerId === mold.t.manufacturerId);", "const same = deals.slice(0, 1).filter((d) => d.t.manufacturerId === mold.t.manufacturerId);", 'round2'],
  ['pre-release-month-always-certain', 'world.mjs', "certainty: p < r0 ? 'certain' : 'possible'", "certainty: 'certain'", 'round2'],
  ['sponsor-row-keeps-only-first-creator', 'metrics.mjs', "r.byCreator = Object.fromEntries(r.creators.map((c) =>", "r.byCreator = Object.fromEntries(r.creators.slice(0, 1).map((c) =>", 'round2'],
  ['click-predates-publish-ignored', 'frames.mjs', "instantMs(i.t.at) >= instantMs(video.t.publishedAt)", "true || instantMs(i.t.at) >= instantMs(video.t.publishedAt)", 'round2'],
  ['mold-rollup-single-creator', 'metrics.mjs', "const creators = [...new Set(list.map((a) => E.discs[a.discId].creatorId))].sort();", "const creators = [...new Set(list.map((a) => E.discs[a.discId].creatorId))].sort().slice(0, 1);", 'round2'],
  ['merge-adjacent-not-overlapping', 'enrich.mjs', 'if (g && it.a <= g.b)', 'if (g && it.a <= g.b + 1)', 'round2'],
];
// A behaviour guarded in several places needs every guard widened at once (a single edit is an equivalent mutant: the other guards still hold).
const EXTRA = { 'click-ts-end-inclusive': [['frames.mjs', 'return placementsOf(W, link.t.videoId, link.t.discId).some((p) => p.t.startSec <= v && v < p.t.endSec);', 'return placementsOf(W, link.t.videoId, link.t.discId).some((p) => p.t.startSec <= v && v <= p.t.endSec);']] };
const keep = fs.readdirSync(root).filter((f) => !['shots', 'tools', 'data', 'round1-archive'].includes(f) && !f.startsWith('.'));
const want = process.argv.slice(2);
const list = MUTANTS.filter(([n]) => !want.length || want.includes(n));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const run = (name, file, from, to, origin) => new Promise((resolve) => {
  const d = path.join(out, name); fs.mkdirSync(d);
  for (const f of keep) fs.cpSync(path.join(root, f), path.join(d, f), { recursive: true });
  const src = fs.readFileSync(path.join(d, file), 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) return resolve({ name, origin, file, applied: false, note: `pattern found ${n} times` });
  fs.writeFileSync(path.join(d, file), src.replace(from, to));
  for (const [f2, a2, b2] of EXTRA[name] ?? []) { const t2 = fs.readFileSync(path.join(d, f2), 'utf8'); if (t2.split(a2).length !== 2) return resolve({ name, origin, file, applied: false, note: `extra pattern not found in ${f2}` }); fs.writeFileSync(path.join(d, f2), t2.replace(a2, b2)); }
  const t0 = Date.now();
  const p = spawn('node', ['--test', '--test-reporter=tap', 'frames.test.mjs', 'regression.test.mjs', 'cases.test.mjs'], { cwd: d });
  let buf = '';
  p.stdout.on('data', (x) => { buf += x; }); p.stderr.on('data', (x) => { buf += x; });
  const timer = setTimeout(() => p.kill(), 300000);
  p.on('close', (code) => {
    clearTimeout(timer);
    const failed = buf.split('\n').filter((l) => /^not ok /.test(l)).map((l) => l.replace(/^not ok \d+ - /, '').slice(0, 110));
    // a mutant that crashes the whole suite (no TAP "ok" lines at all) still counts as killed, but it is reported as a crash
    const crashed = code !== 0 && failed.length === 0;
    fs.rmSync(d, { recursive: true, force: true });
    resolve({ name, origin, file, applied: true, killed: code !== 0, crashed, failed: failed.slice(0, 6), failedCount: failed.length, seconds: Math.round((Date.now() - t0) / 1000) });
  });
});
const results = [];
let next = 0;
async function worker() { while (next < list.length) { const m = list[next++]; const r = await run(...m); results.push(r); console.log(r.applied ? (r.killed ? 'KILLED   ' : 'SURVIVED ') : 'SKIPPED  ', r.name.padEnd(36), r.applied ? `${r.failedCount} failing: ${r.failed.slice(0, 2).join(' ; ')}` : r.note, `(${r.seconds ?? 0}s)`); } }
await Promise.all([worker(), worker()]);
fs.rmSync(out, { recursive: true, force: true });
results.sort((a, b) => list.findIndex((m) => m[0] === a.name) - list.findIndex((m) => m[0] === b.name));
const summary = { total: results.length, applied: results.filter((r) => r.applied).length, killed: results.filter((r) => r.killed).length, survived: results.filter((r) => r.applied && !r.killed).map((r) => r.name), skipped: results.filter((r) => !r.applied).map((r) => r.name) };
console.log(JSON.stringify(summary));
if (!want.length) fs.writeFileSync(path.join(root, 'data/mutants.json'), JSON.stringify({ summary, results }, null, 1) + '\n');
