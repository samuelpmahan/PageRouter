// Critic: mutation test on COPIES in tools/critic-mutants/<name>/ . Builder files are never edited.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url).pathname;
const out = path.join(root, 'tools/critic-mutants');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const MUTANTS = [
  ['deal-end-off-by-one', 'world.mjs', 'iso <= d.t.end', 'iso < d.t.end'],
  ['deal-start-off-by-one', 'world.mjs', 'd.t.start <= iso', 'd.t.start < iso'],
  ['no-overlap-merge-same-disc', 'enrich.mjs', 'if (g && it.a <= g.b)', 'if (false && g && it.a <= g.b)'],
  ['no-union-across-discs', 'metrics.mjs', 'const intervals = mergeIntervals(g.apps.map((a) => [a.start, a.end]));', 'const intervals = g.apps.map((a) => [a.start, a.end]);'],
  ['ignore-placement-clamp', 'enrich.mjs', "if (b > dur) {", "if (false && b > dur) {"],
  ['ignore-given-clamp', 'enrich.mjs', 'b = Math.min(g.t.endSec, dur)', 'b = g.t.endSec'],
  ['release-day-is-prerelease', 'enrich.mjs', "if (month ? p > r1 : p >= r0) return null;", "if (month ? p > r1 : p > r0) return null;"],
  ['release-window-31', 'metrics.mjs', 'lo <= 30 ?', 'lo <= 31 ?'],
  ['release-window-29', 'metrics.mjs', 'lo <= 30 ?', 'lo <= 29 ?'],
  ['month-last-day-off', 'util.mjs', "-1);\n};", "-0);\n};"],
  ['click-ts-end-inclusive', 'enrich.mjs', "const moment = ts == null ? null : apps.find((a) => a.start <= ts && ts < a.end", "const moment = ts == null ? null : apps.find((a) => a.start <= ts && ts <= a.end"],
  ['views-first-snapshot', 'world.mjs', 'snaps[snaps.length - 1].views', 'snaps[0].views'],
  ['quarter-wrong', 'util.mjs', "Math.ceil(+iso.slice(5, 7) / 3)", "Math.floor((+iso.slice(5, 7) - 1) / 3) + 1 + (+iso.slice(5, 7) === 6 ? 1 : 0)"],
  ['zero-views-as-zero', 'metrics.mjs', "if (v.retentionState !== 'ok') { attention[a.id] = { value: null,", "if (v.retentionState !== 'ok') { attention[a.id] = { value: 0,"],
  ['per-thousand-scale', 'metrics.mjs', 'scale: 1000', 'scale: 100'],
  ['mold-not-covered-ignored', 'world.mjs', "const covers = same.t.moldsCovered === 'all' || same.t.moldsCovered.includes(mold.id);", "const covers = true;"],
  ['dip-threshold', 'metrics.mjs', 'threshold: 0.05', 'threshold: 0.5'],
  ['zero-length-kept', 'enrich.mjs', "if (b === a) { note", "if (false && b === a) { note"],
];
const keep = fs.readdirSync(root).filter((f) => !['shots', 'tools', 'data'].includes(f));
const results = [];
for (const [name, file, from, to] of MUTANTS) {
  const d = path.join(out, name); fs.mkdirSync(d);
  for (const f of keep) fs.cpSync(path.join(root, f), path.join(d, f), { recursive: true });
  fs.mkdirSync(path.join(d, 'data'));
  const src = fs.readFileSync(path.join(d, file), 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) { results.push({ name, applied: false, note: `pattern found ${n} times` }); continue; }
  fs.writeFileSync(path.join(d, file), src.replace(from, to));
  // seed the stored data so the byte-for-byte determinism test compares against the ORIGINAL data: that test then fails for any mutant that changes output (we report it separately)
  fs.copyFileSync(path.join(root, 'data/toy-world.json'), path.join(d, 'data/toy-world.json'));
  const r = spawnSync('node', ['--test', '--test-reporter=tap'], { cwd: d, encoding: 'utf8', timeout: 120000 });
  const lines = r.stdout.split('\n');
  const failed = lines.filter((l) => /^not ok /.test(l)).map((l) => l.replace(/^not ok \d+ - /, ''));
  results.push({ name, applied: true, exit: r.status, failed });
}
for (const r of results) {
  if (!r.applied) { console.log('SKIP  ', r.name, r.note); continue; }
  const nonDeterminism = r.failed.filter((f) => !/^same seed, same bytes/.test(f));
  console.log(nonDeterminism.length ? 'CAUGHT ' : (r.failed.length ? 'ONLY-BYTE-DIFF ' : 'SURVIVED '), r.name.padEnd(30), 'failures:', r.failed.length, '|', r.failed.slice(0, 4).map((s) => s.slice(0, 70)).join(' ; '));
}
