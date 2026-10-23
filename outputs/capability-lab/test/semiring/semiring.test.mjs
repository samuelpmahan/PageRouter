// Semirings, checked independently of the implementation: paths are enumerated by brute force (every walk of length k, read
// edge by edge) and compared with the product; the semiring laws are checked on seeded random graphs; bad inputs fail; inputs
// are not mutated; compositions trace their calls; provenance behaves as deletion propagation says it must.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/runtime/index.mjs';
import { capabilities, semiringProduct, semiringAdd } from '../../src/semiring/index.mjs';

const registry = createRegistry(capabilities, { source: 'capability-lab', version: '1' });
const run = (id, input) => registry.execute(id, input).result;

// A seeded generator, so every random graph is reproducible (mulberry32).
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function randomGraph(random, n, density, semiring) {
  const list = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (random() < density) {
    const e = { from: i, to: j };
    if (semiring === 'counting') e.weight = 1 + Math.floor(random() * 3);
    if (semiring === 'tropical') e.weight = Math.floor(random() * 9);
    if (semiring === 'viterbi') e.weight = [0.25, 0.5, 0.75, 1][Math.floor(random() * 4)];
    if (semiring === 'lineage') e.labels = [`x${Math.floor(random() * 4)}`];
    list.push(e);
  }
  return list;
}
// Brute force: walk every sequence of k edges, multiply along the walk with plain arithmetic, combine walks per pair.
function walks(list, n, k, semiring) {
  const out = new Map(), adj = Array.from({ length: n }, () => []);
  for (const e of list) adj[e.from].push(e);
  const val = e => (semiring === 'lineage' ? new Set(e.labels ?? []) : semiring === 'boolean' ? true : e.weight ?? (semiring === 'tropical' ? 0 : 1));
  const times = (a, b) => (semiring === 'counting' || semiring === 'viterbi' ? a * b : semiring === 'tropical' ? a + b : semiring === 'boolean' ? a && b : new Set([...a, ...b]));
  const plus = (a, b) => (semiring === 'counting' ? a + b : semiring === 'tropical' ? Math.min(a, b) : semiring === 'viterbi' ? Math.max(a, b) : semiring === 'boolean' ? a || b : new Set([...a, ...b]));
  const go = (start, at, steps, acc) => {
    if (steps === 0) { const key = `${start},${at}`; out.set(key, out.has(key) ? plus(out.get(key), acc) : acc); return; }
    for (const e of adj[at]) go(start, e.to, steps - 1, acc === null ? val(e) : times(acc, val(e)));
  };
  for (let s = 0; s < n; s++) go(s, s, k, null);
  return out;
}
const asMap = (list, semiring) => new Map(list.map(e => [`${e.from},${e.to}`, semiring === 'lineage' ? new Set(e.labels) : semiring === 'boolean' ? true : e.weight]));
const same = (a, b, semiring) => {
  const drop = v => (semiring === 'counting' || semiring === 'viterbi') && v === 0;
  const keys = new Set([...a.keys(), ...b.keys()].filter(k => !(drop(a.get(k) ?? 0) && drop(b.get(k) ?? 0))));
  for (const k of keys) {
    const x = a.get(k), y = b.get(k);
    if (semiring === 'lineage') { if (!x || !y || [...x].sort().join() !== [...y].sort().join()) return `${k}: ${x && [...x]} vs ${y && [...y]}`; }
    else if (x === undefined || y === undefined || Math.abs(x - y) > 1e-12) return `${k}: ${x} vs ${y}`;
  }
  return null;
};

test('the product of A with itself equals every two- and three-step walk, enumerated by brute force, in all five semirings', () => {
  for (const semiring of ['boolean', 'counting', 'tropical', 'viterbi', 'lineage']) {
    const random = rng(7 + semiring.length);
    for (let trial = 0; trial < 20; trial++) {
      const n = 2 + Math.floor(random() * 4), a = randomGraph(random, n, 0.45, semiring);
      const two = run('semiring.product', { semiring, size: n, left: a, right: a }).product;
      assert.equal(same(asMap(two, semiring), walks(a, n, 2, semiring), semiring), null, `${semiring} A² trial ${trial}`);
      const three = run('semiring.power', { semiring, size: n, edges: a, k: 3 }).power;
      assert.equal(same(asMap(three, semiring), walks(a, n, 3, semiring), semiring), null, `${semiring} A³ trial ${trial}`);
    }
  }
});

test('semiring laws hold on seeded random graphs: ⊗ associative, ⊕ commutative, ⊗ distributes over ⊕', () => {
  for (const semiring of ['boolean', 'counting', 'tropical', 'lineage']) { // viterbi omitted: floating products are associative only up to roundoff
    const random = rng(42 + semiring.length);
    for (let trial = 0; trial < 15; trial++) {
      const n = 2 + Math.floor(random() * 3), [a, b, c] = [0, 1, 2].map(() => randomGraph(random, n, 0.5, semiring));
      const P = (l, r) => semiringProduct({ semiring, size: n, left: l, right: r }).product, S = (l, r) => semiringAdd({ semiring, size: n, left: l, right: r }).sum;
      assert.deepEqual(P(P(a, b), c), P(a, P(b, c)), `${semiring} associativity`);
      assert.deepEqual(S(a, b), S(b, a), `${semiring} commutativity`);
      assert.deepEqual(P(a, S(b, c)), S(P(a, b), P(a, c)), `${semiring} left distributivity`);
    }
  }
});

test('closure finds reachability, path counts and cheapest routes that match a direct search', () => {
  const costs = [{ from: 0, to: 1, weight: 4 }, { from: 1, to: 2, weight: 1 }, { from: 0, to: 2, weight: 7 }, { from: 2, to: 3, weight: 2 }, { from: 1, to: 3, weight: 6 }];
  // Bellman-Ford style relaxation, written separately from the product.
  const dist = [0, Infinity, Infinity, Infinity];
  for (let i = 0; i < 3; i++) for (const e of costs) dist[e.to] = Math.min(dist[e.to], dist[e.from] + e.weight);
  const closure = run('semiring.closure', { semiring: 'tropical', size: 4, edges: costs, steps: 3 }).closure;
  for (const to of [1, 2, 3]) assert.equal(closure.find(e => e.from === 0 && e.to === to).weight, dist[to]);
  const reach = run('semiring.closure', { semiring: 'boolean', size: 4, edges: costs.map(({ from, to }) => ({ from, to })), steps: 3 }).closure;
  assert.equal(reach.some(e => e.from === 3), false, 'node 3 reaches nothing');
});

test('bad matrices fail clearly and inputs are not mutated', () => {
  assert.throws(() => run('semiring.product', { semiring: 'counting', size: 2, left: [{ from: 0, to: 2 }], right: [] }), /outside a 2×2/);
  assert.throws(() => run('semiring.add', { semiring: 'counting', size: 2, left: [{ from: 0, to: 1 }, { from: 0, to: 1 }], right: [] }), /twice/);
  assert.throws(() => run('semiring.product', { semiring: 'viterbi', size: 2, left: [{ from: 0, to: 1, weight: 1.5 }], right: [] }), /probability/);
  assert.throws(() => run('semiring.product', { semiring: 'tropical', size: 1, left: [{ from: 0, to: 0, labels: ['x'] }], right: [] }), /only lineage/);
  assert.throws(() => run('semiring.product', { semiring: 'max-plus', size: 1, left: [], right: [] }));
  const left = [{ from: 0, to: 1, weight: 2 }], snapshot = JSON.stringify(left);
  semiringProduct({ semiring: 'counting', size: 2, left, right: left });
  assert.equal(JSON.stringify(left), snapshot);
});

test('compositions call the atoms, and the trace shows it', () => {
  const execution = registry.execute('semiring.closure', { semiring: 'counting', size: 2, edges: [{ from: 0, to: 1 }], steps: 2 });
  const called = execution.trace.calls.map(c => c.id ?? c.capabilityId);
  assert.deepEqual(called, ['semiring.product', 'semiring.add', 'semiring.product', 'semiring.add']);
  assert.equal(registry.get('semiring.closure').order, 1);
  assert.equal(registry.get('provenance.evaluate').order, 1);
});

test('provenance: deleting an input deletes exactly the ways that used it, and the cheapest way is the one reported', () => {
  const pose = [['corner', 'rectangle'], ['edge1', 'edge2', 'rectangle'], ['anchor', 'map']];
  const all = ['corner', 'rectangle', 'edge1', 'edge2', 'anchor', 'map'];
  const derived = without => run('provenance.evaluate', { semiring: 'boolean', polynomial: pose, values: all.filter(v => !without.includes(v)).map(variable => ({ variable })) }).value.present;
  assert.equal(derived([]), true);
  assert.equal(derived(['corner']), true, 'the edges still derive it');
  assert.equal(derived(['rectangle']), true, 'the anchor and the map still derive it');
  assert.equal(derived(['rectangle', 'anchor']), false, 'no rectangle and no anchor: no way left');
  const ways = without => run('provenance.evaluate', { semiring: 'counting', polynomial: pose, values: all.filter(v => !without.includes(v)).map(variable => ({ variable })) }).value;
  assert.deepEqual(ways(['corner']), { present: true, weight: 2 });
  assert.deepEqual(ways(['rectangle']), { present: true, weight: 1 }, 'only the anchor way survives losing the rectangle');
  const costs = { corner: 30, rectangle: 0, edge1: 40, edge2: 40, anchor: 120, map: 5 };
  const result = run('provenance.evaluate', { semiring: 'tropical', polynomial: pose, values: Object.entries(costs).map(([variable, weight]) => ({ variable, weight })) });
  const cheapest = Math.min(...pose.map(m => m.reduce((sum, v) => sum + costs[v], 0)));
  assert.equal(result.value.weight, cheapest);
  assert.deepEqual(result.terms.find(t => t.value.weight === cheapest).monomial, ['corner', 'rectangle']);
});
