const ROWS = 6;
const COLUMNS = 7;
const PLAYERS = Object.freeze(['red', 'yellow']);
const DIRECTIONS = Object.freeze([[0, 1], [1, 0], [1, 1], [1, -1]]);
const HINT = 'LEFT/RIGHT MOVE · A DROP · START RESET';

const clone = value => structuredClone(value);
const validPlayer = player => PLAYERS.includes(player);
const inBounds = (row, column) => row >= 0 && row < ROWS && column >= 0 && column < COLUMNS;

function fullBoard() {
  return Array.from({ length: ROWS }, () => Array(COLUMNS).fill(null));
}

export function createConnect4State({ cursorColumn = 3 } = {}) {
  return {
    board: fullBoard(),
    currentPlayer: 'red',
    status: 'playing',
    winner: null,
    moveCount: 0,
    cursorColumn: Number.isInteger(cursorColumn) && cursorColumn >= 0 && cursorColumn < COLUMNS ? cursorColumn : 3,
    notice: '',
  };
}

function winnerOn(board) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const player = board[row][column];
      if (!validPlayer(player)) continue;
      for (const [dr, dc] of DIRECTIONS) {
        let four = true;
        for (let step = 1; step < 4; step += 1) {
          const nextRow = row + dr * step;
          const nextColumn = column + dc * step;
          if (!inBounds(nextRow, nextColumn) || board[nextRow][nextColumn] !== player) {
            four = false;
            break;
          }
        }
        if (four) return player;
      }
    }
  }
  return null;
}

function snapshotIsValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.board) || value.board.length !== ROWS) return false;
  if (!Number.isInteger(value.cursorColumn) || value.cursorColumn < 0 || value.cursorColumn >= COLUMNS) return false;
  if (!value.board.every(row => Array.isArray(row) && row.length === COLUMNS && row.every(cell => cell === null || validPlayer(cell)))) return false;

  let red = 0, yellow = 0;
  for (let column = 0; column < COLUMNS; column += 1) {
    let foundGapBelow = false;
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      const cell = value.board[row][column];
      if (cell === null) foundGapBelow = true;
      else {
        if (foundGapBelow) return false;
        if (cell === 'red') red += 1;
        else yellow += 1;
      }
    }
  }
  if (red < yellow || red > yellow + 1 || value.moveCount !== red + yellow) return false;
  const winner = winnerOn(value.board);
  if (winner === 'red' && red !== yellow + 1) return false;
  if (winner === 'yellow' && red !== yellow) return false;
  if (winner) return value.status === 'won' && value.winner === winner;
  if (value.status === 'won' || value.winner !== null) return false;
  if (red + yellow === ROWS * COLUMNS) return value.status === 'draw';
  return value.status === 'playing';
}

// Save RAM contains plain JSON snapshots. Invalid or stale bytes start a fresh
// match instead of leaving a half-restored board on screen.
export function restoreConnect4State(value) {
  if (!snapshotIsValid(value)) return createConnect4State();
  const board = value.board.map(row => row.slice());
  const winner = winnerOn(board);
  const moveCount = board.flat().filter(cell => cell !== null).length;
  const status = winner ? 'won' : moveCount === ROWS * COLUMNS ? 'draw' : 'playing';
  const red = board.flat().filter(cell => cell === 'red').length;
  return {
    board,
    currentPlayer: status === 'playing' ? (red === moveCount - red ? 'red' : 'yellow') : null,
    status,
    winner,
    moveCount,
    cursorColumn: value.cursorColumn,
    notice: typeof value.notice === 'string' ? value.notice.slice(0, 48) : '',
  };
}

function result(state, accepted, reason = null) {
  return { accepted, reason, state };
}

function rejected(state, reason, notice) {
  return result({ ...clone(state), notice }, false, reason);
}

function lowestEmptyRow(board, column) {
  for (let row = ROWS - 1; row >= 0; row -= 1) if (board[row][column] === null) return row;
  return -1;
}

export function applyConnect4Event(previous, event) {
  const state = clone(previous);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return rejected(state, 'invalid-event', 'INVALID MOVE');

  if (event.type === 'reset') return result(createConnect4State(), true);

  if (event.type === 'move') {
    if (state.status !== 'playing') return rejected(state, 'game-over', 'PRESS START TO RESET');
    if (event.delta !== -1 && event.delta !== 1) return rejected(state, 'invalid-move', 'INVALID MOVE');
    state.cursorColumn = Math.max(0, Math.min(COLUMNS - 1, state.cursorColumn + event.delta));
    state.notice = '';
    return result(state, true);
  }

  if (event.type === 'drop') {
    if (state.status !== 'playing') return rejected(state, 'game-over', 'PRESS START TO RESET');
    const column = event.column === undefined ? state.cursorColumn : event.column;
    if (!Number.isInteger(column) || column < 0 || column >= COLUMNS) return rejected(state, 'invalid-column', 'INVALID COLUMN');
    const row = lowestEmptyRow(state.board, column);
    if (row < 0) return rejected(state, 'column-full', 'COLUMN FULL');

    const player = state.currentPlayer;
    state.board[row][column] = player;
    state.cursorColumn = column;
    state.moveCount += 1;
    state.notice = '';
    const winner = winnerOn(state.board);
    if (winner) {
      state.status = 'won';
      state.winner = winner;
      state.currentPlayer = null;
    } else if (state.moveCount === ROWS * COLUMNS) {
      state.status = 'draw';
      state.currentPlayer = null;
    } else {
      state.currentPlayer = player === 'red' ? 'yellow' : 'red';
    }
    return result(state, true);
  }

  return rejected(state, 'invalid-event', 'INVALID MOVE');
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

function treeNode(tag, attrs = {}, children = []) {
  return { tag, attrs, children };
}

function statusText(state) {
  if (state.notice) return state.notice;
  if (state.status === 'won') return `${state.winner.toUpperCase()} WINS`;
  if (state.status === 'draw') return 'DRAW GAME';
  return `${state.currentPlayer.toUpperCase()} TO PLAY`;
}

function hintText(state) {
  if (state.notice === 'COLUMN FULL') return 'PICK ANOTHER COLUMN · START RESET';
  if (state.status !== 'playing') return 'PRESS START TO RESET';
  return HINT;
}

export function projectConnect4Tree(state) {
  const board = treeNode('board', { rows: ROWS, columns: COLUMNS }, state.board.map((line, row) => treeNode(
    'row', { row }, line.map((player, column) => treeNode('cell', {
      row,
      column,
      player,
      preview: state.status === 'playing' && column === state.cursorColumn && row === lowestEmptyRow(state.board, column),
    })),
  )));
  return freezeTree(treeNode('connect4-screen', {
    phase: state.status,
    currentPlayer: state.currentPlayer,
    winner: state.winner,
    cursorColumn: state.cursorColumn,
    statusText: statusText(state),
    hintText: hintText(state),
  }, [board]));
}

export const CONNECT4_DIMENSIONS = Object.freeze({ rows: ROWS, columns: COLUMNS });
