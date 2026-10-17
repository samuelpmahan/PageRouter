import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationIndex } from './core.mjs';
import { createLabMessageHandler, LAB_OBSERVATION_SCHEMA, observeLabRun } from './lab-bridge.mjs';

const receipt = (id = 'stats.mean') => ({
  id,
  input: { values: [1, 2] },
  result: 1.5,
  trace: { id, order: 1, calls: [] },
  identity: { source: 'capability-lab-browser', version: '0.1.0' },
  replay: { inputHash: 'a1', resultHash: 'b2', seed: null },
});

function fakeWindow() {
  const messages = [];
  const env = { location: { origin: 'https://lab.example' } };
  env.parent = { postMessage: (...args) => messages.push(args) };
  return { env, messages };
}

test('observeLabRun records the synchronous success boundary and preserves result', () => {
  const { env, messages } = fakeWindow();
  let time = 100;
  const expected = receipt();
  const result = observeLabRun({ action: 'execute', id: expected.id, run: () => expected, env, now: () => time++ });
  assert.equal(result, expected);
  assert.equal(messages.length, 1);
  assert.equal(messages[0][1], 'https://lab.example');
  assert.deepEqual({ ...messages[0][0], receiptKey: undefined }, {
    schema: LAB_OBSERVATION_SCHEMA, action: 'execute', id: 'stats.mean',
    startedAt: 100, finishedAt: 101, status: 'succeeded', execution: expected, receiptKey: undefined,
  });
  assert.match(messages[0][0].receiptKey, /^lab-receipt-/);
});

test('observeLabRun reports a failed attempt without a fabricated execution and rethrows original error', () => {
  const { env, messages } = fakeWindow();
  const error = new Error('native validation failed');
  let time = 10;
  assert.throws(() => observeLabRun({ action: 'execute', id: 'stats.mean', run: () => { throw error; }, env, now: () => time++ }), caught => caught === error);
  assert.deepEqual(messages[0][0], {
    schema: LAB_OBSERVATION_SCHEMA, action: 'execute', id: 'stats.mean',
    startedAt: 10, finishedAt: 11, status: 'failed', error: 'native validation failed',
  });
  assert.equal('execution' in messages[0][0], false);
});

test('observer delivery problems do not change native success or native failure', () => {
  const env = { location: { origin: 'https://lab.example' }, parent: { postMessage() { throw new Error('blocked'); } } };
  assert.equal(observeLabRun({ action: 'execute', id: 'x.y', run: () => 42, env }), 42);
  const native = new Error('native');
  assert.throws(() => observeLabRun({ action: 'execute', id: 'x.y', run: () => { throw native; }, env }), error => error === native);
});

test('producer receipt keys are isolated by module session and a clock failure cannot mask native results', () => {
  const firstSession = fakeWindow();
  const secondSession = fakeWindow();
  const prior = receipt();
  observeLabRun({ action: 'execute', id: prior.id, run: () => prior, env: firstSession.env, sessionId: 'frame-session-a' });
  observeLabRun({ action: 'execute', id: prior.id, run: () => prior, env: secondSession.env, sessionId: 'frame-session-b' });
  const firstKey = firstSession.messages[0][0].receiptKey;
  const secondKey = secondSession.messages[0][0].receiptKey;
  assert.notEqual(firstKey, secondKey);
  assert.match(firstKey, /^lab-receipt-frame-session-a-/);
  assert.match(secondKey, /^lab-receipt-frame-session-b-/);

  const { env, messages } = fakeWindow();
  assert.equal(observeLabRun({ action: 'execute', id: prior.id, run: () => prior, env, now: () => { throw new Error('clock unavailable'); }, sessionId: 'safe-clock' }), prior);
  assert.equal(Number.isFinite(messages[0][0].startedAt), true);
  assert.equal(Number.isFinite(messages[0][0].finishedAt), true);
});

test('replay sends native replay metadata plus a prior receipt reference', () => {
  const { env, messages } = fakeWindow();
  const prior = receipt();
  const report = { receipt: receipt(), matches: false, exact: true, hash: false, mismatches: ['resultHash'] };
  const got = observeLabRun({ action: 'replay', id: prior.id, prior, run: () => report, env });
  assert.equal(got, report);
  const message = messages[0][0];
  assert.equal(message.execution, report.receipt);
  const { priorReceiptKey, ...replayMetadata } = message.replay;
  assert.match(priorReceiptKey, /^lab-receipt-/);
  assert.deepEqual(replayMetadata, { matches: false, exact: true, hash: false, mismatches: ['resultHash'] });
});

test('receiver enforces frame and origin, records host source, and joins replay only to an observed prior receipt', () => {
  const frameWindow = {};
  const frame = { contentWindow: frameWindow };
  const index = createOperationIndex({ idFactory: (() => { let i = 0; return () => `host-${++i}`; })(), now: () => 'now' });
  const handler = createLabMessageHandler({ getFrame: () => frame, origin: 'https://lab.example', index, source: { artifact: 'pinned-lab' } });
  const first = receipt();
  const executeMessage = { schema: LAB_OBSERVATION_SCHEMA, action: 'execute', id: first.id, startedAt: 1, finishedAt: 2, status: 'succeeded', execution: first, receiptKey: 'producer-receipt-1' };
  assert.equal(handler({ origin: 'https://evil.example', source: frameWindow, data: executeMessage }), false);
  assert.equal(handler({ origin: 'https://lab.example', source: {}, data: executeMessage }), false);
  assert.equal(index.list().length, 0);
  const run = handler({ origin: 'https://lab.example', source: frameWindow, data: executeMessage });
  assert.equal(run.id, 'host-1');
  assert.deepEqual(run.source, { artifact: 'pinned-lab' });
  const replayMessage = {
    schema: LAB_OBSERVATION_SCHEMA, action: 'replay', id: first.id, startedAt: 3, finishedAt: 4, status: 'succeeded',
    execution: receipt(), receiptKey: 'producer-receipt-2', replay: { matches: true, exact: true, hash: true, mismatches: [], priorReceiptKey: 'producer-receipt-1' },
  };
  const replayRun = handler({ origin: 'https://lab.example', source: frameWindow, data: replayMessage });
  assert.equal(replayRun.replayOf, 'host-1');
  assert.equal(replayRun.status, 'succeeded');
});

test('receiver rejects invalid schema, non-finite values, and oversized payloads without mutation', () => {
  const frameWindow = {};
  const index = createOperationIndex({ idFactory: () => 'host', now: () => 'now' });
  const handler = createLabMessageHandler({ getFrame: () => ({ contentWindow: frameWindow }), origin: 'https://lab.example', index, source: 'host-pin', maxBytes: 1024 });
  const base = { schema: LAB_OBSERVATION_SCHEMA, action: 'execute', id: 'stats.mean', startedAt: 1, finishedAt: 2, status: 'succeeded', execution: receipt(), receiptKey: 'producer-receipt' };
  assert.equal(handler({ origin: 'https://lab.example', source: frameWindow, data: { ...base, schema: 'wrong' } }), false);
  assert.equal(handler({ origin: 'https://lab.example', source: frameWindow, data: { ...base, startedAt: Infinity } }), false);
  assert.equal(handler({ origin: 'https://lab.example', source: frameWindow, data: { ...base, execution: { ...receipt(), tooBig: 'x'.repeat(2000) } } }), false);
  assert.equal(index.list().length, 0);
});

test('receiver never joins a replay to a receipt key from another producer session', () => {
  const frameWindow = {};
  const index = createOperationIndex({ idFactory: (() => { let i = 0; return () => `session-host-${++i}`; })(), now: () => 'now' });
  const handler = createLabMessageHandler({ getFrame: () => ({ contentWindow: frameWindow }), origin: 'https://lab.example', index, source: 'host-pin' });
  const prior = receipt();
  const executeMessage = { schema: LAB_OBSERVATION_SCHEMA, action: 'execute', id: prior.id, startedAt: 1, finishedAt: 2, status: 'succeeded', execution: prior, receiptKey: 'lab-receipt-session-a-1' };
  handler({ origin: 'https://lab.example', source: frameWindow, data: executeMessage });
  const replayMessage = {
    schema: LAB_OBSERVATION_SCHEMA, action: 'replay', id: prior.id, startedAt: 3, finishedAt: 4, status: 'succeeded', execution: receipt(), receiptKey: 'lab-receipt-session-b-1',
    replay: { matches: true, exact: true, hash: true, mismatches: [], priorReceiptKey: 'lab-receipt-session-b-999' },
  };
  const replayRun = handler({ origin: 'https://lab.example', source: frameWindow, data: replayMessage });
  assert.equal('replayOf' in replayRun, false);
});
