import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConnect4Event, createConnect4State } from '../../experiences/connect4/rules.mjs';
import { drawColumns, dropEvents, winFixtures } from './connect4-fixtures.mjs';

function play(columns) {
  let state = createConnect4State();
  for (const event of dropEvents(columns)) {
    const result = applyConnect4Event(state, event);
    assert.equal(result.accepted, true, `fixture move ${event.column} must be legal`);
    state = result.state;
  }
  return state;
}

test('new game is an empty 7 by 6 board with red to move', () => {
  const state = createConnect4State();
  assert.equal(state.board.length, 6);
  assert.ok(state.board.every(row => row.length === 7 && row.every(cell => cell === null)));
  assert.equal(state.currentPlayer, 'red');
  assert.equal(state.status, 'playing');
  assert.equal(state.winner, null);
  assert.equal(state.moveCount, 0);
});

test('legal drops obey gravity and alternate players', () => {
  let state = createConnect4State();
  state = applyConnect4Event(state, { type: 'drop', column: 2 }).state;
  state = applyConnect4Event(state, { type: 'drop', column: 2 }).state;
  assert.equal(state.board[5][2], 'red');
  assert.equal(state.board[4][2], 'yellow');
  assert.equal(state.currentPlayer, 'red');
  assert.equal(state.moveCount, 2);
});

for (const fixture of winFixtures) {
  test(`detects a ${fixture.name} four-in-a-row`, () => {
    const state = play(fixture.columns);
    assert.equal(state.status, 'won');
    assert.equal(state.winner, fixture.winner);
    assert.equal(state.currentPlayer, null);
    assert.equal(state.moveCount, fixture.columns.length);
  });
}

test('the 42nd legal move is a draw when neither player has four', () => {
  const state = play(drawColumns);
  assert.equal(state.moveCount, 42);
  assert.ok(state.board.every(row => row.every(cell => cell !== null)));
  assert.equal(state.status, 'draw');
  assert.equal(state.winner, null);
  assert.equal(state.currentPlayer, null);
});

test('full columns and out-of-range columns reject without changing the game', () => {
  let state = play([3, 3, 3, 3, 3, 3]);
  const full = applyConnect4Event(state, { type: 'drop', column: 3 });
  assert.equal(full.accepted, false);
  assert.equal(full.reason, 'column-full');
  assert.equal(full.state.moveCount, state.moveCount);
  assert.equal(full.state.currentPlayer, state.currentPlayer);
  assert.deepEqual(full.state.board, state.board);

  state = createConnect4State();
  const outside = applyConnect4Event(state, { type: 'drop', column: 7 });
  assert.equal(outside.accepted, false);
  assert.equal(outside.reason, 'invalid-column');
  assert.deepEqual(outside.state.board, state.board);
  assert.equal(outside.state.moveCount, 0);
});

test('a completed game rejects further drops, and reset starts a fresh match', () => {
  const won = play(winFixtures[0].columns);
  const blocked = applyConnect4Event(won, { type: 'drop', column: 4 });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, 'game-over');
  assert.equal(blocked.state.winner, 'red');
  assert.deepEqual(blocked.state.board, won.board);

  const reset = applyConnect4Event(won, { type: 'reset' });
  assert.equal(reset.accepted, true);
  assert.deepEqual(reset.state, createConnect4State());
});

test('cursor movement clamps to the board and records no game turn', () => {
  let state = createConnect4State();
  const left = applyConnect4Event(state, { type: 'move', delta: -1 });
  assert.equal(left.accepted, true);
  assert.equal(left.state.cursorColumn, 2);
  assert.equal(left.state.moveCount, 0);
  state = left.state;
  const clamped = applyConnect4Event(state, { type: 'move', delta: -1 });
  assert.equal(clamped.state.cursorColumn, 1);
  const edge = applyConnect4Event(createConnect4State({ cursorColumn: 0 }), { type: 'move', delta: -1 });
  assert.equal(edge.state.cursorColumn, 0);
});
