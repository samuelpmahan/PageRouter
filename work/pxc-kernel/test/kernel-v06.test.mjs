// Kernel v0.6: one test per concept that round-5 friction forced. Ledger seq 53+ names the entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';

const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };

function base() {
  const w = createWorld();
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } });
  w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'sq', in: { x: num }, out: { y: num } });
  w.implement({ id: 'sq/1', implements: 'sq', run: ({ x }) => ({ y: x.value ** 2 }) });
  w.contract({ id: 'id', in: { x: num }, out: { y: num } });
  w.implement({ id: 'id/1', implements: 'id', run: ({ x }) => ({ y: x }) });
  w.contract({ id: 'f', in: { x: num }, out: { y: num } });
  return w;
}

// ------------------------------------------------------------------ inherited runs are recorded (B N23/N25, C N22, F 38)
test('a step that runs because what it reads ran records that, with the same cause: both sides of a condition leave the same rows', () => {
  const w = base();
  w.compose({ id: 'f/c', implements: 'f', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'sqr', call: 'sq', bind: { x: 'flip.y' } },
  ], returns: { y: { first: ['sqr.y', '$in.x'] } } });
  const ran = w.run('f', { x: -3 }).trace.decisions;
  const skipped = w.run('f', { x: 3 }).trace.decisions;
  assert.deepEqual(ran.map((d) => [d.label, d.value, d.ran ?? null]), [['flip', true, 'flip'], ['sqr', true, 'sqr']]);
  assert.deepEqual(skipped.map((d) => [d.label, d.value, d.skipped ?? null]), [['flip', false, 'flip'], ['sqr', false, 'sqr']]);
  assert.deepEqual(ran[1].from, ran[0].from, 'sqr names flip\'s cause');
});

test('a step with an unconditional fallback is not conditional and records nothing', () => {
  const w = base();
  w.compose({ id: 'f/c', implements: 'f', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'sqr', call: 'sq', bind: { x: { first: ['flip.y', '$in.x'] } } },
  ], returns: { y: 'sqr.y' } });
  assert.deepEqual(w.run('f', { x: -3 }).trace.decisions.map((d) => d.label), ['flip']);
  assert.deepEqual(w.run('f', { x: 3 }).trace.decisions.map((d) => d.label), ['flip']);
});

// ------------------------------------------------------------------ else and alternatives inherit context (E N22/N23, C N24, F 39)
function ply() {
  const w = base();
  w.contract({ id: 'turn', in: { on: bool, x: num }, out: { y: num } });
  w.compose({ id: 'turn/c', implements: 'turn', steps: [
    { name: 'check', call: 'id', when: { eq: ['$in.on', true] }, bind: { x: '$in.x' } },
    { name: 'apply', call: 'sq', when: { gt: ['check.y', 0] }, bind: { x: 'check.y' } },
    { name: 'forfeit', call: 'neg', when: { else: ['apply'] }, bind: { x: '$in.x' } },
  ], returns: { y: { first: ['apply.y', 'forfeit.y', '$in.x'] } } });
  return w;
}

test('else holds only inside the context of the step it complements: a finished game does not forfeit', () => {
  const w = ply();
  assert.equal(w.run('turn', { on: true, x: 3 }).outputs.y, 9, 'legal move applied');
  assert.equal(w.run('turn', { on: true, x: -3 }).outputs.y, 3, 'refused move forfeits (apply skipped by its own condition)');
  const done = w.run('turn', { on: false, x: -3 });
  assert.equal(done.outputs.y, -3, 'game over: apply was skipped by inheritance, so forfeit is skipped too (v0.5 forfeited here)');
  assert.deepEqual(done.trace.calls, []);
  assert.deepEqual(done.trace.decisions.map((d) => [d.label, d.value]), [['check', false], ['apply', false], ['forfeit', false]]);
});

test('an alternative in a binding whose every option was skipped skips the step instead of failing; returns still fail', () => {
  const w = base();
  w.contract({ id: 'g', in: { k: int, x: num }, out: { y: num } });
  w.compose({ id: 'g/c', implements: 'g', steps: [
    { name: 'a', call: 'neg', when: { eq: ['$in.k', 1] }, bind: { x: '$in.x' } },
    { name: 'b', call: 'sq', when: { eq: ['$in.k', 2] }, bind: { x: '$in.x' } },
    { name: 'after', call: 'id', bind: { x: { one: ['a.y', 'b.y'] } } },
  ], returns: { y: { first: ['after.y', '$in.x'] } } });
  assert.equal(w.run('g', { k: 1, x: 3 }).outputs.y, -3);
  assert.equal(w.run('g', { k: 2, x: 3 }).outputs.y, 9);
  const none = w.run('g', { k: 7, x: 3 });
  assert.equal(none.outputs.y, 3, 'after is skipped (v0.5: NO_BRANCH)');
  assert.deepEqual(none.trace.decisions.map((d) => [d.label, d.value]), [['a', false], ['b', false], ['after', false]]);
  assert.throws(() => w.compose({ id: 'g/bad', implements: 'g', steps: [
    { name: 'a', call: 'neg', when: { eq: ['$in.k', 1] }, bind: { x: '$in.x' } },
    { name: 'after', call: 'id', bind: { x: { one: ['a.y'] } } },
  ], returns: { y: 'after.y' } }), (e) => e.code === 'ASSEMBLY_LINT', 'returning a step that can be skipped still needs first or one');
});

// ------------------------------------------------------------------ chosenBy and fillReach (B top, D top, F 41)
function seated() {
  const w = createWorld();
  w.contract({ id: 'pick', in: { x: int }, out: { y: int } });
  w.implement({ id: 'pick/a', implements: 'pick', run: ({ x }) => ({ y: x.value + 1 }) });
  w.implement({ id: 'pick/b', implements: 'pick', run: ({ x }) => ({ y: x.value + 100 }) });
  w.contract({ id: 'game', in: { x: int }, out: { me: int, model: int, other: int } });
  w.implement({ id: 'game/1', implements: 'game', uses: ['pick#me', 'pick#model', 'pick#other'], run: ({ x }, ctx) => ({
    me: ctx.call('pick', { x }, { slot: 'me' }).y, model: ctx.call('pick', { x }, { slot: 'model' }).y, other: ctx.call('pick', { x }, { slot: 'other' }).y }) });
  w.select('pick', 'pick/a');
  w.select('pick', 'pick/a', 'model');
  return w;
}

test('every node says which precedence rung chose its implementation, and the receipt says where each fill key landed', () => {
  const w = seated();
  const r = w.run('game', { x: 0 }, { fill: { pick: 'pick/b', 'pick#other': 'pick/a' } });
  const rung = (i) => r.trace.calls[i].chosenBy;
  assert.deepEqual(rung(0), { rung: 'contract fill', key: 'pick' });
  assert.deepEqual(rung(1), { rung: 'slot select', key: 'pick#model' });
  assert.deepEqual(rung(2), { rung: 'slot fill', key: 'pick#other' });
  assert.deepEqual(r.trace.chosenBy, { rung: 'only implementation' });
  assert.deepEqual(r.receipt.fillReach, { pick: [2], 'pick#other': [4] });
});

test('fill reach through a cache hit names the hit node', () => {
  const w = seated();
  w.contract({ id: 'two', in: { x: int }, out: { a: int, b: int } });
  w.implement({ id: 'two/1', implements: 'two', uses: ['game'], run: ({ x }, ctx) => ({ a: ctx.call('game', { x }).me, b: ctx.call('game', { x }).me }) });
  const r = w.run('two', { x: 0 }, { fill: { 'pick#me': 'pick/b' } });
  assert.equal(r.trace.calls[1].cached, true);
  assert.deepEqual(r.receipt.fillReach['pick#me'], [3, 6], 'the computed call #3 and the cache hit #6');
});

// ------------------------------------------------------------------ landing modes (C, D strict; E, F sweeps)
test('landing: path (default), all (every key must land), none (a sweep may miss; typos still fail)', () => {
  const w = seated();
  w.contract({ id: 'solo', in: { x: int }, out: { y: int } });
  w.implement({ id: 'solo/1', implements: 'solo', uses: ['pick#me'], run: ({ x }, ctx) => ({ y: ctx.call('pick', { x }, { slot: 'me' }).y }) });
  const sweep = { 'pick#model': 'pick/b', 'game/pick#me': 'pick/b' };
  assert.throws(() => w.run('solo', { x: 0 }, { fill: sweep }), (e) => e.code === 'BAD_FILL' && /game\/pick#me/.test(e.message), 'default: the path must land');
  assert.doesNotThrow(() => w.run('solo', { x: 0 }, { fill: sweep, landing: 'none' }), 'a sweep across mixed runs');
  assert.throws(() => w.run('solo', { x: 0 }, { fill: { 'pick#modle': 'pick/b' }, landing: 'none' }), (e) => e.code === 'BAD_FILL', 'a typo is still a typo');
  assert.throws(() => w.run('solo', { x: 0 }, { fill: { 'pick#model': 'pick/b' }, landing: 'all' }), (e) => e.code === 'BAD_FILL' && /pick#model/.test(e.message), 'strict: a declared seat this run never reached');
  assert.doesNotThrow(() => w.run('game', { x: 0 }, { fill: { 'pick#model': 'pick/b' }, landing: 'all' }));
  assert.throws(() => w.run('solo', { x: 0 }, { landing: 'some' }), (e) => e.code === 'BAD_OPTION');
});

// ------------------------------------------------------------------ examples carry names; failures show the tick's inputs (B N28)
test('a named trajectory example reports its name, the first wrong tick, and that tick\'s inputs', () => {
  const w = createWorld();
  w.contract({ id: 'acc', kind: 'tick', in: { state: int, add: int }, out: { state: int },
    examples: [{ name: 'adds then holds', in: { state: 0, add: 0 }, each: [{ add: 2 }, { add: 3 }, {}], trajectory: [{ state: 2 }, { state: 5 }, { state: 5 }] }] });
  w.implement({ id: 'acc/ok', implements: 'acc', run: ({ state, add }) => ({ state: state.value + add.value }) });
  w.implement({ id: 'acc/sticky', implements: 'acc', run: ({ state, add }) => ({ state: state.value + Math.min(add.value, 2) }) });
  const p = w.prove('acc');
  assert.deepEqual(p.map((x) => [x.impl, x.example, x.ok]), [['acc/ok', 'adds then holds', true], ['acc/sticky', 'adds then holds', false]]);
  assert.match(p[1].detail, /^tick 1: expected \{"state":5\} got \{"state":4\} \(inputs \{"add":3\}\)/);
});

test('a misspelt slot inside a path key is a typo in every landing mode (found by D F-35, E N28, F 42)', () => {
  const w = seated();
  for (const landing of ['path', 'all', 'none']) {
    assert.throws(() => w.run('game', { x: 0 }, { fill: { 'game/pick#modle': 'pick/b' }, landing }), (e) => e.code === 'BAD_FILL' && /pick#modle/.test(e.message), `landing ${landing}`);
  }
  assert.doesNotThrow(() => w.run('game', { x: 0 }, { fill: { 'game/pick#model': 'pick/b' }, landing: 'none' }), 'a correctly spelt path is fine');
  w.contract({ id: 'solo', in: { x: int }, out: { y: int } });
  w.implement({ id: 'solo/1', implements: 'solo', uses: ['pick'], run: ({ x }, ctx) => ({ y: ctx.call('pick', { x }, { slot: 'free' }).y }) });
  assert.doesNotThrow(() => w.run('solo', { x: 0 }, { fill: { 'solo/pick#free': 'pick/b' }, landing: 'none' }), 'an undeclared slot that a call actually used is not a typo');
});
