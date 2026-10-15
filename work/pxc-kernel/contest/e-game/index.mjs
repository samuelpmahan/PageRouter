// Contest E (round 3, kernel v0.3): a two-player game (tic-tac-toe) where each seat is played by an
// interchangeable policy.
//
// Round 1 had to register every policy three times (policy.choose, policy.choose@X, policy.choose@O) because
// `fill` chose one implementation per contract. v0.2 has slots: a match is filled with
// { 'policy.choose#X': ..., 'policy.choose#O': ... }. Round 3 (v0.3) adds: slots declared in `uses` (a typo in a
// fill fails), the pass-through ply and the forfeit as declared branches (`when` / `first`) and as recorded decisions
// (`ctx.when`), the whole match as `ctx.drive` over the tick contract, `ctx.concat` for the move list, examples with
// `fill`/`ticks` on contracts and implementations, and `world.node`/`world.ref` to read into cached calls and to
// branch a game from a recorded position. FRICTION.md records what still does not fit.
//
// Board: array of 9 cells, row-major, 0 empty / 1 X / 2 O.
//   0 1 2
//   3 4 5
//   6 7 8

const cellSchema = { type: 'integer', minimum: 0, maximum: 8 };
const boardSchema = { type: 'array', minItems: 9, maxItems: 9, items: { type: 'integer', minimum: 0, maximum: 2 } };
const playerSchema = { type: 'integer', minimum: 1, maximum: 2 };
const statusSchema = { type: 'string', enum: ['ongoing', 'X', 'O', 'draw'] };
const cellsSchema = { type: 'array', maxItems: 9, items: cellSchema };
const lineSchema = { type: 'array', maxItems: 3, items: cellSchema };
const moveSchema = { type: 'object', required: ['player', 'cell'], properties: { player: playerSchema, cell: cellSchema } };
const movesSchema = { type: 'array', maxItems: 9, items: moveSchema };
const matchState = { type: 'object', required: ['board', 'status', 'moves'], properties: { board: boardSchema, status: statusSchema, moves: movesSchema } };

export const EMPTY_BOARD = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const LINES = Object.freeze([[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]);
export const POLICY_NAMES = Object.freeze(['first-empty', 'center-corners', 'random', 'minimax']);
/** Registered too, but kept out of the tournament: it models its opponent through a slot (see POLICIES.mirror). */
export const MODEL_POLICIES = Object.freeze(['mirror']);
export const MARK = Object.freeze({ 1: 'X', 2: 'O' });

/** Implementation id of a policy: `policy.choose/<name>`. */
export const policyId = (name) => `policy.choose/${name}`;
/** The fill that seats policy `x` as X and policy `o` as O: one fill key per slot. */
export const fillFor = (x, o) => ({ 'policy.choose#X': policyId(x), 'policy.choose#O': policyId(o) });

const need = (cells) => { if (cells.length === 0) throw new Error('no legal move: the board is full'); };

// ---- the policies. Each picks an index into the legalMoves output and returns ctx.at(cells, index),
//      so the chosen cell's provenance is "a path into game.legalMoves' output", not "computed".
const CENTER_CORNERS_ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7];

const POLICIES = {
  'first-empty': {
    uses: ['game.legalMoves'],
    description: 'lowest-numbered empty cell',
    examples: [
      { in: { board: [0, 0, 0, 0, 0, 0, 0, 0, 0], player: 1 }, out: { cell: 0 } },
      { in: { board: [1, 2, 1, 0, 0, 0, 0, 0, 0], player: 1 }, out: { cell: 3 } },
    ],
    run: ({ board }, ctx) => {
      const { cells } = ctx.call('game.legalMoves', { board });
      need(cells.value);
      return { cell: ctx.at(cells, 0) };
    },
  },
  'center-corners': {
    uses: ['game.legalMoves'],
    description: 'centre if empty, else first empty corner (0,2,6,8), else first empty edge (1,3,5,7)',
    examples: [
      { in: { board: [0, 0, 0, 0, 0, 0, 0, 0, 0], player: 1 }, out: { cell: 4 } },
      { in: { board: [0, 0, 0, 0, 2, 0, 0, 0, 0], player: 1 }, out: { cell: 0 } },
      { in: { board: [1, 0, 2, 0, 2, 0, 0, 0, 0], player: 1 }, out: { cell: 6 } },
      { in: { board: [1, 0, 2, 0, 2, 0, 1, 0, 2], player: 1 }, out: { cell: 1 } }, // centre and corners gone: first edge
    ],
    run: ({ board }, ctx) => {
      const { cells } = ctx.call('game.legalMoves', { board });
      need(cells.value);
      const pick = CENTER_CORNERS_ORDER.find((c) => cells.value.includes(c));
      return { cell: ctx.at(cells, cells.value.indexOf(pick)) };
    },
  },
  random: {
    uses: ['game.legalMoves'],
    description: 'uniform over legal cells using ctx.random() (the kernel marks it, and everything above it, impure)',
    run: ({ board }, ctx) => {
      const { cells } = ctx.call('game.legalMoves', { board });
      need(cells.value);
      return { cell: ctx.at(cells, Math.floor(ctx.random() * cells.value.length)) };
    },
  },
  mirror: {
    uses: ['policy.choose#opp'],
    description: 'takes the cell its model of the opponent would take on this board: asks the policy in slot `opp` (as the other player). Which policy models the opponent is a fill, and a path fill reaches only this seat\'s model.',
    examples: [
      // the model seat `opp` is pinned to first-empty by world.select (below), so prove's contract fill does not reach it (v0.5)
      { name: 'the mirror takes what its pinned first-empty model takes', in: { board: [1, 2, 1, 0, 0, 0, 0, 0, 0], player: 1 }, out: { cell: 3 } },
      // a different model is a choice, not a workaround: this fill is kept
      { name: 'a mirror modelled on center-corners takes the center', in: { board: [0, 0, 0, 0, 0, 0, 0, 0, 0], player: 1 }, fill: { 'policy.choose#opp': 'policy.choose/center-corners' }, out: { cell: 4 } },
    ],
    run: ({ board, player }, ctx) => {
      const { cell } = ctx.call('policy.choose', { board, player: ctx.literal(3 - player.value) }, { slot: 'opp' });
      return { cell };
    },
  },
  minimax: {
    uses: ['game.legalMoves', 'game.apply', 'game.outcome'],
    description: 'perfect play: negamax over the whole game tree, every move and win test through game.* contracts. A quicker win scores higher, a slower loss scores higher, ties go to the lowest cell.',
    examples: [
      { in: { board: [1, 1, 0, 2, 2, 0, 0, 0, 0], player: 1 }, out: { cell: 2 } }, // take the win, not the block at 5
      { in: { board: [1, 1, 0, 0, 2, 0, 0, 0, 0], player: 2 }, out: { cell: 2 } }, // every other cell loses to 0-1-2
      { in: { board: [2, 2, 0, 1, 1, 0, 0, 0, 0], player: 1 }, out: { cell: 5 } }, // win now (3-4-5) beats blocking at 2
    ],
    run: ({ board, player }, ctx) => {
      const memo = new Map(); // per-invocation transposition table, keyed by board hash and mover
      const lit = {};
      const mark = (m) => (lit[m] ??= ctx.literal(m));
      const empties = (b) => b.filter((c) => c === 0).length;
      // value of the position for `mover`, who is to move on board ref `b`
      const score = (b, mover) => {
        const key = `${b.hash}:${mover}`;
        if (memo.has(key)) return memo.get(key);
        const { status } = ctx.call('game.outcome', { board: b });
        let v;
        if (status.value === 'draw') v = 0;
        else if (status.value !== 'ongoing') v = -(empties(b.value) + 1); // the other player just completed a line
        else {
          const { cells } = ctx.call('game.legalMoves', { board: b });
          v = -Infinity;
          cells.value.forEach((_, i) => {
            const { board: nb } = ctx.call('game.apply', { board: b, player: mark(mover), cell: ctx.at(cells, i) });
            v = Math.max(v, -score(nb, 3 - mover));
          });
        }
        memo.set(key, v);
        return v;
      };
      const { status } = ctx.call('game.outcome', { board });
      if (status.value !== 'ongoing') throw new Error(`minimax: the game is already over (${status.value})`);
      const { cells } = ctx.call('game.legalMoves', { board });
      let best = -Infinity; let bestIndex = -1;
      cells.value.forEach((_, i) => {
        const { board: nb } = ctx.call('game.apply', { board, player, cell: ctx.at(cells, i) });
        const v = -score(nb, 3 - player.value);
        if (v > best) { best = v; bestIndex = i; }
      });
      return { cell: ctx.at(cells, bestIndex) };
    },
  },
};

/** A rule-breaker for the legality check: always cell 0. Registered separately so that `register` stays a clean set. */
export function registerStubborn(world) {
  world.implement({ id: policyId('stubborn'), implements: 'policy.choose', uses: [],
    description: 'always cell 0, legal or not (fixture for game.moveLegal; fails its own contract examples on purpose)',
    run: (_, ctx) => ({ cell: ctx.literal(0) }) });
}

export function register(world) {
  const C = (def) => world.contract(def);
  const I = (def) => world.implement(def);

  // ---------------------------------------------------------------- the game
  C({ id: 'game.legalMoves', in: { board: boardSchema }, out: { cells: cellsSchema },
    description: 'Empty cells in ascending order. Says nothing about whether the game is over.',
    examples: [
      { in: { board: [0, 0, 0, 0, 0, 0, 0, 0, 0] }, out: { cells: [0, 1, 2, 3, 4, 5, 6, 7, 8] } },
      { in: { board: [1, 2, 1, 0, 0, 0, 0, 0, 0] }, out: { cells: [3, 4, 5, 6, 7, 8] } },
      { in: { board: [1, 2, 1, 2, 1, 2, 2, 1, 2] }, out: { cells: [] } },
    ] });
  I({ id: 'game.legalMoves/scan', implements: 'game.legalMoves',
    run: ({ board }) => ({ cells: board.value.flatMap((v, i) => (v === 0 ? [i] : [])) }) });

  C({ id: 'game.apply', in: { board: boardSchema, player: playerSchema, cell: cellSchema }, out: { board: boardSchema },
    description: 'Place `player` on `cell`. Throws on an occupied cell (malformed input; ask game.moveLegal first). Does not check whose turn it is.',
    examples: [
      { in: { board: [0, 0, 0, 0, 0, 0, 0, 0, 0], player: 1, cell: 4 }, out: { board: [0, 0, 0, 0, 1, 0, 0, 0, 0] } },
      { in: { board: [1, 0, 0, 0, 2, 0, 0, 0, 0], player: 1, cell: 8 }, out: { board: [1, 0, 0, 0, 2, 0, 0, 0, 1] } },
    ] });
  I({ id: 'game.apply/place', implements: 'game.apply', run: ({ board, player, cell }) => {
    if (board.value[cell.value] !== 0) throw new Error(`cell ${cell.value} is occupied`);
    return { board: board.value.map((v, i) => (i === cell.value ? player.value : v)) };
  } });

  C({ id: 'game.outcome', in: { board: boardSchema }, out: { status: statusSchema, line: lineSchema },
    description: "'X' or 'O' when that mark fills a row, column or diagonal (line = the three cells), 'draw' when the board is full with no line, else 'ongoing'.",
    examples: [
      { in: { board: [1, 1, 1, 2, 2, 0, 0, 0, 0] }, out: { status: 'X', line: [0, 1, 2] } },
      { in: { board: [2, 1, 0, 1, 2, 0, 0, 1, 2] }, out: { status: 'O', line: [0, 4, 8] } },
      { in: { board: [0, 0, 2, 0, 2, 1, 2, 1, 1] }, out: { status: 'O', line: [2, 4, 6] } },
      { in: { board: [1, 2, 1, 1, 2, 2, 2, 1, 1] }, out: { status: 'draw', line: [] } },
      { in: { board: [1, 2, 0, 0, 1, 0, 0, 0, 0] }, out: { status: 'ongoing', line: [] } },
    ] });
  I({ id: 'game.outcome/lines', implements: 'game.outcome', run: ({ board }) => {
    const b = board.value;
    for (const line of LINES) {
      const [p, q, r] = line;
      if (b[p] !== 0 && b[p] === b[q] && b[q] === b[r]) return { status: MARK[b[p]], line: [...line] };
    }
    return { status: b.includes(0) ? 'ongoing' : 'draw', line: [] };
  } });

  // A verdict, so a check: "is this move legal" has a normal answer either way, not an error.
  C({ id: 'game.moveLegal', kind: 'check', in: { board: boardSchema, cell: cellSchema }, out: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
    description: 'Is `cell` empty on `board`? accepted:false is a successful run that says why.',
    examples: [
      { in: { board: [0, 0, 0, 0, 0, 0, 0, 0, 0], cell: 4 }, out: { accepted: true, reason: 'cell 4 is empty' } },
      { in: { board: [1, 0, 0, 0, 2, 0, 0, 0, 0], cell: 4 }, out: { accepted: false, reason: 'cell 4 is occupied by O' } },
      { in: { board: [1, 0, 0, 0, 2, 0, 0, 0, 0], cell: 0 }, out: { accepted: false, reason: 'cell 0 is occupied by X' } },
    ] });
  I({ id: 'game.moveLegal/membership', implements: 'game.moveLegal', uses: ['game.legalMoves'], run: ({ board, cell }, ctx) => {
    const { cells } = ctx.call('game.legalMoves', { board });
    const ok = cells.value.includes(cell.value);
    return { accepted: ok, reason: ok ? `cell ${cell.value} is empty` : `cell ${cell.value} is occupied by ${MARK[board.value[cell.value]]}` };
  } });

  // ---------------------------------------------------------------- policies: ONE contract, the seat is a slot
  // Hand-derived examples every policy must satisfy: forced moves (exactly one legal cell).
  C({ id: 'policy.choose', in: { board: boardSchema, player: playerSchema }, out: { cell: cellSchema },
    description: 'Pick a legal cell for `player`. A match calls it with slot X or slot O.',
    examples: [
      { in: { board: [1, 2, 1, 2, 1, 2, 2, 1, 0], player: 1 }, out: { cell: 8 }, seed: 1 },
      { in: { board: [1, 2, 2, 0, 1, 1, 2, 1, 2], player: 1 }, out: { cell: 3 }, seed: 1 },
    ] });
  for (const [name, def] of Object.entries(POLICIES)) {
    I({ id: policyId(name), implements: 'policy.choose', uses: def.uses, description: def.description, ...(def.examples ? { examples: def.examples } : {}), run: def.run });
  }
  // One default for the contract, and one pin for the model seat `opp`: since v0.5 a slot select beats a contract fill,
  // so prove's fill of policy.choose (the implementation under test) no longer seats a mirror in its own model (N13).
  world.select('policy.choose', policyId('first-empty'));
  world.select('policy.choose', policyId('first-empty'), 'opp');

  // ---------------------------------------------------------------- two small contracts that compute values (not booleans)
  // v0.4 conditions are relations (eq, not, and), so the round-3 helpers that only emitted a boolean are gone:
  // match.live, match.seat, logic.not, and the contract match.move that existed only to nest a conditional.
  // These two stay because they build a VALUE inside a branch.
  C({ id: 'match.opponent', in: { player: playerSchema }, out: { status: statusSchema },
    description: 'The mark of the other player: the winner when `player` forfeits.',
    examples: [{ in: { player: 1 }, out: { status: 'O' } }, { in: { player: 2 }, out: { status: 'X' } }] });
  I({ id: 'match.opponent/other', implements: 'match.opponent', run: ({ player }) => ({ status: MARK[3 - player.value] }) });

  C({ id: 'match.append', in: { moves: movesSchema, player: playerSchema, cell: cellSchema }, out: { moves: movesSchema },
    description: 'The move list with { player, cell } added at the end. Every older element keeps a path into the input list (ctx.concat).',
    examples: [{ in: { moves: [{ player: 1, cell: 0 }], player: 2, cell: 4 }, out: { moves: [{ player: 1, cell: 0 }, { player: 2, cell: 4 }] } }] });
  I({ id: 'match.append/concat', implements: 'match.append', run: ({ moves, player, cell }, ctx) => ({ moves: ctx.concat(moves, [ctx.gather({ player, cell })]) }) });

  // ---------------------------------------------------------------- one ply, a match
  const movesWith = (n, pairs) => pairs.slice(0, n).map(([player, cell]) => ({ player, cell }));
  const FOUR = [[1, 0], [2, 3], [1, 1], [2, 4]];
  C({ id: 'match.ply', in: { board: boardSchema, player: playerSchema, status: statusSchema, moves: movesSchema },
    out: { board: boardSchema, status: statusSchema, moves: movesSchema },
    description: 'If the game is ongoing: the policy in slot X or O (by `player`) chooses; game.moveLegal audits the choice; an illegal choice forfeits the game to the other player (status = that mark, board and moves unchanged); a legal one is applied, appended to `moves`, and the outcome is read. If the game is over, the move is skipped and the position passes through.',
    examples: [
      { in: { board: [0, 0, 0, 0, 0, 0, 0, 0, 0], player: 1, status: 'ongoing', moves: [] },
        out: { board: [1, 0, 0, 0, 0, 0, 0, 0, 0], status: 'ongoing', moves: [{ player: 1, cell: 0 }] } },
      { in: { board: [1, 1, 0, 2, 2, 0, 0, 0, 0], player: 1, status: 'ongoing', moves: movesWith(4, FOUR) },
        out: { board: [1, 1, 1, 2, 2, 0, 0, 0, 0], status: 'X', moves: [...movesWith(4, FOUR), { player: 1, cell: 2 }] } },
      { in: { board: [1, 1, 1, 2, 2, 0, 0, 0, 0], player: 2, status: 'X', moves: [] },
        out: { board: [1, 1, 1, 2, 2, 0, 0, 0, 0], status: 'X', moves: [] } },
      // seats named by fill: O sits in center-corners and takes the centre
      { in: { board: [1, 0, 0, 0, 0, 0, 0, 0, 0], player: 2, status: 'ongoing', moves: [{ player: 1, cell: 0 }] }, fill: fillFor('first-empty', 'center-corners'),
        out: { board: [1, 0, 0, 0, 2, 0, 0, 0, 0], status: 'ongoing', moves: [{ player: 1, cell: 0 }, { player: 2, cell: 4 }] } },
    ] });
  // The whole ply as ONE composition. v0.5: a step that reads a skipped step is skipped too. v0.6: a `one` over skipped
  // picks skips the step that binds it, `else(apply)` is skipped when apply was skipped by inheritance (a finished game does
  // not forfeit), and a step that runs because what it reads ran records `ran`. So `ON` is written on pickX and pickO only
  // (round 5: also on legal; round 4: on all seven steps) and no complement is typed: pickO is else(pickX), forfeit is else(apply).
  const ON = { eq: ['$in.status', { literal: 'ongoing' }] };
  const CHOSEN = { one: ['pickX.cell', 'pickO.cell'] }; // exactly one seat is live; overlapping seats fail at assembly
  world.compose({ id: 'match.ply/declared', implements: 'match.ply',
    description: 'composition: pickX, else pickO (a derived complement), the check, then apply, outcome and record if accepted, forfeit if else(apply); a step that reads a skipped step is skipped with the original cause, and one that runs because what it reads ran records the same cause.',
    steps: [
      { name: 'pickX', call: 'policy.choose', slot: 'X', when: { and: [ON, { eq: ['$in.player', 1] }] }, bind: { board: '$in.board', player: '$in.player' } },
      { name: 'pickO', call: 'policy.choose', slot: 'O', when: { and: [ON, { else: ['pickX'] }] }, bind: { board: '$in.board', player: '$in.player' } },
      { name: 'legal', call: 'game.moveLegal', bind: { board: '$in.board', cell: CHOSEN } },
      { name: 'apply', call: 'game.apply', when: 'legal.accepted', bind: { board: '$in.board', player: '$in.player', cell: CHOSEN } },
      { name: 'after', call: 'game.outcome', bind: { board: 'apply.board' } },
      { name: 'record', call: 'match.append', when: 'legal.accepted', bind: { moves: '$in.moves', player: '$in.player', cell: CHOSEN } },
      { name: 'forfeit', call: 'match.opponent', when: { else: ['apply'] }, bind: { player: '$in.player' } },
    ],
    returns: { board: { first: ['apply.board', '$in.board'] }, status: { first: ['after.status', 'forfeit.status', '$in.status'] }, moves: { first: ['record.moves', '$in.moves'] } } });
  // The same ply as imperative code: ctx.when takes tests, so the decisions name their operands, and named branches
  // say which side ran. It declares both seats in `uses`, so a call in any other slot fails with UNDECLARED_SLOT.
  I({ id: 'match.ply/imperative', implements: 'match.ply',
    uses: ['policy.choose#X', 'policy.choose#O', 'game.moveLegal', 'game.apply', 'game.outcome'],
    description: 'imperative: ctx.when(eq(status, ongoing)) passes a finished game through, ctx.when(eq(player, 1)) picks the slot, ctx.when(verdict.accepted) picks forfeit or apply, ctx.concat appends the move',
    run: ({ board, player, status, moves }, ctx) => {
      if (!ctx.when({ eq: [status, 'ongoing'] }, 'game is on', { true: 'move', false: 'pass through' })) return { board, status, moves };
      const xToMove = ctx.when({ eq: [player, 1] }, 'X is to move', { true: 'pickX', false: 'pickO' });
      const { cell } = ctx.call('policy.choose', { board, player }, { slot: xToMove ? 'X' : 'O' });
      const verdict = ctx.call('game.moveLegal', { board, cell });
      if (!ctx.when(verdict.accepted, 'move is legal', { true: 'apply', false: 'forfeit' })) return { board, status: MARK[3 - player.value], moves };
      const { board: next } = ctx.call('game.apply', { board, player, cell });
      const { status: after } = ctx.call('game.outcome', { board: next });
      return { board: next, status: after, moves: ctx.concat(moves, [ctx.gather({ player, cell })]) };
    } });
  world.select('match.ply', 'match.ply/declared');

  // ---------------------------------------------------------------- the same game as a tick, then the match as a fold of ticks
  C({ id: 'match.tick', kind: 'tick', in: { state: matchState }, out: { state: matchState, status: statusSchema },
    description: 'One ply as a tick. State = { board, status, moves }; the player to move is X when the move list has even length.',
    examples: [
      { in: { state: { board: [0, 0, 0, 0, 0, 0, 0, 0, 0], status: 'ongoing', moves: [] } },
        out: { state: { board: [1, 0, 0, 0, 0, 0, 0, 0, 0], status: 'ongoing', moves: [{ player: 1, cell: 0 }] }, status: 'ongoing' } },
      // six ticks of X first-empty v O center-corners, derived by hand: X0 O4 X1 O2 X3 O6, and O holds 2-4-6.
      // v0.5: a trajectory, checked tick by tick by prove (round 4: only the last state was checked, and the five before it lived in EXPLAIN.md)
      { name: 'six ticks: O closes the diagonal 2-4-6', in: { state: { board: [0, 0, 0, 0, 0, 0, 0, 0, 0], status: 'ongoing', moves: [] } }, fill: fillFor('first-empty', 'center-corners'), ticks: 6,
        trajectory: [[1, 0], [2, 4], [1, 1], [2, 2], [1, 3], [2, 6]].map((_, k, all) => {
          const moves = all.slice(0, k + 1).map(([player, cell]) => ({ player, cell }));
          const board = Array(9).fill(0); moves.forEach((m) => { board[m.cell] = m.player; });
          const status = k === 5 ? 'O' : 'ongoing';
          return { state: { board, status, moves }, status };
        }) },
    ] });
  I({ id: 'match.tick/ply', implements: 'match.tick', uses: ['match.ply'], run: ({ state }, ctx) => {
    const board = ctx.at(state, 'board'); const status = ctx.at(state, 'status'); const moves = ctx.at(state, 'moves');
    const player = ctx.literal(state.value.moves.length % 2 === 0 ? 1 : 2);
    const r = ctx.call('match.ply', { board, player, status, moves });
    return { state: ctx.gather({ board: r.board, status: r.status, moves: r.moves }), status: r.status };
  } });

  C({ id: 'match.play', in: {}, out: { board: boardSchema, status: statusSchema, moves: movesSchema },
    description: 'Play a whole game from the empty board, X first. Who plays X and O is decided by the fill of the two slots of policy.choose (the world default seats first-empty in both). `moves` is the move list, gathered with provenance.',
    examples: [
      // Default seating first-empty v first-empty, derived by hand: X0 O1 X2 O3 X4 O5 X6, and X holds 2-4-6.
      { name: 'first-empty mirror: X closes 2-4-6 on move seven', in: {}, out: { board: [1, 2, 1, 2, 1, 2, 1, 0, 0], status: 'X',
        moves: [0, 1, 2, 3, 4, 5, 6].map((cell, i) => ({ player: (i % 2) + 1, cell })) } },
      // Seats named by the example's own fill (round 2 could not): X first-empty, O center-corners.
      { name: 'first-empty v center-corners: O wins on move six', in: {}, fill: fillFor('first-empty', 'center-corners'), out: { board: [1, 1, 2, 1, 2, 0, 2, 0, 0], status: 'O',
        moves: [[1, 0], [2, 4], [1, 1], [2, 2], [1, 3], [2, 6]].map(([player, cell]) => ({ player, cell })) } },
    ] });
  I({ id: 'match.play/drive', implements: 'match.play', uses: ['match.tick'],
    description: 'ctx.drive: the tick contract match.tick is folded inside this call, one child node per ply (round 2: a hand loop over match.ply)',
    examples: [
      // center-corners mirror, by hand: 4 0 2 6 8 1 3 5 7 and a full board, no line
      { name: 'center-corners mirror: nine plies, a full board, no line', in: {}, fill: fillFor('center-corners', 'center-corners'), out: { board: [2, 2, 1, 1, 1, 2, 2, 1, 1], status: 'draw',
        moves: [4, 0, 2, 6, 8, 1, 3, 5, 7].map((cell, i) => ({ player: (i % 2) + 1, cell })) } },
    ],
    run: (_, ctx) => {
      const start = ctx.literal({ board: [...EMPTY_BOARD], status: 'ongoing', moves: [] });
      const { state } = ctx.drive('match.tick', { state: start }, { until: (out) => out.status !== 'ongoing', maxTicks: 9 });
      return { board: ctx.at(state, 'board'), status: ctx.at(state, 'status'), moves: ctx.at(state, 'moves') };
    } });
  // The positions of a match, one per ply: ctx.drive with collect gathers the state of every tick into one Ref, and each
  // board points at the tick that made it. Round 3 had no way to ask for this without keeping a trail in the state.
  C({ id: 'match.positions', in: {}, out: { boards: { type: 'array', maxItems: 9, items: boardSchema } },
    description: 'The board after every ply of a whole match, in order (the last one is the final position). Seats are the fill of the two slots, as for match.play.',
    examples: [{ name: 'center-corners mirror: nine boards, the last one full', in: {}, fill: fillFor('center-corners', 'center-corners'),
      out: { boards: [[0, 0, 0, 0, 1, 0, 0, 0, 0], [2, 0, 0, 0, 1, 0, 0, 0, 0], [2, 0, 1, 0, 1, 0, 0, 0, 0], [2, 0, 1, 0, 1, 0, 2, 0, 0], [2, 0, 1, 0, 1, 0, 2, 0, 1],
        [2, 2, 1, 0, 1, 0, 2, 0, 1], [2, 2, 1, 1, 1, 0, 2, 0, 1], [2, 2, 1, 1, 1, 2, 2, 0, 1], [2, 2, 1, 1, 1, 2, 2, 1, 1]] } }] });
  I({ id: 'match.positions/drive', implements: 'match.positions', uses: ['match.tick'], run: (_, ctx) => {
    const start = ctx.literal({ board: [...EMPTY_BOARD], status: 'ongoing', moves: [] });
    const { collected } = ctx.drive('match.tick', { state: start }, { until: (out) => out.status !== 'ongoing', maxTicks: 9, collect: ['state'] });
    return { boards: ctx.gather(collected.state.value.map((_, i) => ctx.at(collected.state, i, 'board'))) };
  } });

  // The same match as data: nine plies, alternating players, each ply passing a finished game through (its move step is skipped).
  world.compose({ id: 'match.play/nine-plies', implements: 'match.play',
    description: 'composition: nine fixed plies; plies after the game is decided skip their move and pass through',
    steps: Array.from({ length: 9 }, (_, k) => ({
      name: `p${k + 1}`, call: 'match.ply',
      bind: k === 0
        ? { board: { literal: [...EMPTY_BOARD] }, player: { literal: 1 }, status: { literal: 'ongoing' }, moves: { literal: [] } }
        : { board: `p${k}.board`, player: { literal: k % 2 === 0 ? 1 : 2 }, status: `p${k}.status`, moves: `p${k}.moves` },
    })),
    returns: { board: 'p9.board', status: 'p9.status', moves: 'p9.moves' } });
  world.select('match.play', 'match.play/drive');

  // A composition that names its slots statically: the first two moves, X then O, from the empty board.
  C({ id: 'match.opening', in: {}, out: { board: boardSchema, moves: movesSchema },
    description: 'The position after X and O have each moved once, with the move list gathered. The slots are named in the composition steps.',
    examples: [
      // default seating first-empty v first-empty: X0, O1
      { in: {}, out: { board: [1, 2, 0, 0, 0, 0, 0, 0, 0], moves: [{ player: 1, cell: 0 }, { player: 2, cell: 1 }] } },
      { name: 'centre first, then the first empty cell', in: {}, fill: fillFor('center-corners', 'first-empty'), out: { board: [2, 0, 0, 0, 1, 0, 0, 0, 0], moves: [{ player: 1, cell: 4 }, { player: 2, cell: 0 }] } },
    ] });
  world.compose({ id: 'match.opening/two-plies', implements: 'match.opening',
    steps: [
      { name: 'x', call: 'policy.choose', slot: 'X', bind: { board: { literal: [...EMPTY_BOARD] }, player: { literal: 1 } } },
      { name: 'ax', call: 'game.apply', bind: { board: { literal: [...EMPTY_BOARD] }, player: { literal: 1 }, cell: 'x.cell' } },
      { name: 'o', call: 'policy.choose', slot: 'O', bind: { board: 'ax.board', player: { literal: 2 } } },
      { name: 'ao', call: 'game.apply', bind: { board: 'ax.board', player: { literal: 2 }, cell: 'o.cell' } },
    ],
    returns: { board: 'ao.board',
      moves: { gather: [{ gather: { player: { literal: 1 }, cell: 'x.cell' } }, { gather: { player: { literal: 2 }, cell: 'o.cell' } }] } } });
}

// ---------------------------------------------------------------- tournament driver
// A tournament cannot be a contract: it needs a different fill per match, and fill is per run.
// So it is a plain loop over world.run, and its "result" is assembled from receipts. (Still true in v0.2.)
// v0.6: `fill` is one table for a whole sweep (the opponent-model paths of every mirror seat included) and `landing: 'none'` lets
// the matches whose seats never reach a path ignore it; typos still fail. With the default landing a path key that a pairing
// does not reach is BAD_FILL, which is why a round-5 sweep needed one fill table per pairing.
export function playMatch(world, x, o, { seed = 1, matchImpl = 'match.play/drive', cache = true, fill: extra = {}, landing } = {}) {
  const fill = { 'match.play': matchImpl, ...fillFor(x, o), ...extra };
  const r = world.run('match.play', {}, { fill, seed, cache, ...(landing ? { landing } : {}) });
  return { x, o, seed, status: r.outputs.status, board: r.outputs.board, moves: r.outputs.moves, trace: r.trace, receipt: r.receipt };
}

/** The same match as a drive: one tick per ply, state threaded by the kernel. */
export function driveMatch(world, x, o, { seed = 1, cache = true } = {}) {
  const state = { board: [...EMPTY_BOARD], status: 'ongoing', moves: [] };
  const d = world.drive('match.tick', { state }, { until: (out) => out.status !== 'ongoing', fill: fillFor(x, o), seed, cache });
  return { x, o, seed, ...d, final: d.final.state };
}

export function tournament(world, { policies = POLICY_NAMES, seeds = [1, 2, 3, 4, 5, 6, 7, 8], matchImpl = 'match.play/drive', cache = true, fill, landing } = {}) {
  const games = [];
  const table = Object.fromEntries(policies.map((x) => [x, Object.fromEntries(policies.map((o) => [o, { win: 0, draw: 0, loss: 0, n: 0 }]))]));
  for (const x of policies) {
    for (const o of policies) {
      const stochastic = x === 'random' || o === 'random';
      for (const seed of stochastic ? seeds : [seeds[0]]) {
        const g = playMatch(world, x, o, { seed, matchImpl, cache, fill, landing });
        games.push(g);
        const cellTally = table[x][o];
        cellTally.n += 1;
        if (g.status === 'X') cellTally.win += 1; else if (g.status === 'O') cellTally.loss += 1; else cellTally.draw += 1;
      }
    }
  }
  return { games, table, policies: [...policies] };
}

/**
 * Continue a recorded drive from the state after tick `k` with different seats. The first tick of the new drive
 * takes its state from `world.ref(run, 1, 'state')`, so it is linked back to the old drive by a cross-run edge.
 */
export function branchDrive(world, original, k, x, o, { seed = 1, cache = true } = {}) {
  const from = world.ref(original.receipts[k].runId, original.receipts[k].trace.id, 'state');
  const d = world.drive('match.tick', { state: from }, { until: (out) => out.status !== 'ongoing', fill: fillFor(x, o), seed, cache, startTick: k + 1 });
  return { x, o, seed, fromTick: k, fromRun: original.receipts[k].runId, ...d, final: d.final.state };
}

/**
 * Walk a trace depth-first and list the moves: one entry per policy.choose call, in play order, with its slot and the
 * legality verdict that followed it. With `expand` (n => world.node(n.cachedFrom.run, n.cachedFrom.call)) a cache hit is
 * walked through its original subtree, so a repeated prefix is not hollow; such a move carries `run` (the run that
 * recorded it) and `cached: true`, and its `call` is that run's call id.
 */
export function movesOf(trace, part, { expand = null } = {}) {
  const moves = [];
  (function walk(node, via) {
    if (node.contract === 'policy.choose') {
      moves.push({
        n: moves.length + 1, call: node.id, contract: node.contract, slot: node.slot, impl: node.impl, cached: node.cached || via !== null, run: via,
        board: part(node.in.board.hash), player: part(node.in.player.hash), cell: part(node.out.cell.hash), verdict: null,
        move: part(node.in.board.hash).filter((c) => c !== 0).length + 1, // the game's move number, from the stones on the board (n is only the index among visible calls)
      });
    } else if (node.contract === 'game.moveLegal' && moves.length && !moves.at(-1).verdict) {
      // the legality check is the next check after the policy call it audits
      moves.at(-1).verdict = { call: node.id, run: via, accepted: part(node.out.accepted.hash), reason: part(node.out.reason.hash) };
    }
    const original = node.cached && expand && node.cachedFrom ? expand(node) : null;
    if (original) original.calls.forEach((c) => walk(c, node.cachedFrom.run));
    else node.calls.forEach((c) => walk(c, via));
  })(trace, null);
  return moves;
}
