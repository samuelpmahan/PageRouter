import test from 'node:test';
import assert from 'node:assert/strict';
import { Part, PxC } from '../../vendor/studio/part-first-kernel/src/pxc.mjs';
import { createPartFirstHandler, createSceneHost, PXC_SCENE_HOST_API } from '../scene-host.mjs';

function handlerFor({ waitForCreate = null } = {}) {
  const created = [], disposed = [];
  const handler = createPartFirstHandler({
    id: 'test-pxc',
    async storeFor({ id }) {
      created.push(id);
      if (waitForCreate) await waitForCreate();
      const pxc = new PxC();
      pxc.set('fn.copy', new Part(({ value }) => structuredClone(value)));
      pxc.set('fn.fail', new Part(() => { throw Error('fixture failure'); }));
      return { id, pxc };
    },
    storeOf: world => world.pxc,
    makePart: value => new Part(value),
    isPart: value => value instanceof Part,
    dispose: world => { disposed.push(world.id); },
  });
  return { handler, created, disposed };
}

const copy = (id, requires, provides, mount) => ({ api: PXC_SCENE_HOST_API, id, requires, calculations: ['fn.copy'], provides, mount });
const worldInput = value => [{ address: 'px.source', value }];

test('worlds compose scene dependencies over one PxC store; world inputs are isolated and scoped Parts stay private', async () => {
  const state = handlerFor(), host = createSceneHost({ handler: state.handler });
  const first = copy('prepare', ['px.source'], [{ address: 'px.private', scope: 'scene' }, { address: 'px.shared', scope: 'world' }], async ctx => {
    const input = await ctx.get('px.source');
    await ctx.compose({ into: 'px.private', calculation: 'fn.copy', inputs: { value: 'px.source' } });
    await ctx.compose({ into: 'px.shared', calculation: 'fn.copy', inputs: { value: 'px.source' } });
    assert.equal(input.nested.value, 'same input');
  });
  const second = copy('finish', ['px.shared'], [{ address: 'px.final', scope: 'world' }], async ctx => {
    await ctx.compose({ into: 'px.final', calculation: 'fn.copy', inputs: { value: 'px.shared' } });
  });
  const original = { nested: { value: 'same input' } };
  const a = await host.composeWorld({ id: 'baseline', inputs: worldInput(original), scenes: [second, first] });
  const b = await host.composeWorld({ id: 'candidate', inputs: worldInput(original), scenes: [first, second] });
  original.nested.value = 'mutated after open';
  assert.equal((await a.read('px.final')).nested.value, 'same input');
  assert.deepEqual(a.inspect().scenes.map(scene => scene.id), ['prepare', 'finish']);
  assert.ok(!a.inspect().addresses.includes('px.private'));
  assert.ok(!a.inspect().scenes.flatMap(scene => scene.provides).includes('px.private'));
  await assert.rejects(a.read('px.private'), /not world-visible/);
  assert.deepEqual(a.scene('prepare').provides, ['px.private', 'px.shared']);
  const sourceA = await a.read('px.source'), sourceB = await b.read('px.source');
  assert.notEqual(sourceA, sourceB);
  sourceA.nested.value = 'edited in baseline';
  assert.equal((await b.read('px.source')).nested.value, 'same input');
});

test('close disposes once, releases identity, and reopen creates a fresh world', async () => {
  const state = handlerFor(), host = createSceneHost({ handler: state.handler });
  const scene = copy('one', ['px.source'], [{ address: 'px.out', scope: 'world' }], async ctx => {
    ctx.onDispose(() => { state.disposed.push('scene-cleanup'); });
    await ctx.compose({ into: 'px.out', calculation: 'fn.copy', inputs: { value: 'px.source' } });
  });
  const first = await host.composeWorld({ id: 'same', inputs: worldInput({ a: 1 }), scenes: [scene] });
  const firstPart = await first.read('px.out');
  await first.close(); await first.close();
  assert.throws(() => first.inspect(), /closed/);
  assert.deepEqual(host.listWorlds(), []);
  const reopened = await host.composeWorld({ id: 'same', inputs: worldInput({ a: 1 }), scenes: [scene] });
  assert.notEqual(await reopened.read('px.out'), firstPart);
  assert.deepEqual(state.disposed, ['scene-cleanup', 'same']);
  await reopened.close();
  assert.deepEqual(state.disposed, ['scene-cleanup', 'same', 'scene-cleanup', 'same']);
});

test('same-id open is reserved across async creation', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const state = handlerFor({ waitForCreate: () => wait }), host = createSceneHost({ handler: state.handler });
  const open = host.composeWorld({ id: 'racing', inputs: worldInput('x'), scenes: [] });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(host.composeWorld({ id: 'racing', inputs: worldInput('x'), scenes: [] }), /already open or opening/);
  release();
  const world = await open; await world.close();
  assert.deepEqual(state.created, ['racing']);
});

test('a caught failed calculation cannot produce a passing scene; failed setup is disposed and identity can reopen', async () => {
  const state = handlerFor(), host = createSceneHost({ handler: state.handler });
  const broken = { api: PXC_SCENE_HOST_API, id: 'broken', requires: ['px.source'], calculations: ['fn.fail'],
    provides: [{ address: 'px.out', scope: 'world' }], async mount(ctx) {
      try { await ctx.compose({ into: 'px.out', calculation: 'fn.fail', inputs: {} }); } catch {}
      await ctx.set('px.out', 'fallback');
    } };
  let failureEvidence;
  await assert.rejects(host.composeWorld({ id: 'retry', inputs: worldInput('x'), scenes: [broken] }), error => {
    assert.match(error.message, /failed PxC Calculation receipt/);
    failureEvidence = error.sceneFailureEvidence;
    return true;
  });
  assert.equal(failureEvidence.worldId, 'retry');
  assert.ok(failureEvidence.receipts.some(receipt => receipt.status === 'failed' && receipt.into === 'px.out'));
  assert.deepEqual(host.listWorlds(), []);
  const good = copy('good', ['px.source'], [{ address: 'px.out', scope: 'world' }], async ctx => {
    await ctx.compose({ into: 'px.out', calculation: 'fn.copy', inputs: { value: 'px.source' } });
  });
  const reopened = await host.composeWorld({ id: 'retry', inputs: worldInput('x'), scenes: [good] });
  assert.equal(await reopened.read('px.out'), 'x');
  await reopened.close();
});

test('scene cannot invoke an undeclared inline Calculation Part', async () => {
  const state = handlerFor(), host = createSceneHost({ handler: state.handler });
  const bad = { api: PXC_SCENE_HOST_API, id: 'badcalc', requires: ['px.source'], calculations: [],
    provides: [{ address: 'px.out', scope: 'world' }], async mount(ctx) {
      await ctx.compose({ into: 'px.out', calculation: 'fn.copy', inputs: { value: 'px.source' } });
    } };
  await assert.rejects(host.composeWorld({ id: 'declared', inputs: worldInput('x'), scenes: [bad] }), /must invoke a declared Calculation by address/);
});

test('a Part from a provider service cannot bypass scene binding declarations', async () => {
  const handler = createPartFirstHandler({ id: 'with-service',
    storeFor({ id }) { const pxc = new PxC(); pxc.set('fn.copy', new Part(({ value }) => value)); return { id, pxc }; },
    storeOf: world => world.pxc,
    serviceFor: (world, name) => name === 'foreign' ? { getHidden: () => world.pxc.get('px.source') } : undefined,
    makePart: value => new Part(value), isPart: value => value instanceof Part,
  });
  const host = createSceneHost({ handler });
  const bad = { api: PXC_SCENE_HOST_API, id: 'foreign-part', services: ['foreign'], requires: ['px.source'], calculations: ['fn.copy'],
    provides: [{ address: 'px.out', scope: 'world' }], async mount(ctx) {
      const foreign = ctx.service('foreign').getHidden();
      await ctx.compose({ into: 'px.out', calculation: 'fn.copy', inputs: { value: foreign } });
    } };
  await assert.rejects(host.composeWorld({ id: 'foreign', inputs: worldInput('x'), scenes: [bad] }), /Part created by ctx.part/);
});

test('a declared output collision fails before scene mount or calculation invocation', async () => {
  let invoked = 0, mounted = 0;
  const handler = createPartFirstHandler({ id: 'collision',
    storeFor() { const pxc = new PxC(); pxc.set('fn.copy', new Part(({ value }) => { invoked += 1; return value; })); pxc.set('px.out', new Part('previous owner')); return pxc; },
    makePart: value => new Part(value), isPart: value => value instanceof Part,
  });
  const host = createSceneHost({ handler });
  const scene = copy('collision', [], [{ address: 'px.out', scope: 'world' }], async () => { mounted += 1; });
  await assert.rejects(host.composeWorld({ id: 'collision', scenes: [scene] }), /output Part already exists/);
  assert.equal(mounted, 0); assert.equal(invoked, 0);
});
