import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../../work/pxc-kernel/src/kernel.mjs';
import { flowCandidateKey } from './adapters.mjs';
import { normalizeKernelWindow } from './kernel-window.mjs';

const number = { type: 'number' };

function kernelWindow({ rename = false, shared = true, internal = true, inputArity = 2, outputArity = 1 } = {}) {
  const world = createWorld();
  const leaf = rename ? 'leaf-renamed' : 'leaf';
  const parent = rename ? 'parent-renamed' : 'parent';
  const ports = rename ? ['left', 'right', 'extra'] : ['a', 'b', 'c'];
  const outputs = rename ? ['answer', 'spare'] : ['value', 'other'];
  const rootPorts = rename ? ['first', 'second'] : ['x', 'y'];
  const leafIn = Object.fromEntries(ports.slice(0, inputArity).map((port) => [port, number]));
  const leafOut = Object.fromEntries(outputs.slice(0, outputArity).map((port) => [port, number]));
  world.contract({ id: leaf, in: leafIn, out: leafOut });
  world.implement({ id: `${leaf}/impl`, implements: leaf, run: (inputs) => {
    const entries = Object.values(inputs);
    const value = entries.reduce((sum, entry) => sum + entry.value, 0);
    return Object.fromEntries(outputs.slice(0, outputArity).map((port, index) => [port, value + index]));
  } });
  world.contract({ id: parent, in: Object.fromEntries(rootPorts.map((port) => [port, number])), out: { result: number } });
  world.implement({ id: `${parent}/impl`, implements: parent, uses: [leaf], run: (inputs, ctx) => {
    const inputValues = Object.values(inputs);
    const makeArgs = (values) => Object.fromEntries(ports.slice(0, inputArity).map((port, index) => [port, values[index % values.length]]));
    const firstValues = [inputValues[0], shared ? inputValues[0] : inputValues[1], inputValues[1]];
    const first = ctx.call(leaf, makeArgs(firstValues));
    const secondFirst = internal ? first[outputs[0]] : inputValues[0];
    const second = ctx.call(leaf, makeArgs([secondFirst, inputValues[1], inputValues[0]]));
    return { result: second[outputs[0]] };
  } });
  const receipt = world.run(parent, Object.fromEntries(rootPorts.map((port, index) => [port, index + 1]))).receipt;
  return { receipt, normalized: normalizeKernelWindow(receipt.trace.calls) };
}

test('normalizes actual PxC sibling calls, ordered port ordinals and exact internal Ref edges', () => {
  const { receipt, normalized } = kernelWindow();
  assert.equal(receipt.trace.calls.length, 2);
  assert.equal(normalized.status, 'succeeded');
  assert.deepEqual(normalized.edges.filter((edge) => edge.from !== null), [
    { from: 'kernel-op-1', to: 'kernel-op-2', kind: 'call', inputIndex: 0, fromOutputIndex: 0, via: [] },
  ]);
  assert.ok(normalized.edges.some((edge) => edge.from === null && edge.kind === 'external' && edge.inputIndex === 0));
  assert.deepEqual(normalized.operations.map((operation) => [operation.inputCount, operation.outputCount]), [[2, 1], [2, 1]]);
  assert.match(flowCandidateKey(normalized), /^structural-only:/);
  assert.match(normalized.evidence.warning, /Cross-run references remain/);
});

test('kernel candidate keys ignore IDs and labels while preserving wiring, arity and shared outside inputs', () => {
  const base = kernelWindow();
  const renamed = kernelWindow({ rename: true });
  const differentInputs = kernelWindow({ shared: false });
  const differentInternal = kernelWindow({ internal: false });
  const widerInputs = kernelWindow({ inputArity: 3 });
  const widerOutputs = kernelWindow({ outputArity: 2 });
  assert.equal(flowCandidateKey(base.normalized), flowCandidateKey(renamed.normalized));
  assert.notEqual(flowCandidateKey(base.normalized), flowCandidateKey(differentInputs.normalized));
  assert.notEqual(flowCandidateKey(base.normalized), flowCandidateKey(differentInternal.normalized));
  assert.notEqual(flowCandidateKey(base.normalized), flowCandidateKey(widerInputs.normalized));
  assert.notEqual(flowCandidateKey(base.normalized), flowCandidateKey(widerOutputs.normalized));
  assert.deepEqual(base.normalized.operations[0].inputWiring.map((slot) => slot[0].externalAlias), [0, 0]);
  assert.deepEqual(differentInputs.normalized.operations[0].inputWiring.map((slot) => slot[0].externalAlias), [0, 1]);
});

test('candidate keys retain producer output ordinals and meaningful projection paths while ignoring port labels', () => {
  const graph = (sourceId, targetId, sourcePort, path) => ({
    operations: [
      { id: sourceId, kind: 'calculation', status: 'succeeded', inputCount: 1, outputCount: 2, inputWiringStatus: 'exact-provenance', inputWiring: [[]], outputWiring: [[], []] },
      { id: targetId, kind: 'calculation', status: 'succeeded', inputCount: 1, outputCount: 1, inputWiringStatus: 'exact-provenance', inputWiring: [[{ kind: 'at', leafKind: 'call', fromOperation: 0, fromOutputIndex: sourcePort, via: [{ kind: 'at', path: [path] }] }]], outputWiring: [[]] },
    ],
    edges: [{ from: sourceId, to: targetId, kind: 'at', inputIndex: 0, fromOutputIndex: sourcePort, via: [{ kind: 'at', path: [path] }] }],
  });
  const original = flowCandidateKey(graph('call-a', 'call-b', 0, 'position'));
  assert.equal(original, flowCandidateKey(graph('renamed-a', 'renamed-b', 0, 'position')));
  assert.notEqual(original, flowCandidateKey(graph('call-a', 'call-b', 1, 'position')));
  assert.notEqual(original, flowCandidateKey(graph('call-a', 'call-b', 0, 'velocity')));
});

test('kernel Ref predicates and gather paths remain in the structural candidate key', () => {
  const fromRefs = (comparison, piecePath, constant = 0) => normalizeKernelWindow([{
    id: 10,
    kind: 'calculation',
    contract: 'renamable-contract',
    impl: 'renamable-implementation',
    in: {
      condition: { hash: 'ignored', from: { kind: 'test', op: comparison, args: [{ kind: 'call', call: 99, port: 'renamable-source-port' }, { kind: 'literal', value: constant }] } },
      gathered: { hash: 'ignored', from: { kind: 'gather', pieces: [{ path: piecePath, from: { kind: 'call', call: 99, port: 'renamable-source-port' } }] } },
    },
    out: { result: { hash: 'ignored', from: { kind: 'computed' } } },
    calls: [], cached: false,
  }]);
  const baseline = fromRefs('gt', ['left', 0]);
  const renamed = fromRefs('gt', ['left', 0]);
  assert.equal(flowCandidateKey(baseline), flowCandidateKey(renamed));
  assert.notEqual(flowCandidateKey(baseline), flowCandidateKey(fromRefs('lt', ['left', 0])));
  assert.notEqual(flowCandidateKey(baseline), flowCandidateKey(fromRefs('gt', ['right', 0])));
  assert.notEqual(flowCandidateKey(baseline), flowCandidateKey(fromRefs('gt', ['left', 0], 1)));
  assert.deepEqual(baseline.operations[0].inputWiring[0][0].via[0], { kind: 'test', index: 0, op: 'gt' });
  assert.equal(baseline.operations[0].inputWiring[0][1].literalValue, 0);
  assert.deepEqual(baseline.operations[0].inputWiring[1][0].via[0], { kind: 'gather', index: 0, path: ['left', 0] });
});

test('kernel guard decisions preserve outcomes and predicate provenance while ignoring step labels', () => {
  const fromDecision = ({ label, value = true, op = 'gt', constant = 0, ran = 'step-one', skipped }) => normalizeKernelWindow([{
    id: 10,
    kind: 'calculation',
    contract: 'guarded',
    impl: 'guarded/impl',
    in: {},
    out: { result: { hash: 'ignored', from: { kind: 'computed' } } },
    decisions: [{ label, value, from: { kind: 'test', op, args: [{ kind: 'literal', value: constant }] }, ...(ran === undefined ? {} : { ran }), ...(skipped === undefined ? {} : { skipped }) }],
    calls: [], cached: false,
  }]);
  const baseline = fromDecision({ label: 'step-one' });
  const renamed = fromDecision({ label: 'different-label', ran: 'renamed-step' });
  assert.equal(flowCandidateKey(baseline), flowCandidateKey(renamed));
  assert.notEqual(flowCandidateKey(baseline), flowCandidateKey(fromDecision({ label: 'step-one', op: 'lt' })));
  assert.notEqual(flowCandidateKey(baseline), flowCandidateKey(fromDecision({ label: 'step-one', constant: 1 })));
  assert.notEqual(flowCandidateKey(baseline), flowCandidateKey(fromDecision({ label: 'step-one', value: false })));
  assert.notEqual(flowCandidateKey(baseline), flowCandidateKey(fromDecision({ label: 'step-one', skipped: 'another-step' })));
  const decision = baseline.operations[0].decisions[0];
  assert.deepEqual([decision.decisionIndex, decision.value, decision.ranPresent, decision.skippedPresent], [0, true, true, false]);
  assert.deepEqual(decision.from[0].via, [{ kind: 'test', index: 0, op: 'gt' }]);
  assert.equal(decision.from[0].literalValue, 0);
});

test('cross-run refs remain explicit in evidence and normalize as external run aliases', () => {
  assert.deepEqual(normalizeKernelWindow({}).operations, []);
  assert.equal(normalizeKernelWindow({}).status, 'unknown');
  const world = createWorld();
  world.contract({ id: 'acc', kind: 'tick', in: { state: number, add: number }, out: { state: number } });
  world.implement({ id: 'acc/impl', implements: 'acc', run: ({ state, add }) => ({ state: state.value + add.value }) });
  const driven = world.drive('acc', { state: 0, add: 1 }, { ticks: 2 });
  const secondTrace = driven.receipts[1].trace;
  assert.equal(secondTrace.in.state.from.kind, 'run');
  assert.equal(secondTrace.in.state.from.run, driven.receipts[0].runId);
  const normalized = normalizeKernelWindow([secondTrace]);
  assert.equal(normalized.operations[0].inputWiring[0][0].kind, 'run');
  assert.equal(normalized.evidence.window[0].in.state.from.run, driven.receipts[0].runId);
});
