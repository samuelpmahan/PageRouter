import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLabExecution, normalizeAtlasObservation, flowCandidateKey, groupFlowCandidates } from './adapters.mjs';
import { AtlasRuntime } from '../atlas/runtime-adapter.mjs';

test('CapabilityLab trace keeps recursive invocations and never turns equal hashes into data edges', () => {
  const execution = {
    id: 'root', input: {}, result: 1,
    trace: { id: 'root', order: 2, identity: { revision: 1 }, inputCanonical: '{}', inputHash: 'fnv', resultCanonical: '1', resultHash: 'fnv', seed: 3, randomDraws: 0,
      calls: [{ id: 'child', order: 1, inputHash: 'fnv', resultHash: 'fnv', calls: [] }] },
  };
  const normalized = normalizeLabExecution(execution);
  assert.equal(normalized.status, 'succeeded');
  assert.deepEqual(normalized.edges, [{ from: 'lab-op-1', to: 'lab-op-2', kind: 'invocation' }]);
  assert.equal(normalized.operations[0].inputHash, 'fnv');
  assert.match(normalized.evidence.hashMeaning, /FNV-1a.*not cryptographic/);
  assert.match(normalized.evidence.edgeMeaning, /no dataflow.*equal values or hashes/);
});

test('repeated CapabilityLab helper nodes remain distinct occurrences even when the native capability ID repeats', () => {
  const normalized = normalizeLabExecution({ trace: { id: 'root', calls: [{ id: 'helper' }, { id: 'helper' }] } });
  assert.deepEqual(normalized.operations.map((operation) => operation.id), ['lab-op-1', 'lab-op-2', 'lab-op-3']);
  assert.deepEqual(normalized.evidence.nativeIdMap.helper, ['lab-op-2', 'lab-op-3']);
  assert.equal(normalized.edges.length, 2);
});

test('an empty CapabilityLab trace does not become a successful phantom operation', () => {
  const normalized = normalizeLabExecution({ trace: {} });
  assert.equal(normalized.status, 'unknown');
  assert.deepEqual(normalized.operations, []);
});

test('candidate key ignores incidental names but changes with constants, status, wiring and ordered input positions', () => {
  const make = (a, b, predicate = { op: 'lessThan', constants: [2] }, order = [0, 1]) => {
    const operations = [
      { id: a, kind: 'calculation', status: 'succeeded', capabilityId: a, label: 'Label A', semantics: { op: 'compare', predicate, constants: [2], frame: 'world', units: 'm' } },
      { id: b, kind: 'calculation', status: 'succeeded', capabilityId: b, label: 'Label B', semantics: { op: 'compare', predicate: { op: 'lessThan', constants: [2] }, constants: [2], frame: 'world', units: 'm' } },
    ];
    const edges = [{ from: a, to: b, kind: 'data', inputIndex: order[0] }, { from: b, to: a, kind: 'data', inputIndex: order[1] }];
    return { operations, edges };
  };
  const original = flowCandidateKey(make('native-a', 'native-b'));
  assert.equal(original, flowCandidateKey(make('renamed-1', 'renamed-2')));
  assert.notEqual(original, flowCandidateKey(make('native-a', 'native-b', { op: 'lessThan', constants: [3] })));
  assert.notEqual(original, flowCandidateKey(make('native-a', 'native-b', undefined, [1, 0])));
  const unknown = flowCandidateKey({ operations: [{ id: 'a', capabilityId: 'untrusted-name', kind: 'calculation', status: 'succeeded' }], edges: [] });
  assert.match(unknown, /^structural-only:/);
  const mixed = (constant) => flowCandidateKey({ operations: [
    { id: 'known', kind: 'calculation', status: 'succeeded', semantics: { op: 'gate', predicate: { op: 'lt', constant } } },
    { id: 'opaque', kind: 'calculation', status: 'succeeded', capabilityId: 'opaque-name' },
  ], edges: [] });
  assert.match(mixed(2), /^structural-only:/);
  assert.notEqual(mixed(2), mixed(3), 'known predicate constants remain in a structural-only mixed key');
  assert.deepEqual(groupFlowCandidates([{ id: '1', ...make('a', 'b') }, { id: '2', ...make('c', 'd') }]).map((group) => group.runIds), [['1', '2']]);
});

test('Atlas adapter reads a real AtlasRuntime DAG, exact address producers, cache hits, and failure traces', async () => {
  const runtime = new AtlasRuntime({ add: (left, right) => left + right, explode: () => { throw new Error('fixture exploded'); } });
  const recipe = {
    nodes: [
      { id: 'sum', calculation: 'add', inputs: ['/a', '/b'], output: '/sum' },
      { id: 'total', calculation: 'add', inputs: ['/sum', '/b'], output: '/total' },
    ],
    outputs: { total: '/total' },
  };
  const sources = { '/a': 2, '/b': 3 };
  const first = await runtime.execute(recipe, sources);
  const firstNormalized = normalizeAtlasObservation({ status: 'succeeded', result: first, inspection: runtime.inspect() });
  assert.equal(firstNormalized.status, 'succeeded');
  assert.deepEqual(firstNormalized.edges, [{ from: 'atlas-op-1', to: 'atlas-op-2', kind: 'data', inputIndex: 0 }]);
  assert.equal(firstNormalized.operations[0].status, 'succeeded');
  assert.deepEqual(firstNormalized.operations[0].parts.producer.input_addresses, ['/a', '/b']);
  assert.equal(firstNormalized.operations[1].outputAddress, '/total');

  await runtime.execute(recipe, sources);
  const cached = normalizeAtlasObservation(runtime.inspect());
  assert.equal(cached.status, 'succeeded');
  assert.ok(cached.operations.every((operation) => operation.status === 'cached' && operation.cacheHit));

  const failedRuntime = new AtlasRuntime({ add: (left, right) => left + right, explode: () => { throw new Error('fixture exploded'); } });
  const failureRecipe = {
    nodes: [
      { id: 'produced', calculation: 'add', inputs: ['/a', '/b'], output: '/sum' },
      { id: 'failed', calculation: 'explode', inputs: ['/sum', '/b'], output: '/failure' },
    ],
    outputs: { failure: '/failure' },
  };
  await assert.rejects(failedRuntime.execute(failureRecipe, sources), /fixture exploded/);
  const failed = normalizeAtlasObservation(failedRuntime.inspect());
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.operations.map((operation) => operation.status), ['succeeded', 'failed']);
  assert.deepEqual(failed.edges, [{ from: 'atlas-op-1', to: 'atlas-op-2', kind: 'data', inputIndex: 0 }]);

  const noTrace = normalizeAtlasObservation({ status: 'failed', result: { error: 'early failure' } });
  assert.equal(noTrace.status, 'failed');
  assert.deepEqual(noTrace.operations, []);
});

test('Atlas candidate keys preserve input/output arity and shared external input aliases without address names', async () => {
  const runtime = new AtlasRuntime({ add: (left, right) => left + right });
  const normalize = async (inputs, sources) => {
    const result = await runtime.execute({ nodes: [{ id: 'only-node', calculation: 'add', inputs, output: '/out' }], outputs: { out: '/out' } }, sources);
    return normalizeAtlasObservation(result);
  };
  const shared = await normalize(['/seed', '/seed'], { '/seed': 2 });
  const renamedShared = await normalize(['/different', '/different'], { '/different': 2 });
  const distinct = await normalize(['/left-seed', '/right-seed'], { '/left-seed': 2, '/right-seed': 2 });
  assert.deepEqual(shared.operations[0].externalInputAliases, [0, 0]);
  assert.deepEqual(distinct.operations[0].externalInputAliases, [0, 1]);
  assert.equal(shared.operations[0].inputCount, 2);
  assert.equal(shared.operations[0].outputCount, 1);
  assert.equal(flowCandidateKey(shared), flowCandidateKey(renamedShared));
  assert.notEqual(flowCandidateKey(shared), flowCandidateKey(distinct));
  const wrongArity = { operations: [{ ...shared.operations[0], inputCount: 3 }], edges: [] };
  assert.notEqual(flowCandidateKey(shared), flowCandidateKey(wrongArity));
});
