// Mold search benchmark (Prototype). The problem is declarative; solvers are pluggable.
// Problem: a person types a query for one catalog mold; that mold should be in the list the composer shows
// (12 rows), ideally first, and queries for nothing in the catalog should show nothing.
// Run: node --experimental-strip-types work/mold-search-bench/bench.mjs   (from D:\PageRouter)
// Writes work/mold-search-bench/out/results.json; exits 1 when a cell surprises its prediction.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.join(here, '../../checkpoint/sources/pxcube/vendor/studio/upload-disc-to-shelf');
const { catalog } = await import(new URL('file:///' + path.join(studio, 'catalog.ts').replace(/\\/g, '/')));
const { fuzzyMoldOptions } = await import(new URL('file:///' + path.join(studio, 'mold-search.ts').replace(/\\/g, '/')));

// Same label the composer searches (upload-ui.ts seedLabel: `${seed.manufacturer} · ${seed.name}`, name = mold).
const rows = catalog.map((r) => ({ id: r.id, manufacturer: r.manufacturer, mold: r.mold }));
const label = (r) => `${r.manufacturer} · ${r.mold}`;
const LIMIT = 12;

// ---- Solvers. Add beside; never overwrite.
const normalize = (v) => v.toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, ' ');
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const above = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + Number(a[i - 1] !== b[j - 1])); diag = above; }
  }
  return row[b.length];
}
// The catalog's only non a-z/0-9 characters (all 724 rows surveyed 2026-10-15):
//   + (Roc+, TeeBird +, XD +)   ' (Putt'r, DA'E)   - (X-Caliber, MX-3, Aviar-X)   ( ) (Aviar-X (JK), Talon (Claws))
//   # (#1 Hyzer … #4 Driver)    Ä ö ä å (Kastaplast Älva, Göte, Järn, Stål)
// Rules: + is a word ("plus", matching catalog ids like innova--roc-plus); accents fold (älva = alva);
// apostrophes join (putt'r = puttr); hyphens count both joined and split (x-caliber = xcaliber = x caliber);
// # ( ) are separators.
function normalize2(v) {
  const s = v.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\+/g, ' plus ').replace(/['’]/g, '');
  const joined = s.replace(/-/g, '');
  const out = (s + (joined !== s ? ' ' + joined : '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return [...new Set(out.split(' '))].join(' ');
}
// Whole word beats a word that merely contains the token; ties go to the shorter label.
// moldOnly: word position and the unmatched-word penalty count mold words only (fixes Serpent losing to Sea Serpent
// because "Reptilian Disc Golf" has more manufacturer words than "Discmania").
function wholeWordFirst(norm, moldOnly = false) {
  const score1 = (token, text, words, pos) => {
    if (words.includes(token)) return 0.5 + pos(token) / 100;
    const at = text.indexOf(token); if (at >= 0) return 1 + at / 100 + (words.some((w) => w.startsWith(token)) ? 0 : 0.5);
    if (token.length < 3) return Infinity;
    let best = Infinity;
    for (const w of words) {
      const d = editDistance(token, w);
      if (d <= (token.length >= 4 ? 2 : 1)) best = Math.min(best, 10 + d + Math.abs(token.length - w.length) / 10);
    }
    return best;
  };
  return (q) => {
    const tokens = norm(q).split(/\s+/).filter(Boolean);
    return rows.map((row, index) => {
      const text = norm(label(row)), words = text.split(' ');
      const moldWords = norm(row.mold).split(' ');
      const pos = moldOnly ? (t) => Math.max(0, moldWords.indexOf(t)) : (t) => words.indexOf(t);
      const s = tokens.map((t) => score1(t, text, words, pos));
      const counted = moldOnly ? moldWords : words;
      const unmatched = counted.filter((w) => !tokens.some((t) => w.startsWith(t) || editDistance(t, w) <= 1)).length;
      return { row, index, ok: s.every(Number.isFinite), score: s.reduce((a, b) => a + b, 0) + unmatched * 0.05, len: text.length };
    }).filter((r) => r.ok).sort((a, b) => a.score - b.score || a.len - b.len || a.index - b.index).slice(0, LIMIT).map((r) => r.row);
  };
}
const SOLVERS = {
  'app (fuzzyMoldOptions)': (q) => fuzzyMoldOptions(rows, q, label, LIMIT),
  // Candidate: same tolerance as the app, but a whole word beats a word that merely contains the token
  // ("zone" → Zone before Ozone Discs; "nova" → Nova before every Innova), and ties go to the shorter label.
  'whole word first': wholeWordFirst(normalize),
  // Same, with the catalog's special characters kept as meaning instead of erased (see normalize2).
  'whole word + specials': wholeWordFirst(normalize2, true),
  // Comparator: what the app would do with no typo tolerance (every token a substring, earliest position first).
  'substring only': (q) => {
    const tokens = normalize(q).split(/\s+/).filter(Boolean);
    return rows.map((row, index) => {
      const text = normalize(label(row));
      const at = tokens.map((t) => text.indexOf(t));
      return { row, index, ok: at.every((a) => a >= 0), score: at.reduce((s, a) => s + a, 0) };
    }).filter((r) => r.ok).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, LIMIT).map((r) => r.row);
  },
};

// ---- Queries, generated deterministically from the catalog.
let seed = 20261015;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];
const letters = 'abcdefghijklmnopqrstuvwxyz';
function typo(word) {
  const i = Math.floor(rand() * word.length);
  switch (Math.floor(rand() * 4)) {
    case 0: return word.slice(0, i) + pick(letters) + word.slice(i + 1);                 // substitute
    case 1: return word.slice(0, i) + word.slice(i + 1);                                  // drop
    case 2: return word.slice(0, i) + pick(letters) + word.slice(i);                      // insert
    default: return i < word.length - 1 ? word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2) : word.slice(0, -1); // swap
  }
}
const longMold = rows.filter((r) => normalize(r.mold).replace(/ /g, '').length >= 4);
const NEGATIVES = ['banana', 'window', 'pizza', 'keyboard', 'umbrella', 'tractor', 'violin', 'garden', 'pencil', 'blanket',
  'hamster', 'volcano', 'saddle', 'teacup', 'lantern', 'cabbage', 'mirror', 'parrot', 'helmet', 'bucket', 'ostrich', 'trumpet',
  'compass', 'noodle', 'cushion', 'walrus', 'magnet', 'pretzel', 'zipper', 'kettle'];

const cases = {
  'full label':        rows.map((r) => ({ q: `${r.manufacturer} ${r.mold}`, want: r.id })),
  'mold only':         rows.map((r) => ({ q: r.mold, want: r.id })),
  'mold, one typo':    longMold.map((r) => ({ q: typo(r.mold.toLowerCase()), want: r.id })),
  'maker + typo mold': longMold.map((r) => ({ q: `${r.manufacturer} ${typo(r.mold.toLowerCase())}`, want: r.id })),
  'lowercase, no space': rows.filter((r) => / /.test(r.mold)).map((r) => ({ q: r.mold.toLowerCase().replace(/ /g, ''), want: r.id })),
  // How people type the catalog's special-character molds (hand-written, 2026-10-15).
  'special characters': [
    ['roc+', 'innova--roc-plus'], ['roc plus', 'innova--roc-plus'], ['teebird+', 'innova--teebird-plus'], ['teebird plus', 'innova--teebird-plus'],
    ['xd+', 'innova--xd-plus'], ['xd plus', 'innova--xd-plus'], ['puttr', 'discraft--putt-r'], ["putt'r", 'discraft--putt-r'],
    ['xcaliber', 'innova--x-caliber'], ['x caliber', 'innova--x-caliber'], ['mx3', 'prodigy--mx-3'], ['mx-3', 'prodigy--mx-3'],
    ['alva', 'kastaplast--alva'], ['gote', 'kastaplast--gote'], ['jarn', 'kastaplast--jarn'], ['stal', 'kastaplast--stal'],
    ['#1 hyzer', 'lightning-discs--1-hyzer'], ['1 hyzer', 'lightning-discs--1-hyzer'], ['#2 upshot', 'lightning-discs--2-upshot'],
    ['talon claws', 'yikun--talon-claws'], ['aviar x', 'innova--aviar-x-jk'], ['serpent', 'reptilian-disc-golf--serpent'],
  ].map(([q, want]) => ({ q, want })),
  // First run found compass, walrus and magnet are real molds; drop any word that is one.
  'not in catalog':    NEGATIVES.filter((q) => !rows.some((r) => normalize(r.mold) === q)).map((q) => ({ q, want: null })),
};

// ---- Predictions, written before the first run.
const PREDICT = {
  'full label':          { top1: [0.95, 1] },
  'mold only':           { top1: [0.75, 0.95], shown: [0.98, 1] },
  'mold, one typo':      { top1: [0.5, 0.85] },
  'maker + typo mold':   { top1: [0.7, 0.95] },
  'lowercase, no space': { shown: [0, 0.3] },
  'not in catalog':      { empty: [0.3, 0.8] },
  keystrokes:            { median: [3, 6] },
  latencyMs:             { p95: [0, 8] },
};

function rankOf(result, want) { const i = result.findIndex((r) => r.id === want); return i < 0 ? Infinity : i + 1; }
function stats(solve, list) {
  let top1 = 0, top3 = 0, shown = 0, empty = 0, rr = 0;
  const misses = [];
  for (const { q, want } of list) {
    const res = solve(q);
    if (want === null) { if (res.length === 0) empty++; else misses.push({ q, got: res.slice(0, 3).map(label) }); continue; }
    const k = rankOf(res, want);
    if (k === 1) top1++; if (k <= 3) top3++; if (k <= LIMIT) { shown++; rr += 1 / k; }
    if (k !== 1 && misses.length < 400) misses.push({ q, want, rank: Number.isFinite(k) ? k : null, got: res.slice(0, 3).map(label) });
  }
  const n = list.length;
  return { n, top1: top1 / n, top3: top3 / n, shown: shown / n, mrr: rr / n, empty: empty / n, misses };
}
// Typing the mold one letter at a time: how many keystrokes until it is first? (Infinity = never, even fully typed.)
function keystrokes(solve) {
  const ks = rows.map((r) => {
    const q = r.mold;
    for (let i = 1; i <= q.length; i++) if (rankOf(solve(q.slice(0, i)), r.id) === 1) return { id: r.id, k: i, of: q.length };
    return { id: r.id, k: Infinity, of: q.length };
  });
  const finite = ks.filter((x) => Number.isFinite(x.k)).map((x) => x.k).sort((a, b) => a - b);
  return { median: finite[Math.floor(finite.length / 2)], never: ks.filter((x) => !Number.isFinite(x.k)).map((x) => x.id), fullyTyped: ks.filter((x) => x.k === x.of).length };
}
function latency(solve) {
  const qs = [...cases['mold only'], ...cases['mold, one typo']].map((c) => c.q).flatMap((q) => [q.slice(0, 1), q.slice(0, 3), q]);
  for (const q of qs.slice(0, 200)) solve(q); // warm up
  const t = qs.map((q) => { const a = performance.now(); solve(q); return performance.now() - a; }).sort((a, b) => a - b);
  return { calls: t.length, p50: t[Math.floor(t.length * 0.5)], p95: t[Math.floor(t.length * 0.95)], max: t[t.length - 1] };
}

const inside = (v, [lo, hi]) => v >= lo && v <= hi;
const results = { catalog: rows.length, limit: LIMIT, solvers: {} };
let surprises = 0;
for (const [name, solve] of Object.entries(SOLVERS)) {
  const out = { cases: {}, keystrokes: keystrokes(solve), latencyMs: latency(solve) };
  for (const [c, list] of Object.entries(cases)) out.cases[c] = stats(solve, list);
  out.cells = [];
  if (name.startsWith('app')) { // predictions are about the app's solver
    for (const [c, p] of Object.entries(PREDICT)) {
      const src = c === 'keystrokes' ? out.keystrokes : c === 'latencyMs' ? out.latencyMs : out.cases[c];
      for (const [metric, range] of Object.entries(p)) {
        const ok = inside(src[metric], range); if (!ok) surprises++;
        out.cells.push({ cell: `${c} · ${metric}`, value: src[metric], predicted: range, ok });
      }
    }
  }
  results.solvers[name] = out;
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out/results.json'), JSON.stringify(results, null, 1));

const pct = (v) => (v * 100).toFixed(1).padStart(5) + '%';
for (const [name, out] of Object.entries(results.solvers)) {
  console.log(`\n== ${name}`);
  console.log('case                  n    top1    top3   shown    MRR   empty');
  for (const [c, s] of Object.entries(out.cases)) console.log(`${c.padEnd(20)}${String(s.n).padStart(4)}  ${pct(s.top1)}  ${pct(s.top3)}  ${pct(s.shown)}  ${s.mrr.toFixed(3)}  ${pct(s.empty)}`);
  console.log(`keystrokes to first: median ${out.keystrokes.median}, never first ${out.keystrokes.never.length}, only when fully typed ${out.keystrokes.fullyTyped}`);
  console.log(`latency per call (ms, ${out.latencyMs.calls} calls): p50 ${out.latencyMs.p50.toFixed(3)} p95 ${out.latencyMs.p95.toFixed(3)} max ${out.latencyMs.max.toFixed(3)}`);
  for (const cell of out.cells) if (!cell.ok) console.log(`SURPRISE ${cell.cell}: ${typeof cell.value === 'number' ? cell.value.toFixed(3) : cell.value} not in [${cell.predicted}]`);
}
process.exit(surprises ? 1 : 0);
