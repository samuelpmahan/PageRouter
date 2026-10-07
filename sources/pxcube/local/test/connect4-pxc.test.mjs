import test from 'node:test';
import assert from 'node:assert/strict';
import { Part, PxC } from '../../../../vendor/hh/services/pxc.mjs';
import { createConnect4PxCRuntime } from '../../experiences/connect4-pxc/model.mjs';
import { dropEvents, drawColumns, winFixtures } from './connect4-fixtures.mjs';

async function play(columns) {
  const runtime = createConnect4PxCRuntime({ Part, PxC });
  for (const event of dropEvents(columns)) {
    const result = await runtime.dispatch(event);
    assert.equal(result.accepted, true);
  }
  return runtime;
}

test('PxC port preserves the baseline UI tree and emits actual projection receipts', async () => {
  const runtime = createConnect4PxCRuntime({ Part, PxC });
  const before = runtime.inspect();
  assert.ok(before.parts.some(part => part.address === 'connect4.transition' && part.valueType === 'function'));
  assert.ok(before.parts.some(part => part.address === 'connect4.seek' && part.valueType === 'function'));
  const part = runtime.pxc.get('connect4.seek');
  assert.ok(part instanceof Part);

  const transition = await runtime.dispatch({ type: 'drop', column: 3 });
  assert.equal(transition.accepted, true);
  const tree = await runtime.seek();
  assert.equal(tree.tag, 'connect4-screen');
  assert.equal(tree.attrs.currentPlayer, 'yellow');
  assert.equal(tree.children[0].children[5].children[3].attrs.player, 'red');
  const after = runtime.inspect();
  assert.deepEqual(after.receipts.map(receipt => receipt.kind), ['transition', 'state', 'projection']);
  assert.ok(after.receipts.every(receipt => receipt.status === 'produced'));
  assert.equal(after.receipts[0].calculation, 'connect4.transition');
  assert.equal(after.receipts[1].calculation, 'connect4.state');
  assert.equal(after.receipts[2].calculation, 'connect4.seek');
});

for (const fixture of winFixtures) {
  test(`PxC runtime accepts shared ${fixture.name} fixture`, async () => {
    const runtime = await play(fixture.columns);
    assert.equal(runtime.state().status, 'won');
    assert.equal(runtime.state().winner, fixture.winner);
  });
}

test('PxC runtime accepts the shared draw fixture and rejects full-column input', async () => {
  const draw = await play(drawColumns);
  assert.equal(draw.state().status, 'draw');
  assert.equal(draw.state().moveCount, 42);

  const full = await play([3, 3, 3, 3, 3, 3]);
  const before = full.state();
  const rejected = await full.dispatch({ type: 'drop' });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'column-full');
  assert.deepEqual(full.state().board, before.board);
  const after = full.inspect();
  assert.equal(after.receipts.at(-1).status, 'produced');
});

test('save reload and inspection preserve state without per-frame calculation', async () => {
  const runtime = createConnect4PxCRuntime({ Part, PxC });
  await runtime.dispatch({ type: 'drop', column: 1 });
  const state = runtime.state();
  const receipts = runtime.inspect().receipts.length;
  assert.deepEqual(runtime.state(), state);
  assert.deepEqual(runtime.inspect().receipts.length, receipts);

  const reloaded = createConnect4PxCRuntime({ initialState: state, Part, PxC });
  assert.deepEqual(reloaded.state(), state);
  assert.equal(reloaded.inspect().receipts.length, 0);
});

test('PxC port records rejected drops and reset through the same rules as baseline', async () => {
  const { createConnect4PlainRuntime } = await import('../../experiences/connect4/model.mjs');
  const plain = createConnect4PlainRuntime();
  const pxc = createConnect4PxCRuntime({ Part, PxC });
  for (const runtime of [plain, pxc]) {
    for (const event of dropEvents([3, 3, 3, 3, 3, 3])) await runtime.dispatch(event);
  }
  const plainBlocked = await plain.dispatch({ type: 'drop' });
  const pxcBlocked = await pxc.dispatch({ type: 'drop' });
  assert.equal(pxcBlocked.accepted, false);
  assert.equal(pxcBlocked.reason, 'column-full');
  assert.deepEqual(pxc.state(), plain.state());
  assert.deepEqual(await pxc.seek(), await plain.seek());

  const afterReset = await pxc.dispatch({ type: 'reset' });
  await plain.dispatch({ type: 'reset' });
  assert.equal(afterReset.accepted, true);
  assert.deepEqual(pxc.state(), plain.state());
  assert.equal(pxc.state().moveCount, 0);
  assert.equal(pxc.inspect().receipts.at(-1).kind, 'state');
});

test('PxC port and plain baseline produce identical state and trees for the shared win fixtures', async () => {
  const { createConnect4PlainRuntime } = await import('../../experiences/connect4/model.mjs');
  for (const fixture of winFixtures) {
    const plain = createConnect4PlainRuntime();
    const pxc = createConnect4PxCRuntime({ Part, PxC });
    for (const event of dropEvents(fixture.columns)) {
      await plain.dispatch(event);
      await pxc.dispatch(event);
    }
    assert.deepEqual(pxc.state(), plain.state(), fixture.name);
    assert.deepEqual(await pxc.seek(), await plain.seek(), fixture.name);
  }
  const plainDraw = createConnect4PlainRuntime();
  const pxcDraw = createConnect4PxCRuntime({ Part, PxC });
  for (const event of dropEvents(drawColumns)) {
    await plainDraw.dispatch(event);
    await pxcDraw.dispatch(event);
  }
  assert.deepEqual(pxcDraw.state(), plainDraw.state(), 'draw');
  assert.deepEqual(await pxcDraw.seek(), await plainDraw.seek(), 'draw');
});
