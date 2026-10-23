// Semirings: one matrix product, many meanings (claude-ed for Sam, 23 Oct 2026; a reference implementation, first use).
// A square matrix over a semiring is a weighted graph, stored as its edge list: an absent edge IS the semiring's zero, so
// "no path" needs no Infinity (which JSON cannot hold). Changing the semiring changes what the same product means:
//   boolean   (or, and)        reachability          one = present
//   counting  (+, ×)           number of paths       weight defaults to 1
//   tropical  (min, +)         cheapest path         weight = cost; one = 0
//   viterbi   (max, ×)         most reliable path    weight in [0, 1]; one = 1
//   lineage   (∪, ∪)           which inputs it used  labels; one = no labels
// Atoms: semiring.add (⊕ entrywise) and semiring.product (⊗, the matrix product). Composed on them: semiring.power,
// semiring.closure (every path up to n steps) and provenance.evaluate (a sum of products of named inputs: + for "another
// way", × for "used together"; Green, Karvounarakis & Tannen, Provenance Semirings, 2007), evaluated as 1×1 matrices so
// provenance genuinely runs on the same product as the graphs.

const SEMIRINGS = Object.freeze(['boolean', 'counting', 'tropical', 'viterbi', 'lineage']);
const semiringSchema = { type: 'string', enum: [...SEMIRINGS] };
const edge = {
  type: 'object',
  properties: {
    from: { type: 'integer', minimum: 0 },
    to: { type: 'integer', minimum: 0 },
    weight: { type: 'number' },
    labels: { type: 'array', items: { type: 'string' } },
  },
  required: ['from', 'to'],
  additionalProperties: false,
};
const edges = { type: 'array', items: edge };
const size = { type: 'integer', minimum: 1, maximum: 256 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const valueSchema = object({ present: { type: 'boolean' }, weight: { type: 'number' }, labels: { type: 'array', items: { type: 'string' } } }, ['present']);

// ---- The algebra, as data: zero is "absent"; each semiring says how to read an entry, combine two, and write one back.
const ALGEBRA = Object.freeze({
  boolean: { read: () => true, plus: (a, b) => a || b, times: (a, b) => a && b, one: true, write: () => ({}) },
  counting: { read: e => e.weight ?? 1, plus: (a, b) => a + b, times: (a, b) => a * b, one: 1, write: w => ({ weight: w }), drop: w => w === 0 },
  tropical: { read: e => e.weight ?? 0, plus: Math.min, times: (a, b) => a + b, one: 0, write: w => ({ weight: w }) },
  viterbi: { read: e => e.weight ?? 1, plus: Math.max, times: (a, b) => a * b, one: 1, write: w => ({ weight: w }), drop: w => w === 0 },
  lineage: { read: e => [...new Set(e.labels ?? [])].sort(), plus: (a, b) => [...new Set([...a, ...b])].sort(), times: (a, b) => [...new Set([...a, ...b])].sort(), one: [], write: l => ({ labels: l }) },
});

function check(semiring, n, list, name) {
  for (const e of list) {
    if (e.from >= n || e.to >= n) throw new Error(`${name} has an edge ${e.from}→${e.to} outside a ${n}×${n} matrix`);
    if (semiring === 'viterbi' && e.weight !== undefined && (e.weight < 0 || e.weight > 1)) throw new Error(`${name}: a viterbi weight is a probability in [0, 1]`);
    if (semiring === 'lineage' && e.weight !== undefined) throw new Error(`${name}: lineage entries carry labels, not weights`);
    if (semiring !== 'lineage' && e.labels !== undefined) throw new Error(`${name}: only lineage entries carry labels`);
  }
  const seen = new Set();
  for (const e of list) { const key = `${e.from},${e.to}`; if (seen.has(key)) throw new Error(`${name} lists the entry ${key} twice`); seen.add(key); }
}
const toMap = (semiring, list) => new Map(list.map(e => [`${e.from},${e.to}`, ALGEBRA[semiring].read(e)]));
function toEdges(semiring, map) {
  const a = ALGEBRA[semiring];
  return [...map].filter(([, v]) => !(a.drop?.(v)))
    .map(([key, v]) => { const [from, to] = key.split(',').map(Number); return { from, to, ...a.write(v) }; })
    .sort((x, y) => x.from - y.from || x.to - y.to);
}

/** ⊕ entrywise: a + b for every entry; an entry absent from one side is that side's zero. */
export function semiringAdd({ semiring, size: n, left, right }) {
  check(semiring, n, left, 'left'); check(semiring, n, right, 'right');
  const a = ALGEBRA[semiring], out = toMap(semiring, left);
  for (const [key, v] of toMap(semiring, right)) out.set(key, out.has(key) ? a.plus(out.get(key), v) : v);
  return { sum: toEdges(semiring, out) };
}
/** ⊗, the matrix product: (L ⊗ R)[i][j] = ⊕ over k of L[i][k] ⊗ R[k][j]; for graphs, every two-step path i → k → j. */
export function semiringProduct({ semiring, size: n, left, right }) {
  check(semiring, n, left, 'left'); check(semiring, n, right, 'right');
  const a = ALGEBRA[semiring], byFrom = new Map(), out = new Map();
  for (const e of right) { if (!byFrom.has(e.from)) byFrom.set(e.from, []); byFrom.get(e.from).push(e); }
  for (const l of left) {
    for (const r of byFrom.get(l.to) ?? []) {
      const key = `${l.from},${r.to}`, v = a.times(a.read(l), a.read(r));
      out.set(key, out.has(key) ? a.plus(out.get(key), v) : v);
    }
  }
  return { product: toEdges(semiring, out) };
}
const identity = (semiring, n) => Array.from({ length: n }, (_, i) => ({ from: i, to: i, ...ALGEBRA[semiring].write(ALGEBRA[semiring].one) }));

const pairInput = object({ semiring: semiringSchema, size, left: edges, right: edges });
const graph = [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 0, to: 2 }, { from: 2, to: 3 }, { from: 1, to: 3 }];
const costs = [{ from: 0, to: 1, weight: 4 }, { from: 1, to: 2, weight: 1 }, { from: 0, to: 2, weight: 7 }, { from: 2, to: 3, weight: 2 }, { from: 1, to: 3, weight: 6 }];
const trust = [{ from: 0, to: 1, weight: 0.9 }, { from: 1, to: 3, weight: 0.8 }, { from: 0, to: 2, weight: 0.5 }, { from: 2, to: 3, weight: 1 }];

export const capabilities = [
  {
    id: 'semiring.add',
    title: 'Semiring sum of two matrices',
    description: 'Combine two weighted graphs on the same nodes entry by entry with the semiring\'s ⊕ (or, +, min, max or union): two alternative routes become one entry.',
    kind: 'atomic', dependsOn: [],
    inputSchema: pairInput, outputSchema: object({ sum: edges }),
    formula: '(L ⊕ R)[i][j] = L[i][j] ⊕ R[i][j]; an absent entry is the semiring zero',
    caveats: ['Matrices are edge lists; an absent entry is zero (false, 0, +∞, 0 or no lineage).', 'An entry may appear once per matrix.'],
    examples: [
      { input: { semiring: 'tropical', size: 2, left: [{ from: 0, to: 1, weight: 5 }], right: [{ from: 0, to: 1, weight: 3 }, { from: 1, to: 0, weight: 2 }] }, expected: { sum: [{ from: 0, to: 1, weight: 3 }, { from: 1, to: 0, weight: 2 }] } },
      { input: { semiring: 'counting', size: 2, left: [{ from: 0, to: 1, weight: 2 }], right: [{ from: 0, to: 1, weight: 3 }] }, expected: { sum: [{ from: 0, to: 1, weight: 5 }] } },
      { input: { semiring: 'lineage', size: 1, left: [{ from: 0, to: 0, labels: ['corner'] }], right: [{ from: 0, to: 0, labels: ['edges'] }] }, expected: { sum: [{ from: 0, to: 0, labels: ['corner', 'edges'] }] } },
    ],
    run: semiringAdd,
  },
  {
    id: 'semiring.product',
    title: 'Semiring matrix product',
    description: 'Multiply two weighted graphs: every two-step path i → k → j, combined with ⊗ along the path and ⊕ across paths. The same product counts paths, finds reachability, cheapest or most reliable paths, or which inputs were used, depending only on the semiring.',
    kind: 'atomic', dependsOn: [],
    inputSchema: pairInput, outputSchema: object({ product: edges }),
    formula: '(L ⊗ R)[i][j] = ⊕ₖ L[i][k] ⊗ R[k][j]',
    caveats: ['Sparse: work grows with the edges, not n³.', 'Floating-point sums and products follow IEEE-754; tropical and viterbi examples use exactly representable values.'],
    examples: [
      // 0→1→2, 0→1→3, 0→2→3, 1→2→3: paths of exactly two steps, counted by hand.
      { input: { semiring: 'counting', size: 4, left: graph, right: graph }, expected: { product: [{ from: 0, to: 2, weight: 1 }, { from: 0, to: 3, weight: 2 }, { from: 1, to: 3, weight: 1 }] } },
      // Cheapest two-step routes: 0→1→2 = 5, 0→2→3 = 9 beats 0→1→3 = 10, 1→2→3 = 3.
      { input: { semiring: 'tropical', size: 4, left: costs, right: costs }, expected: { product: [{ from: 0, to: 2, weight: 5 }, { from: 0, to: 3, weight: 9 }, { from: 1, to: 3, weight: 3 }] } },
      // Most reliable two-step route 0→3: 0.9 × 0.8 = 0.72 beats 0.5 × 1.
      { input: { semiring: 'viterbi', size: 4, left: trust, right: trust }, expected: { product: [{ from: 0, to: 3, weight: 0.7200000000000001 }] } },
      { input: { semiring: 'boolean', size: 3, left: [{ from: 0, to: 1 }], right: [{ from: 1, to: 2 }] }, expected: { product: [{ from: 0, to: 2 }] } },
    ],
    run: semiringProduct,
  },
  {
    id: 'semiring.power',
    title: 'Paths of exactly k steps',
    description: 'Raise a weighted graph to the k-th power with the semiring product: every path of exactly k steps, combined as the semiring says.',
    kind: 'composed', dependsOn: ['semiring.product'],
    inputSchema: object({ semiring: semiringSchema, size, edges, k: { type: 'integer', minimum: 1, maximum: 64 } }),
    outputSchema: object({ power: edges }),
    formula: 'Aᵏ = I ⊗ A ⊗ … ⊗ A (k factors of A)',
    examples: [
      { input: { semiring: 'counting', size: 4, edges: graph, k: 3 }, expected: { power: [{ from: 0, to: 3, weight: 1 }] } },
      { input: { semiring: 'tropical', size: 4, edges: costs, k: 3 }, expected: { power: [{ from: 0, to: 3, weight: 7 }] } },
    ],
    run: ({ semiring, size: n, edges: a, k }, ctx) => {
      let power = identity(semiring, n);
      for (let i = 0; i < k; i++) power = ctx.call('semiring.product', { semiring, size: n, left: power, right: a }).product;
      return { power };
    },
  },
  {
    id: 'semiring.closure',
    title: 'Every path up to n steps',
    description: 'Combine all paths of 1 to n steps with ⊕: reachability, the number of paths, the cheapest or the most reliable path between every pair of nodes.',
    kind: 'composed', dependsOn: ['semiring.product', 'semiring.add'],
    inputSchema: object({ semiring: semiringSchema, size, edges, steps: { type: 'integer', minimum: 1, maximum: 64 } }),
    outputSchema: object({ closure: edges }),
    formula: 'A ⊕ A² ⊕ … ⊕ Aⁿ',
    examples: [
      { input: { semiring: 'boolean', size: 4, edges: graph, steps: 3 }, expected: { closure: [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 0, to: 3 }, { from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 3 }] } },
      // All routes 0→3: 0→1→2→3 = 7, 0→2→3 = 9, 0→1→3 = 10; cheapest 7.
      { input: { semiring: 'tropical', size: 4, edges: costs, steps: 3 }, expected: { closure: [{ from: 0, to: 1, weight: 4 }, { from: 0, to: 2, weight: 5 }, { from: 0, to: 3, weight: 7 }, { from: 1, to: 2, weight: 1 }, { from: 1, to: 3, weight: 3 }, { from: 2, to: 3, weight: 2 }] } },
      // Paths 0→3: 0→1→3, 0→2→3, 0→1→2→3.
      { input: { semiring: 'counting', size: 4, edges: graph, steps: 3 }, expected: { closure: [{ from: 0, to: 1, weight: 1 }, { from: 0, to: 2, weight: 2 }, { from: 0, to: 3, weight: 3 }, { from: 1, to: 2, weight: 1 }, { from: 1, to: 3, weight: 2 }, { from: 2, to: 3, weight: 1 }] } },
    ],
    run: ({ semiring, size: n, edges: a, steps }, ctx) => {
      let power = identity(semiring, n), closure = [];
      for (let i = 0; i < steps; i++) {
        power = ctx.call('semiring.product', { semiring, size: n, left: power, right: a }).product;
        closure = ctx.call('semiring.add', { semiring, size: n, left: closure, right: power }).sum;
      }
      return { closure };
    },
  },
  {
    id: 'provenance.evaluate',
    title: 'Evaluate a provenance polynomial',
    description: 'A derived fact carries a sum of products of the inputs it came from: × for inputs used together, + for another way to the same fact. Evaluate it in any semiring: is it derived, in how many ways, at what least cost, with what best confidence, from which inputs. Each product is also reported, so the winning way is visible.',
    kind: 'composed', dependsOn: ['semiring.product', 'semiring.add'],
    inputSchema: object({
      semiring: semiringSchema,
      polynomial: { type: 'array', minItems: 1, items: { type: 'array', minItems: 1, items: { type: 'string' } } },
      values: { type: 'array', items: object({ variable: { type: 'string' }, weight: { type: 'number' }, labels: { type: 'array', items: { type: 'string' } } }, ['variable']) },
    }),
    outputSchema: object({ value: valueSchema, terms: { type: 'array', items: object({ monomial: { type: 'array', items: { type: 'string' } }, value: valueSchema }) } }),
    formula: 'p = Σᵢ Πⱼ xᵢⱼ, each x read as a 1×1 matrix; a variable without a value is the semiring zero',
    caveats: ['A variable with no value is absent (false, 0, +∞, 0 or no lineage), so a product using it vanishes.', 'Values: weight for counting, tropical and viterbi; labels for lineage; presence alone for boolean.'],
    examples: [
      // Sam's tee pad: the pose from a corner of the known rectangle, or from two edges of it, or from the basket anchor and the course map.
      { input: { semiring: 'tropical', polynomial: [['corner', 'rectangle'], ['edge1', 'edge2', 'rectangle'], ['anchor', 'map']], values: [{ variable: 'corner', weight: 30 }, { variable: 'rectangle', weight: 0 }, { variable: 'edge1', weight: 40 }, { variable: 'edge2', weight: 40 }, { variable: 'anchor', weight: 120 }, { variable: 'map', weight: 5 }] },
        expected: { value: { present: true, weight: 30 }, terms: [{ monomial: ['corner', 'rectangle'], value: { present: true, weight: 30 } }, { monomial: ['edge1', 'edge2', 'rectangle'], value: { present: true, weight: 80 } }, { monomial: ['anchor', 'map'], value: { present: true, weight: 125 } }] } },
      // Without a corner the pose is still derived, through the two edges.
      { input: { semiring: 'boolean', polynomial: [['corner', 'rectangle'], ['edge1', 'edge2', 'rectangle']], values: [{ variable: 'rectangle' }, { variable: 'edge1' }, { variable: 'edge2' }] },
        expected: { value: { present: true }, terms: [{ monomial: ['corner', 'rectangle'], value: { present: false } }, { monomial: ['edge1', 'edge2', 'rectangle'], value: { present: true } }] } },
      { input: { semiring: 'counting', polynomial: [['corner', 'rectangle'], ['edge1', 'edge2', 'rectangle'], ['anchor', 'map']], values: [{ variable: 'corner' }, { variable: 'rectangle' }, { variable: 'edge1' }, { variable: 'edge2' }, { variable: 'anchor' }, { variable: 'map' }] },
        expected: { value: { present: true, weight: 3 }, terms: [{ monomial: ['corner', 'rectangle'], value: { present: true, weight: 1 } }, { monomial: ['edge1', 'edge2', 'rectangle'], value: { present: true, weight: 1 } }, { monomial: ['anchor', 'map'], value: { present: true, weight: 1 } }] } },
      { input: { semiring: 'lineage', polynomial: [['corner', 'rectangle'], ['anchor', 'map']], values: [{ variable: 'corner', labels: ['frame 12'] }, { variable: 'rectangle', labels: ['tee spec'] }, { variable: 'anchor', labels: ['frame 12'] }, { variable: 'map', labels: ['course 7'] }] },
        expected: { value: { present: true, labels: ['course 7', 'frame 12', 'tee spec'] }, terms: [{ monomial: ['corner', 'rectangle'], value: { present: true, labels: ['frame 12', 'tee spec'] } }, { monomial: ['anchor', 'map'], value: { present: true, labels: ['course 7', 'frame 12'] } }] } },
    ],
    run: ({ semiring, polynomial, values }, ctx) => {
      const scalar = new Map(values.map(v => [v.variable, [{ from: 0, to: 0, ...(v.weight !== undefined ? { weight: v.weight } : {}), ...(v.labels !== undefined ? { labels: v.labels } : {}) }]]));
      const asValue = m => (m.length ? { present: true, ...(m[0].weight !== undefined ? { weight: m[0].weight } : {}), ...(m[0].labels !== undefined ? { labels: m[0].labels } : {}) } : { present: false });
      let total = [];
      const terms = polynomial.map(monomial => {
        let product = identity(semiring, 1);
        for (const variable of monomial) product = ctx.call('semiring.product', { semiring, size: 1, left: product, right: scalar.get(variable) ?? [] }).product;
        total = ctx.call('semiring.add', { semiring, size: 1, left: total, right: product }).sum;
        return { monomial: [...monomial], value: asValue(product) };
      });
      // The identity carries "one" for semirings whose one is written (counting 1, tropical 0, viterbi 1); boolean presence has no weight.
      return { value: asValue(total), terms };
    },
  },
];
export const semirings = SEMIRINGS;
