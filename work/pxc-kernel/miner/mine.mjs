// Flow miner over kernel traces. Exact provenance (Refs with from) means a subflow is found by wiring, not by value matching.
// Usage: node miner/mine.mjs [outDir] [scratchDirForRenders]
// 1. Every render script runs with globalThis.__pxcObserve collecting receipts (the scripts' pictures go to a scratch dir).
// 2. For every call with children, every window of 2..12 consecutive sibling calls is a candidate subflow (drive ticks excluded).
// 3. A candidate counts if it is connected by internal edges and closed: every call except the window's sinks feeds a
//    call inside the window (no intermediate result escapes without also being used inside).
// 4. Candidates are grouped by shape (contracts in order + internal wiring + which inputs share an outside source),
//    counted by distinct concrete inputs (a repeated identical run counts once), and pruned when a longer shape
//    containing them occurs at least as often.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flowCandidateKey } from '../../../checkpoint/exp/operation-index/adapters.mjs';
import { normalizeKernelWindow } from '../../../checkpoint/exp/operation-index/kernel-window.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] ?? path.join(here, 'out'));
const scratch = path.resolve(process.argv[3] ?? '/tmp/pxc-miner-renders');
fs.mkdirSync(outDir, { recursive: true });

const ENTRIES = ['b-circuits', 'c-fitted', 'd-explain', 'e-game', 'f-agents', 'a', 'v02', 'v03', 'v04', 'v05', 'v06'];
const DOMAIN = new Set(['b-circuits', 'c-fitted', 'd-explain', 'e-game', 'f-agents', 'a']);
const seen = [];
let current = null;
globalThis.__pxcObserve = ({ world, receipt, implementations }) => seen.push({ entry: current, world, receipt, implementations });
const log = console.log; const err = console.error;
for (const e of ENTRIES) {
  current = e;
  const argv = process.argv.slice();
  process.argv[2] = path.join(scratch, e);
  console.log = () => {}; console.error = () => {};
  try { await import(path.join(here, '..', 'verify', `render-${e}.mjs`)); } catch (x) { err(`render-${e} failed: ${x.message}`); }
  console.log = log; console.error = err;
  process.argv = argv;
}
globalThis.__pxcObserve = undefined;

// ---------------------------------------------------------------- edges, by exact provenance
/** Base sources of a from: [{ kind, call?, port?, dashed }]. at/gather/test are looked through, as the view does. */
function bases(from, dashed = false) {
  if (!from) return [];
  if (from.kind === 'at') return bases(from.of, true);
  if (from.kind === 'gather') return from.pieces.flatMap((p) => bases(p.from, dashed));
  if (from.kind === 'test') return from.args.flatMap((a) => bases(a, dashed));
  if (from.kind === 'run') return [{ kind: 'run', dashed }];
  return [{ ...from, dashed }];
}

const shapes = new Map();
let windowsSeen = 0;
let tracesSeen = 0;
for (const { entry, world, receipt, implementations } of seen) {
  if (!receipt.trace) continue;
  tracesSeen += 1;
  const implsById = new Map(implementations().map((i) => [i.id, i]));
  (function visit(parent) {
    const kids = parent.calls.filter((c) => !c.error);
    for (let L = 2; L <= 12; L += 1) {
      for (let i = 0; i + L <= kids.length; i += 1) {
        const win = kids.slice(i, i + L);
        if (win.some((n) => n.tick !== undefined && n.tick !== null)) continue; // consecutive ticks are a drive, already a concept
        const idx = new Map(win.map((n, k) => [n.id, k]));
        windowsSeen += 1;
        const internal = []; const outside = new Map(); const ext = [];
        const feeds = new Array(L).fill(false);
        const uf = win.map((_, k) => k);
        const root = (k) => (uf[k] === k ? k : (uf[k] = root(uf[k])));
        win.forEach((n, k) => {
          for (const port of Object.keys(n.in).sort()) {
            for (const b of bases(n.in[port].from)) {
              if (b.kind === 'call' && idx.has(b.call)) {
                const j = idx.get(b.call);
                internal.push(`${j}.${b.port}${b.dashed ? '~' : ''}>${k}.${port}`);
                feeds[j] = true; uf[root(j)] = root(k);
              } else if (b.kind === 'input' || b.kind === 'call') {
                const src = `${b.kind}:${b.call}:${b.port}`;
                if (!outside.has(src)) outside.set(src, outside.size);
                ext.push(`x${outside.get(src)}>${k}.${port}`);
              } else ext.push(`${b.kind}>${k}.${port}`);
            }
          }
        });
        const connected = win.every((_, k) => root(k) === root(0));
        // sinks: calls whose outputs nobody inside reads; closed means only the last call(s) may be sinks
        const sinks = feeds.map((f, k) => (f ? null : k)).filter((k) => k !== null);
        const closed = connected && sinks.length === 1 && sinks[0] === L - 1;
        if (!closed) continue;
        const contracts = win.map((n) => n.contract + (n.slot ? `#${n.slot}` : ''));
        const sig = `${contracts.join(' → ')} | ${internal.sort().join(' ')} | ${ext.sort().join(' ')}`;
        const normalized = normalizeKernelWindow(win);
        const nameIndependentCandidateKey = flowCandidateKey(normalized);
        const concrete = win.map((n) => Object.values(n.in).map((p) => p.hash).join(',')).join(';');
        const parentImpl = implsById.get(parent.impl);
        const composed = Boolean(parentImpl?.assembly) && parentImpl.assembly.steps.map((s) => s.call).join(',').includes(win.map((n) => n.contract).join(','));
        if (!shapes.has(sig)) shapes.set(sig, { sig, contracts, internal: internal.sort(), ext: ext.sort(), nameIndependentCandidateKeys: new Set(), nameIndependentModes: new Set(), length: L, occurrences: new Set(), entries: new Set(), worlds: new Set(), parents: new Set(), composed: 0, examples: [] });
        const s = shapes.get(sig);
        s.nameIndependentCandidateKeys.add(nameIndependentCandidateKey);
        s.nameIndependentModes.add(nameIndependentCandidateKey.startsWith('semantic-candidate:') ? 'semantic-candidate' : 'structural-only');
        if (!s.occurrences.has(concrete)) {
          s.occurrences.add(concrete);
          if (composed) s.composed += 1;
          if (s.examples.length < 3) s.examples.push({ entry, world, run: receipt.runId, parent: `#${parent.id} ${parent.contract}`, calls: win.map((n) => `#${n.id}`) });
        }
        s.entries.add(entry); s.worlds.add(`${entry}/${world}`); s.parents.add(parent.contract);
      }
    }
    parent.calls.forEach(visit);
  })(receipt.trace);
}

// ---------------------------------------------------------------- prune and rank
const all = [...shapes.values()].map((s) => ({ ...s, count: s.occurrences.size }));
const contains = (big, small) => big.join('\u0001').includes(small.join('\u0001'));
for (const s of all) s.subsumedBy = all.find((t) => t.length > s.length && t.count >= s.count && contains(t.contracts, s.contracts))?.contracts.join(' → ') ?? null;
const ranked = all.filter((s) => !s.subsumedBy && s.count >= 2)
  .map((s) => ({ ...s, domainEntries: [...s.entries].filter((e) => DOMAIN.has(e)), score: s.count * (s.length - 1) * (1 + [...s.entries].filter((e) => DOMAIN.has(e)).length) }))
  .sort((a, b) => b.score - a.score);
const plain = (s) => ({ contracts: s.contracts, length: s.length, count: s.count, internal: s.internal, ext: s.ext, nameIndependentCandidateKeys: [...s.nameIndependentCandidateKeys].sort(), nameIndependentModes: [...s.nameIndependentModes].sort(), entries: [...s.entries], domainEntries: s.domainEntries,
  parents: [...s.parents].slice(0, 6), alreadyComposed: s.composed, composedShare: Number((s.composed / s.count).toFixed(2)), score: s.score, examples: s.examples });
const discovered = ranked.filter((s) => s.composed === 0);
const confirmed = ranked.filter((s) => s.composed > 0);
const report = {
  discovered: discovered.slice(0, 20).map(plain),
  confirmed: confirmed.slice(0, 20).map(plain),
  receipts: seen.length, traces: tracesSeen, windows: windowsSeen, shapes: shapes.size, closedShapesSeenTwice: all.filter((s) => s.count >= 2).length,
  afterPruning: ranked.length,
  crossEntry: ranked.filter((s) => s.domainEntries.length >= 2).map(plain),
  top: ranked.slice(0, 30).map(plain),
  byEntry: Object.fromEntries([...DOMAIN].map((e) => [e, ranked.filter((s) => s.domainEntries.includes(e)).slice(0, 6).map(plain)])),
};
fs.writeFileSync(path.join(outDir, 'flows.json'), JSON.stringify(report, null, 2));
log(JSON.stringify({ receipts: report.receipts, traces: report.traces, windows: report.windows, shapes: report.shapes, closedShapesSeenTwice: report.closedShapesSeenTwice, afterPruning: report.afterPruning, crossEntry: report.crossEntry.length }));
log('DISCOVERED (recurring, not a composition anywhere):');
for (const s of report.discovered.slice(0, 12)) log(`${String(s.count).padStart(5)}× L${s.length} [${s.domainEntries.join(',') || s.entries.join(',')}] parents ${s.parents.slice(0, 3).join(', ')}  ${s.contracts.join(' → ')}`);
log('CONFIRMED (recurring and already declared as a composition):');
for (const s of report.confirmed.slice(0, 8)) log(`${String(s.count).padStart(5)}× L${s.length} [${s.domainEntries.join(',') || s.entries.join(',')}] composed ${s.alreadyComposed}/${s.count}  ${s.contracts.join(' → ')}`);
log('CROSS-ENTRY:');
for (const s of report.crossEntry) log(`${String(s.count).padStart(5)}× [${s.domainEntries.join(',')}] ${s.contracts.join(' → ')}`);
if (false) for (const s of report.top.slice(0, 15)) log(`${String(s.count).padStart(4)}× L${s.length} [${s.domainEntries.join(',') || s.entries.join(',')}] composed ${s.alreadyComposed}/${s.count}  ${s.contracts.join(' → ')}`);
