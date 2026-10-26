// Seeded, deterministic generator: walks FRAMES x terminals x DEPARTURES to make one Case per deliberate departure,
// plus seeded pairs of compatible departures. Same seed -> same bytes.
import { FRAMES, typeProblems, checkExpectations, defaultValue } from './frames.mjs';
import { Scene, baseline } from './scene.mjs';
import { DEPARTURES, BASELINE } from './departures.mjs';
import { indexWorld } from './world.mjs';
import { mulberry32, fnv32, deepEqual } from './util.mjs';
import { calculation, guarantee, runCalculation } from './calc.mjs';

export function enumerateCases(seed) {
  const entries = [{ slug: 'baseline', kind: 'baseline', title: BASELINE.title, parts: [{ key: 'ALL', dep: BASELINE }] }];
  const pool = [];
  for (const key of Object.keys(DEPARTURES)) {
    const [frame, terminal] = key.split('.');
    if (!FRAMES[frame]?.terminals[terminal]) throw new Error(`departure key ${key} names no frame terminal`);
  }
  for (const [frameId, frame] of Object.entries(FRAMES)) {
    for (const terminal of Object.keys(frame.terminals)) {
      for (const dep of DEPARTURES[`${frameId}.${terminal}`] ?? []) {
        const key = `${frameId}.${terminal}`;
        entries.push({ slug: `${key}:${dep.id}`, kind: dep.kind, title: dep.title, parts: [{ key, dep }] });
        if (dep.pool) pool.push({ key, dep });
      }
    }
  }
  // seeded pairs: compatible = disjoint touched terminals / scene tokens
  const rng = mulberry32(fnv32(`${seed}:pairs`));
  const pairs = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const A = pool[i].dep, B = pool[j].dep;
    const clash = A.touches.some((t) => B.touches.includes(t) || B.reads.includes(t)) || B.touches.some((t) => A.reads.includes(t));
    if (!clash && pool[i].key !== pool[j].key) pairs.push([pool[i], pool[j]]);
  }
  for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
  const used = {};
  let chosen = 0;
  for (const [p, q] of pairs) {
    if (chosen >= 10) break;
    if ((used[p.dep.id] ?? 0) >= 2 || (used[q.dep.id] ?? 0) >= 2) continue;
    used[p.dep.id] = (used[p.dep.id] ?? 0) + 1; used[q.dep.id] = (used[q.dep.id] ?? 0) + 1; chosen++;
    entries.push({ slug: `${p.key}:${p.dep.id}+${q.key}:${q.dep.id}`, kind: 'combination', title: `${p.dep.title} — together with — ${q.dep.title.charAt(0).toLowerCase()}${q.dep.title.slice(1)}`, parts: [p, q] });
  }
  return entries.map((e, n) => ({ ...e, id: `c${String(n).padStart(2, '0')}`, index: n }));
}

export function buildCase(seed, entry) {
  const s = new Scene(entry.id, mulberry32(fnv32(`${seed}:${entry.slug}`)));
  baseline(s);
  for (const part of entry.parts) part.dep.apply(s);
  const { instances, departures, keys } = s.finish();
  const meta = {
    id: entry.id, slug: entry.slug, kind: entry.kind, title: entry.title,
    parts: entry.parts.map((p) => ({ frameTerminal: p.key, departure: p.dep.id, kind: p.dep.kind, title: p.dep.title, focus: p.dep.focus ?? null })),
    departures, keys, params: s.p,
  };
  return { meta, instances };
}

export const generateCalc = calculation({
  id: 'thro.go.generate',
  description: 'Generate one Case (a fragment of frame instances) by varying terminals away from their defaults.',
  calculate: (entry) => {
    const { meta, instances } = buildCase(entry.seed, entry.entry);
    return { output: { meta, instances } };
  },
  guarantees: [
    guarantee('types-and-references', 'Every terminal value has its declared type and every reference resolves to an instance of the right frame.', (it) => { const p = typeProblems(indexWorld(it.output.instances)); return p.length ? p.slice(0, 2).join('; ') : true; }),
    guarantee('no-hard-violations', 'No hard expectation (mismatch = null) is violated: the generator never produces invalid data, only situations to handle.', (it) => { const v = checkExpectations(indexWorld(it.output.instances)).filter((x) => x.mismatch === null); return v.length ? v.map((x) => `${x.instanceId}#${x.expectationId}`).join(', ') : true; }),
    guarantee('departures-leave-defaults', 'Every recorded departure really changes the terminal, and away from its default (a wired reference may return to unwired).', (it) => { const bad = it.output.meta.departures.filter((d) => d.terminal && (deepEqual(d.to, d.from) || (!FRAMES[d.frame].terminals[d.terminal].type.startsWith('ref') && deepEqual(d.to, d.default)))); return bad.length ? bad.map((d) => `${d.instanceId}.${d.terminal}`).join(', ') : true; }),
    guarantee('departures-name-real-terminals', 'Every departure names a terminal that exists on its frame.', (it) => { const bad = it.output.meta.departures.filter((d) => d.terminal && !FRAMES[d.frame].terminals[d.terminal]); return bad.length ? 'bad' : true; }),
    guarantee('ids-unique-and-scoped', 'Instance ids are unique and prefixed by their Case id.', (it) => { const ids = it.output.instances.map((i) => i.id); return new Set(ids).size === ids.length && ids.every((i) => i.startsWith(`${it.output.meta.id}.`)) ? true : 'duplicate or unscoped id'; }),
    guarantee('at-least-one-departure', 'Every non-baseline Case departs from a default at least once.', (it) => it.output.meta.kind === 'baseline' || it.output.meta.departures.length > 0 ? true : 'no departure'),
  ],
});

export function generateWorld(seed) {
  const entries = enumerateCases(seed);
  const report = runCalculation(generateCalc, entries.map((e) => ({ name: e.id, seed, entry: e })));
  const cases = entries.map((e) => report.outputs[e.id].meta);
  const instances = entries.flatMap((e) => report.outputs[e.id].instances);
  delete report.outputs;
  return { world: { schema: 'thro-go-toy-world@1', seed, caseCount: cases.length, cases, instances }, report };
}
