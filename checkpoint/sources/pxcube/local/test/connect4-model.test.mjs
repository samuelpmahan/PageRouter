import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnect4PlainRuntime } from '../../experiences/connect4/model.mjs';
import { createConnect4State } from '../../experiences/connect4/rules.mjs';
import { drawColumns, dropEvents, winFixtures } from './connect4-fixtures.mjs';

async function play(columns) {
  const runtime = createConnect4PlainRuntime();
  for (const event of dropEvents(columns)) {
    const result = await runtime.dispatch(event);
    assert.equal(result.accepted, true);
  }
  return runtime;
}

test('plain model emits the agreed frozen canvas tree from current game state', async () => {
  const runtime = createConnect4PlainRuntime();
  await runtime.dispatch({ type: 'move', delta: -1 });
  let tree = await runtime.seek();
  assert.equal(tree.tag, 'connect4-screen');
  assert.deepEqual(tree.attrs, {
    phase: 'playing', currentPlayer: 'red', winner: null, cursorColumn: 2,
    statusText: 'RED TO PLAY', hintText: 'LEFT/RIGHT MOVE · A DROP · START RESET',
  });
  assert.equal(tree.children[0].tag, 'board');
  assert.deepEqual(tree.children[0].attrs, { rows: 6, columns: 7 });
  assert.equal(tree.children[0].children.length, 6);
  assert.ok(tree.children[0].children.every(row => row.children.length === 7));
  assert.ok(Object.isFrozen(tree) && Object.isFrozen(tree.attrs) && Object.isFrozen(tree.children));

  await runtime.dispatch({ type: 'drop' });
  tree = await runtime.seek();
  assert.equal(tree.children[0].children[5].children[2].attrs.player, 'red');
  assert.equal(tree.children[0].children[4].children[2].attrs.preview, true);
});

test('plain model returns a cloned, reloadable save snapshot', async () => {
  const runtime = createConnect4PlainRuntime();
  for (const event of dropEvents([0, 1, 0, 1])) await runtime.dispatch(event);
  const saved = runtime.state();
  const reloaded = createConnect4PlainRuntime({ initialState: saved });
  assert.deepEqual(reloaded.state(), saved);
  saved.board[5][0] = null;
  assert.equal(reloaded.state().board[5][0], 'red');
  assert.deepEqual(createConnect4PlainRuntime({ initialState: createConnect4State() }).state(), createConnect4State());
});

for (const fixture of winFixtures) {
  test(`plain runtime accepts shared ${fixture.name} fixture`, async () => {
    const runtime = await play(fixture.columns);
    assert.equal(runtime.state().status, 'won');
    assert.equal(runtime.state().winner, fixture.winner);
  });
}

test('plain runtime accepts the shared draw fixture and rejects full-column input', async () => {
  const draw = await play(drawColumns);
  assert.equal(draw.state().status, 'draw');
  assert.equal(draw.state().moveCount, 42);

  const full = await play([3, 3, 3, 3, 3, 3]);
  const before = full.state();
  const rejected = await full.dispatch({ type: 'drop' });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'column-full');
  assert.deepEqual(full.state().board, before.board);
});
