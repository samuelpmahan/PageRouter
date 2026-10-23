// world.sum and world.evaluate (seq 62): every implementation of a contract is another way to the same output; sum records the
// provenance polynomial once, evaluate maps it into any of Capability Lab's semirings afterwards. The six tests are the ones listed
// in outputs/capability-lab/docs/semiring-sublation.md; the first checks the kernel's answers against the Lab directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createWorld } from '../src/kernel.mjs';
import { createRegistry } from '../../../outputs/capability-lab/src/runtime/index.mjs';
import { capabilities as labSemirings } from '../../../outputs/capability-lab/src/semiring/index.mjs';

// A pose has three ways (Sam's tee pad): a corner of the known rectangle, two of its edges, or the basket anchor and the course map.
// Each way calls the detectors it needs, so its monomial names them.
function poseWorld({ broken = false } = {}) {
  const world = createWorld({ name: 'tee-pad' });
  const num = { type: 'number' };
  world.contract({ id: 'detect', in: { frame: num }, out: { found: { type: 'boolean' } } });
  for (const d of ['corner', 'edge', 'anchor']) world.implement({ id: `detect/${d}`, implements: 'detect', run: ({ frame }) => ({ found: frame.value > 0 }) });
  world.contract({ id: 'pose', in: { frame: num }, out: { angle: num } });
  const uses = (id, detectors, angle) => world.implement({ id: `pose/${id}`, implements: 'pose', uses: detectors.map(d => `detect#${d}`),
    run: ({ frame }, ctx) => { for (const d of detectors) ctx.call('detect', { frame }, { slot: d }); return { angle }; } });
  uses('corner', ['corner'], 12);
  uses('edges', ['edge'], 12);
  uses('anchor', ['anchor'], 13);
  if (broken) world.implement({ id: 'pose/broken', implements: 'pose', run: () => { throw new Error('the detector crashed'); } });
  return world;
}
const pinSlots = { 'detect#corner': 'detect/corner', 'detect#edge': 'detect/edge', 'detect#anchor': 'detect/anchor' };
const sumPose = (world, frame = 7) => world.sum('pose', { frame }, { fill: pinSlots });

test('the vendored Lab copies are byte-identical to Capability Lab and to their pins', () => {
  const pin = JSON.parse(fs.readFileSync(new URL('../src/lab/PIN.json', import.meta.url)));
  for (const [file, { from, sha256 }] of Object.entries(pin.files)) {
    const mine = fs.readFileSync(new URL(`../src/lab/${file}`, import.meta.url)), theirs = fs.readFileSync(new URL(`../../../${from}`, import.meta.url));
    assert.equal(crypto.createHash('sha256').update(mine).digest('hex'), sha256, `${file} pin`);
    assert.ok(mine.equals(theirs), `${file} equals ${from}`);
  }
});

test('1. two or more ways, five semirings: evaluate(sum) equals the Lab\'s provenance.evaluate on the same polynomial and values', () => {
  const world = poseWorld(), { polynomial } = sumPose(world);
  assert.deepEqual(polynomial, [['pose/corner', 'detect/corner'], ['pose/edges', 'detect/edge'], ['pose/anchor', 'detect/anchor']]);
  const lab = createRegistry(labSemirings, { source: 'capability-lab', version: '1' });
  const valuations = {
    boolean: { 'pose/corner': true, 'detect/corner': true, 'pose/edges': true, 'detect/edge': true, 'pose/anchor': true },
    counting: { 'pose/corner': { weight: 1 }, 'detect/corner': { weight: 1 }, 'pose/edges': { weight: 1 }, 'detect/edge': { weight: 1 }, 'pose/anchor': { weight: 1 }, 'detect/anchor': { weight: 1 } },
    tropical: { 'pose/corner': { weight: 2 }, 'detect/corner': { weight: 30 }, 'pose/edges': { weight: 2 }, 'detect/edge': { weight: 80 }, 'pose/anchor': { weight: 5 }, 'detect/anchor': { weight: 120 } },
    viterbi: { 'pose/corner': { weight: 1 }, 'detect/corner': { weight: 0.9 }, 'pose/edges': { weight: 1 }, 'detect/edge': { weight: 0.95 }, 'pose/anchor': { weight: 1 }, 'detect/anchor': { weight: 0.6 } },
    lineage: { 'pose/corner': { labels: ['corner way'] }, 'detect/corner': { labels: ['frame 7'] }, 'pose/anchor': { labels: ['anchor way'] }, 'detect/anchor': { labels: ['course map'] } },
  };
  for (const [semiring, valuation] of Object.entries(valuations)) {
    const values = Object.entries(valuation).map(([variable, v]) => ({ variable, ...(v === true ? {} : v) }));
    assert.deepEqual(world.evaluate(polynomial, semiring, valuation), lab.execute('provenance.evaluate', { semiring, polynomial, values }).result, semiring);
  }
  assert.equal(world.evaluate(polynomial, 'tropical', valuations.tropical).value.weight, 32, 'the corner way is cheapest');
  assert.equal(world.evaluate(polynomial, 'viterbi', valuations.viterbi).value.weight, 0.95, 'the edge way is most reliable');
});

test('2. one polynomial, many semirings: evaluating it again in other semirings runs nothing', () => {
  const world = poseWorld(), { polynomial } = sumPose(world), before = world.stats();
  for (const semiring of ['boolean', 'counting', 'tropical', 'viterbi', 'lineage']) world.evaluate(polynomial, semiring, { 'pose/corner': true, 'detect/corner': true });
  const after = world.stats();
  assert.equal(after.runs, before.runs);
  assert.equal(after.cacheHits, before.cacheHits);
  assert.equal(after.cacheMisses, before.cacheMisses);
});

test('3. deletion propagation: removing an input removes exactly the terms that used it', () => {
  const world = poseWorld(), { polynomial } = sumPose(world);
  const all = Object.fromEntries(polynomial.flat().map(v => [v, true]));
  const without = (...gone) => Object.fromEntries(Object.entries(all).filter(([v]) => !gone.includes(v)));
  const count = valuation => world.evaluate(polynomial, 'counting', Object.fromEntries(Object.keys(valuation).map(v => [v, { weight: 1 }]))).value;
  assert.deepEqual(count(all), { present: true, weight: 3 });
  assert.deepEqual(count(without('detect/corner')), { present: true, weight: 2 }, 'losing the corner detector loses one way');
  assert.equal(world.evaluate(polynomial, 'boolean', without('detect/corner', 'detect/edge')).value.present, true, 'the anchor way remains');
  assert.equal(world.evaluate(polynomial, 'boolean', without('detect/corner', 'detect/edge', 'detect/anchor')).value.present, false);
  const terms = world.evaluate(polynomial, 'boolean', without('detect/edge')).terms.map(t => t.value.present);
  assert.deepEqual(terms, [true, false, true], 'only the term that used the edge detector vanishes');
});

test('4. a way that throws is a missing term with its error in its receipt; the others still sum', () => {
  const world = poseWorld({ broken: true }), result = sumPose(world);
  assert.equal(result.polynomial.length, 3);
  const broken = result.terms.find(t => t.impl === 'pose/broken');
  assert.equal(broken.monomial, null);
  assert.match(broken.error.message, /the detector crashed/);
  assert.equal(broken.receipt.status, 'failed');
  assert.deepEqual(result.receipt.terms.find(t => t.impl === 'pose/broken'), { impl: 'pose/broken', runId: broken.receipt.runId, status: 'failed', error: broken.error });
});

test('5. cache: summing twice reuses every term, and the polynomial is the same cached or not', () => {
  const world = poseWorld(), first = sumPose(world), second = sumPose(world);
  assert.ok(second.terms.every(t => t.receipt.trace.cached === true && t.receipt.trace.cachedFrom), 'every way came from the cache');
  assert.deepEqual(second.polynomial, first.polynomial);
  const third = sumPose(world, 8);
  assert.ok(third.terms.every(t => t.receipt.trace.cached === false), 'another frame computes again');
});

test('6. call under a fill is the fill\'s term of sum; AMBIGUOUS comes from run, never from sum', () => {
  const world = poseWorld(), result = sumPose(world);
  assert.throws(() => world.run('pose', { frame: 7 }, { fill: pinSlots }), e => e.code === 'AMBIGUOUS');
  for (const way of ['pose/corner', 'pose/edges', 'pose/anchor']) {
    const chosen = world.run('pose', { frame: 7 }, { fill: { ...pinSlots, pose: way }, cache: false });
    const term = result.terms.find(t => t.impl === way);
    assert.deepEqual(chosen.outputs, term.outputs, way);
    assert.deepEqual([chosen.trace.impl, ...chosen.trace.calls.map(c => c.impl)].sort(), [...term.monomial].sort(), `${way}: the run uses exactly its term's variables`);
  }
});
