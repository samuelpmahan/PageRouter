import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/runtime/index.mjs';

const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties: structuredClone(properties), required, additionalProperties: false,
});
const number = { type: 'number' };
const vector = { type: 'array', items: number, minItems: 1 };

const atom = {
  id: 'test.atom', title: 'Atom', description: 'A test atom.', kind: 'atomic',
  dependsOn: [], inputSchema: object({ value: number }), outputSchema: number,
  examples: [{ input: { value: 2 }, expected: 4 }],
  run: ({ value }) => value * 2,
};

function seededCapabilities() {
  const draw = {
    ...atom,
    id: 'test.draw',
    inputSchema: object({}),
    outputSchema: number,
    examples: [],
    run: (_input, ctx) => ctx.random(),
  };
  const inner = {
    id: 'test.inner', title: 'Inner', description: 'Calls the seeded atom.', kind: 'composed',
    dependsOn: ['test.draw'], inputSchema: object({}), outputSchema: number,
    examples: [],
    run: (_input, ctx) => ctx.call('test.draw', {}),
  };
  const outer = {
    id: 'test.outer', title: 'Outer', description: 'Calls a nested composition.', kind: 'composed',
    dependsOn: ['test.inner'], inputSchema: object({}), outputSchema: number,
    examples: [],
    run: (_input, ctx) => ctx.call('test.inner', {}),
  };
  return [draw, inner, outer];
}

test('registry derives order and dependency-first graph edges', () => {
  const middle = {
    ...atom,
    id: 'test.middle', title: 'Middle', kind: 'composed',
    inputSchema: object({}), examples: [{ input: {}, expected: 6 }],
    dependsOn: ['test.atom'], run: (_input, ctx) => ctx.call('test.atom', { value: 3 }),
  };
  const top = {
    ...middle,
    id: 'test.top', title: 'Top', dependsOn: ['test.middle'],
    inputSchema: object({}), examples: [{ input: {}, expected: 6 }],
    run: (_input, ctx) => ctx.call('test.middle', {}),
  };
  const registry = createRegistry([atom, middle, top], { source: 'fixture', version: '1' });
  assert.deepEqual(registry.list().map(({ id, order }) => [id, order]), [
    ['test.atom', 0], ['test.middle', 1], ['test.top', 2],
  ]);
  assert.deepEqual(registry.graph().edges, [
    { from: 'test.atom', to: 'test.middle' },
    { from: 'test.middle', to: 'test.top' },
  ]);
  assert.deepEqual(registry.orderPreference().values, [
    { order: 0, value: 1 }, { order: 1, value: 1 }, { order: 2, value: 2 },
  ]);
});

test('registry rejects duplicate IDs, unknown dependencies, and dependency cycles', () => {
  assert.throws(() => createRegistry([atom, atom]), /duplicate capability ID.*test\.atom/i);
  const unknown = { ...atom, id: 'test.unknownParent', kind: 'composed', dependsOn: ['test.absent'] };
  assert.throws(() => createRegistry([unknown]), /unknown dependency.*test\.absent/i);
  const a = { ...atom, id: 'test.cycleA', kind: 'composed', dependsOn: ['test.cycleB'] };
  const b = { ...atom, id: 'test.cycleB', kind: 'composed', dependsOn: ['test.cycleA'] };
  assert.throws(() => createRegistry([a, b]), /cycle/i);
  const unsupported = { ...atom, inputSchema: { ...object({ value: number }), anyOf: [{ type: 'number' }] } };
  assert.throws(() => createRegistry([unsupported]), /unsupported schema keyword.*anyOf/i);
});

test('execution enforces schemas, finite numbers, immutable input, and output schemas', () => {
  const registry = createRegistry([atom], { source: 'fixture', version: '1' });
  assert.equal(registry.execute('test.atom', { value: 4 }).result, 8);
  assert.throws(() => registry.execute('test.atom', []), /input.*object/i);
  assert.throws(() => registry.execute('test.atom', { value: 4, extra: true }), /additional|extra/i);
  assert.throws(() => registry.execute('test.atom', { value: Number.NaN }), /finite/i);
  const mutating = { ...atom, run: (input) => { input.value = 5; return 5; } };
  assert.throws(() => createRegistry([mutating]).execute('test.atom', { value: 2 }), /read only|assign|frozen/i);
  const badOutput = { ...atom, run: () => 'not a number' };
  assert.throws(() => createRegistry([badOutput]).execute('test.atom', { value: 2 }), /output/i);
});

test('registry snapshots descriptors and schemas against caller mutation', () => {
  const original = { ...atom, dependsOn: [], inputSchema: object({ value: number }) };
  const registry = createRegistry([original], { source: 'fixture', version: '1' });
  original.dependsOn.push('test.absent');
  original.inputSchema.properties.value.type = 'string';
  original.run = () => 'changed';
  assert.equal(registry.execute('test.atom', { value: 4 }).result, 8);
  assert.equal(registry.get('test.atom').inputSchema.properties.value.type, 'number');
  assert.throws(() => { registry.get('test.atom').inputSchema.properties.value.type = 'string'; }, /read only|assign|frozen/i);
});

test('composed execution rejects undeclared calls and unused declared dependencies', () => {
  const secondAtom = { ...atom, id: 'test.second' };
  const undeclared = {
    ...atom, id: 'test.undeclared', kind: 'composed', dependsOn: ['test.atom'],
    inputSchema: object({}), examples: [],
    run: (_input, ctx) => ctx.call('test.second', { value: 1 }),
  };
  assert.throws(() => createRegistry([atom, secondAtom, undeclared]).execute('test.undeclared', {}), /undeclared dependency.*test\.second/i);
  const unused = {
    ...atom, id: 'test.unused', kind: 'composed', dependsOn: ['test.atom'],
    inputSchema: object({}), examples: [],
    run: () => 7,
  };
  assert.throws(() => createRegistry([atom, unused]).execute('test.unused', {}), /declared dependency.*test\.atom.*not called/i);
});

test('nested seeded traces replay canonically and tampered receipts report mismatches', () => {
  const registry = createRegistry(seededCapabilities(), { source: 'fixture', version: '2' });
  const first = registry.execute('test.outer', {}, { seed: 'keep-this-seed' });
  const second = registry.execute('test.outer', {}, { seed: 'keep-this-seed' });
  assert.equal(first.replay.resultCanonical, second.replay.resultCanonical);
  assert.equal(first.replay.resultHash, second.replay.resultHash);
  assert.equal(first.trace.calls[0].calls[0].id, 'test.draw');
  assert.equal(first.trace.calls[0].identity.source, 'fixture');
  assert.equal(first.trace.calls[0].seed, 'keep-this-seed');
  assert.equal(registry.replay(first).matches, true);
  const changed = structuredClone(first);
  changed.result = 0.25;
  changed.replay.resultCanonical = '0.25';
  changed.replay.resultHash = '0000000000000000';
  const replay = registry.replay(changed);
  assert.equal(replay.matches, false);
  assert.ok(replay.mismatches.includes('result'));
  assert.ok(replay.mismatches.includes('resultHash'));
});

test('replay reports tampered input, identity, and nested trace metadata', () => {
  const registry = createRegistry(seededCapabilities(), { source: 'fixture', version: '2' });
  const receipt = registry.execute('test.outer', {}, { seed: 12 });
  const atomRegistry = createRegistry([atom], { source: 'fixture', version: '2' });
  const atomReceipt = atomRegistry.execute('test.atom', { value: 4 });
  const changedInput = structuredClone(atomReceipt);
  changedInput.input = { value: 5 };
  assert.ok(atomRegistry.replay(changedInput).mismatches.includes('inputCanonical'));
  const changedIdentity = structuredClone(receipt);
  changedIdentity.identity.version = 'spoofed';
  assert.ok(registry.replay(changedIdentity).mismatches.includes('identity'));
  const changedTrace = structuredClone(receipt);
  changedTrace.trace.calls[0].calls[0].resultHash = 'spoofed';
  assert.ok(registry.replay(changedTrace).mismatches.includes('trace'));
});

test('unseeded deterministic capabilities replay without inventing a seed', () => {
  const registry = createRegistry([atom], { source: 'fixture', version: '1' });
  const receipt = registry.execute('test.atom', { value: 4 });
  assert.equal(receipt.replay.seed, null);
  assert.equal(registry.replay(receipt).matches, true);
});

test('random draws require an explicit seed and preserve the seed in replay evidence', () => {
  const registry = createRegistry(seededCapabilities(), { source: 'fixture', version: '2' });
  assert.throws(() => registry.execute('test.draw', {}), /seed/i);
  const run = registry.execute('test.draw', {}, { seed: 7 });
  assert.equal(run.replay.seed, 7);
  assert.equal(run.trace.randomDraws, 1);
});

test('execution bounds nested call depth, total calls, and retained trace payload', () => {
  const middle = {
    ...atom, id: 'test.middle', kind: 'composed', inputSchema: object({}),
    dependsOn: ['test.atom'], examples: [{ input: {}, expected: 6 }],
    run: (_input, ctx) => ctx.call('test.atom', { value: 3 }),
  };
  const top = {
    ...middle, id: 'test.top', dependsOn: ['test.middle'],
    examples: [{ input: {}, expected: 6 }],
    run: (_input, ctx) => ctx.call('test.middle', {}),
  };
  assert.throws(() => createRegistry([atom, middle, top], {
    limits: { maxCallDepth: 2 },
  }).execute('test.top', {}), /depth limit/i);
  assert.throws(() => createRegistry([atom, middle, top], {
    limits: { maxCalls: 2 },
  }).execute('test.top', {}), /call count limit/i);
  assert.throws(() => createRegistry([atom], {
    limits: { maxTracePayloadBytes: 16 },
  }).execute('test.atom', { value: 2 }), /trace payload limit/i);
  assert.throws(() => createRegistry([atom], {
    limits: { maxValueDepth: 1 },
  }).execute('test.atom', { value: 2, nested: { deeper: true } }), /maximum JSON value depth/i);
});
