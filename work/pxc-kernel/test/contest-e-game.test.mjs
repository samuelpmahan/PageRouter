import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';
import { register, registerStubborn, playMatch, driveMatch, branchDrive, tournament, movesOf, fillFor, policyId, POLICY_NAMES } from '../contest/e-game/index.mjs';

const fresh = () => { const w = createWorld({ name: 'e' }); register(w); registerStubborn(w); return w; };
const run = (w, c, inputs, options) => w.run(c, inputs, options);
const E = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const leaves = (from) => (from.kind === 'at' ? leaves(from.of) : from.kind === 'gather' ? from.pieces.flatMap((p) => leaves(p.from)) : [from]);
// Follow a `from` down through the calls that produced it. `chain` = [root, ..., the node whose children hold `from`].
// Stops at a policy.choose call (reported as a leaf) and at the run's own inputs.
const origins = (from, chain) => {
  const here = chain.at(-1);
  if (from.kind === 'at') return origins(from.of, chain);
  if (from.kind === 'gather') return from.pieces.flatMap((p) => origins(p.from, chain));
  if (from.kind === 'call') {
    const child = here.calls.find((c) => c.id === from.call);
    if (!child) return [from];
    if (child.contract === 'policy.choose') return [{ kind: 'call', call: child.id, port: from.port, contract: 'policy.choose' }];
    return origins(child.out[from.port].from, [...chain, child]);
  }
  if (from.kind === 'input' && from.call === here.id && chain.length > 1) return origins(here.in[from.port].from, chain.slice(0, -1));
  return [from];
};
const ply = (tick) => tick.calls.find((c) => c.contract === 'match.ply');

// ------------------------------------------------------------------ contracts of the game (hand-derived)
test('every contract example proves against every implementation (stubborn excluded: it breaks the rules on purpose)', () => {
  const w = fresh();
  const proofs = w.contracts().flatMap((c) => w.prove(c.id)).filter((p) => p.impl !== policyId('stubborn'));
  assert.deepEqual(proofs.filter((p) => !p.ok), []);
  for (const n of POLICY_NAMES) assert.ok(proofs.some((p) => p.impl === policyId(n)), `${policyId(n)} proven`);
  for (const id of ['match.play/nine-plies', 'match.play/drive', 'match.opening/two-plies', 'match.tick/ply', 'game.moveLegal/membership',
    'match.ply/declared', 'match.ply/imperative', 'match.positions/drive', 'match.opponent/other', 'match.append/concat', 'policy.choose/mirror']) {
    assert.ok(proofs.some((p) => p.impl === id), `${id} proven`);
  }
  // v0.3: examples that name their seats (fill) or their ticks, and implementations' own examples (impl:i)
  assert.ok(proofs.some((p) => p.contract === 'match.play' && p.example === 'first-empty v center-corners: O wins on move six'), 'the second match.play example seats X and O by its own fill, and prove reports it by name (round 5: example 1)');
  assert.ok(proofs.some((p) => p.contract === 'match.tick' && p.example === 'six ticks: O closes the diagonal 2-4-6'), 'the second match.tick example drives six ticks, named (round 5: example 1)');
  assert.ok(proofs.some((p) => p.impl === 'match.play/drive' && p.example === 'center-corners mirror: nine plies, a full board, no line'), 'the driven match carries its own example, reported by its name (round 5: impl:0)');
  assert.equal(w.implementationsOf('policy.choose').length, 6, 'four policies, the mirror and the fixture, each registered once (round 1: 3 times each)');
  // round 4: the ply has no helper contracts that only emit a boolean (round 3: match.live, match.seat, logic.not) and no match.move
  assert.deepEqual(w.contracts().map((c) => c.id).filter((id) => id.startsWith('match.') || id.startsWith('logic.')).sort(), ['match.append', 'match.opening', 'match.opponent', 'match.play', 'match.ply', 'match.positions', 'match.tick']);
  assert.deepEqual(w.contracts().map((c) => c.id).filter((id) => id.startsWith('policy.')), ['policy.choose']);
});

test('prove catches the rule-breaker: stubborn fails both forced-move examples', () => {
  const w = fresh();
  const proofs = w.prove('policy.choose', policyId('stubborn'));
  assert.deepEqual(proofs.map((p) => p.ok), [false, false]);
  assert.equal(w.ledger().find((l) => l.contract === 'policy.choose').implementations.find((i) => i.id === policyId('stubborn')).status, 'failing');
});

test('game.legalMoves: hand-derived boards', () => {
  const w = fresh();
  const cells = (board) => run(w, 'game.legalMoves', { board }).outputs.cells;
  assert.deepEqual(cells(E), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(cells([0, 2, 0, 0, 1, 0, 0, 0, 1]), [0, 2, 3, 5, 6, 7]);
  assert.deepEqual(cells([1, 2, 1, 2, 1, 2, 2, 1, 2]), []);
});

test('game.apply places a mark, refuses an occupied cell and bad shapes', () => {
  const w = fresh();
  assert.deepEqual(run(w, 'game.apply', { board: E, player: 2, cell: 8 }).outputs.board, [0, 0, 0, 0, 0, 0, 0, 0, 2]);
  assert.throws(() => run(w, 'game.apply', { board: [1, 0, 0, 0, 0, 0, 0, 0, 0], player: 2, cell: 0 }), /occupied/);
  assert.throws(() => run(w, 'game.apply', { board: E, player: 3, cell: 0 }), (e) => e.code === 'INPUT_SCHEMA');
  assert.throws(() => run(w, 'game.apply', { board: [0, 0, 0], player: 1, cell: 0 }), (e) => e.code === 'INPUT_SCHEMA');
});

test('game.outcome: all eight lines for both marks, typed out by hand', () => {
  const w = fresh();
  // [mark placed on these cells, the other mark scattered where it cannot matter]
  const cases = [
    [[0, 1, 2], [3, 4]], [[3, 4, 5], [0, 1]], [[6, 7, 8], [0, 1]], [[0, 3, 6], [1, 2]],
    [[1, 4, 7], [0, 2]], [[2, 5, 8], [0, 1]], [[0, 4, 8], [1, 2]], [[2, 4, 6], [0, 1]],
  ];
  for (const [line, others] of cases) for (const [mark, name] of [[1, 'X'], [2, 'O']]) {
    const board = [...E];
    line.forEach((c) => { board[c] = mark; });
    others.forEach((c) => { board[c] = 3 - mark; });
    const r = run(w, 'game.outcome', { board }).outputs;
    assert.deepEqual([r.status, r.line], [name, line], JSON.stringify(board));
  }
});

test('game.outcome: draw, ongoing, and a full board that is still a win', () => {
  const w = fresh();
  const o = (board) => run(w, 'game.outcome', { board }).outputs;
  assert.deepEqual(o([1, 2, 1, 1, 2, 2, 2, 1, 1]), { status: 'draw', line: [] });
  assert.deepEqual(o(E), { status: 'ongoing', line: [] });
  assert.deepEqual(o([1, 2, 1, 2, 1, 2, 2, 1, 1]), { status: 'X', line: [0, 4, 8] }); // full board, X holds 0-4-8
});

// ------------------------------------------------------------------ policies
test('policies: the hand-derived choices are examples the implementations carry (round 2: asserted outside the kernel), proven by prove()', () => {
  const w = fresh();
  for (const [name, n] of [['first-empty', 2], ['center-corners', 4], ['minimax', 3]]) {
    const own = w.implementations().find((i) => i.id === policyId(name)).examples;
    assert.equal(own.length, n, `${name} carries ${n} examples of its own`);
    const proofs = w.prove('policy.choose', policyId(name)).filter((p) => String(p.example).startsWith('impl:'));
    assert.deepEqual(proofs.map((p) => p.ok), own.map(() => true), `${name}: ${JSON.stringify(proofs.filter((p) => !p.ok))}`);
  }
  // a wrong example is caught: the same minimax asked for the block at 5 where 2 wins
  const wrong = createWorld({ name: 'wrong' }); register(wrong);
  wrong.implement({ id: 'policy.choose/minimax-claimed', implements: 'policy.choose', uses: ['game.legalMoves'], examples: [{ in: { board: [1, 1, 0, 2, 2, 0, 0, 0, 0], player: 1 }, out: { cell: 5 } }], run: (_, ctx) => ({ cell: ctx.literal(2) }) });
  assert.deepEqual(wrong.prove('policy.choose', 'policy.choose/minimax-claimed').filter((p) => p.example === 'impl:0').map((p) => p.ok), [false]);
});

test('policies refuse a finished board; random needs a seed', () => {
  const w = fresh();
  const full = [1, 2, 1, 1, 2, 2, 2, 1, 1];
  for (const n of POLICY_NAMES) assert.throws(() => run(w, 'policy.choose', { board: full, player: 1 }, { fill: { 'policy.choose': policyId(n) }, seed: 1 }), n === 'minimax' ? /already over/ : /no legal move/, n);
  assert.throws(() => run(w, 'policy.choose', { board: E, player: 1 }, { fill: { 'policy.choose': policyId('random') } }), (e) => e.code === 'SEED_REQUIRED');
});

test('random: always legal, reproducible per seed, and reaches every cell across seeds', () => {
  const w = fresh();
  const board = [1, 2, 0, 0, 1, 0, 2, 0, 0]; // legal: 2 3 5 7 8
  const pick = (seed) => run(w, 'policy.choose', { board, player: 1 }, { fill: { 'policy.choose': policyId('random') }, seed }).outputs.cell;
  const seen = new Set();
  for (let s = 1; s <= 60; s += 1) { const c = pick(s); assert.ok([2, 3, 5, 7, 8].includes(c)); assert.equal(pick(s), c); seen.add(c); }
  assert.deepEqual([...seen].sort(), [2, 3, 5, 7, 8]);
});

test('every policy returns its cell as a path into game.legalMoves, not as a computed value', () => {
  const w = fresh();
  for (const n of POLICY_NAMES) {
    const r = run(w, 'policy.choose', { board: [1, 0, 0, 0, 0, 0, 0, 0, 2], player: 1 }, { fill: { 'policy.choose': policyId(n) }, seed: 3 });
    assert.equal(r.trace.out.cell.from.kind, 'at', n);
    assert.equal(r.trace.out.cell.from.of.kind, 'call', n);
  }
});

// ------------------------------------------------------------------ matches: hand-derived sequences
const sequence = (g, w) => movesOf(g.trace, w.part).map((m) => [m.player, m.cell]);

test('match first-empty (X) vs center-corners (O): derived by hand', () => {
  const w = fresh();
  const g = playMatch(w, 'first-empty', 'center-corners');
  assert.deepEqual(sequence(g, w), [[1, 0], [2, 4], [1, 1], [2, 2], [1, 3], [2, 6]]);
  assert.deepEqual([g.status, g.board], ['O', [1, 1, 2, 1, 2, 0, 2, 0, 0]]);
});

test('match first-empty vs first-empty: X completes 2-4-6 on move 7', () => {
  const w = fresh();
  const g = playMatch(w, 'first-empty', 'first-empty');
  assert.deepEqual(sequence(g, w).map(([, c]) => c), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual([g.status, g.board], ['X', [1, 2, 1, 2, 1, 2, 1, 0, 0]]);
});

test('match center-corners vs center-corners: draw on a full board', () => {
  const w = fresh();
  const g = playMatch(w, 'center-corners', 'center-corners');
  assert.deepEqual(sequence(g, w).map(([, c]) => c), [4, 0, 2, 6, 8, 1, 3, 5, 7]);
  assert.deepEqual([g.status, g.board], ['draw', [2, 2, 1, 1, 1, 2, 2, 1, 1]]);
});

test('the ctx.drive match and the composed nine-plies match give the same game, with the same bindings', () => {
  const w = fresh();
  const a = playMatch(w, 'center-corners', 'first-empty', { seed: 5 });
  const b = playMatch(w, 'center-corners', 'first-empty', { seed: 5, matchImpl: 'match.play/nine-plies', cache: false });
  assert.deepEqual([b.status, b.board], [a.status, a.board]);
  assert.deepEqual(sequence(b, w), sequence(a, w));
  assert.equal(b.trace.calls.length, 9, 'composition always has nine ply boxes');
  assert.equal(a.trace.calls.length, a.moves.length, 'ctx.drive creates exactly one child per ply played (round 2: a hand loop of match.ply calls)');
  assert.ok(a.trace.calls.every((c) => c.contract === 'match.tick'));
  // composition binding: ply k+1 takes its board from ply k's output
  const [p1, p2] = b.trace.calls;
  assert.deepEqual(p2.in.board.from, { kind: 'call', call: p1.id, port: 'board' });
});

// ------------------------------------------------------------------ slots: two seats, one contract
test('slots: two implementations of one contract in one run, named by contract#slot', () => {
  const w = fresh();
  const g = playMatch(w, 'center-corners', 'first-empty');
  const mv = movesOf(g.trace, w.part);
  assert.ok(mv.every((m, k) => m.contract === 'policy.choose' && m.slot === (k % 2 === 0 ? 'X' : 'O')));
  assert.ok(mv.every((m, k) => m.impl === policyId(k % 2 === 0 ? 'center-corners' : 'first-empty')));
  assert.deepEqual(g.receipt.fill, { 'match.play': 'match.play/drive', ...fillFor('center-corners', 'first-empty') });
  assert.deepEqual(fillFor('center-corners', 'first-empty'), { 'policy.choose#X': 'policy.choose/center-corners', 'policy.choose#O': 'policy.choose/first-empty' });
});

test('slots: precedence is slot fill, then contract fill, then select', () => {
  const w = fresh();
  const impls = (fill) => w.run('match.opening', {}, { fill, cache: false }).trace.calls.filter((c) => c.contract === 'policy.choose').map((c) => [c.slot, c.impl]);
  assert.deepEqual(impls(undefined), [['X', policyId('first-empty')], ['O', policyId('first-empty')]], 'world.select default fills both slots');
  assert.deepEqual(impls({ 'policy.choose': policyId('center-corners') }), [['X', policyId('center-corners')], ['O', policyId('center-corners')]], 'contract fill fills both slots');
  assert.deepEqual(impls({ 'policy.choose': policyId('center-corners'), 'policy.choose#O': policyId('minimax') }), [['X', policyId('center-corners')], ['O', policyId('minimax')]], 'slot fill beats contract fill');
});

test('fill keys are validated: a misspelt contract or a wrong implementation fails (round 1: silently ignored)', () => {
  const w = fresh();
  assert.throws(() => w.run('match.opening', {}, { fill: { 'polcy.choose#X': policyId('minimax') } }), (e) => e.code === 'BAD_FILL');
  assert.throws(() => w.run('match.opening', {}, { fill: { 'policy.choose#X': 'game.apply/place' } }), (e) => e.code === 'BAD_FILL');
});

test('a slot NAME is validated: a fill for slot Z (or a lower-case x) fails with BAD_FILL (round 2: silently unused)', () => {
  const w = fresh();
  for (const bad of ['policy.choose#Z', 'policy.choose#x']) {
    assert.throws(() => w.run('match.opening', {}, { fill: { [bad]: policyId('minimax') }, cache: false }), (e) => e.code === 'BAD_FILL' && e.message.includes(bad), bad);
  }
  const last = w.runs().at(-1);
  assert.equal(last.status, 'failed', 'the run is recorded as failed, with its trace');
  assert.equal(last.error.code, 'BAD_FILL');
  // a tournament with a lower-case seat key can no longer play the world default silently
  assert.throws(() => w.run('match.play', {}, { fill: { 'policy.choose#x': policyId('minimax') }, seed: 1 }), (e) => e.code === 'BAD_FILL');
  // the correct spelling is fine, and allowUnusedFill switches the check off
  const ok = w.run('match.opening', {}, { fill: { 'policy.choose#X': policyId('center-corners') }, cache: false });
  assert.deepEqual(ok.trace.calls.filter((c) => c.contract === 'policy.choose').map((c) => c.impl), [policyId('center-corners'), policyId('first-empty')]);
  const off = w.run('match.opening', {}, { fill: { 'policy.choose#Z': policyId('minimax') }, cache: false, allowUnusedFill: true });
  assert.deepEqual(off.trace.calls.filter((c) => c.contract === 'policy.choose').map((c) => c.impl), [policyId('first-empty'), policyId('first-empty')]);
});

test('a drive validates its fill across all ticks: a typo fails, a real seat that only one tick consults does not', () => {
  const w = fresh();
  assert.throws(() => w.drive('match.tick', { state: { board: [...E], status: 'ongoing', moves: [] } }, { ticks: 2, fill: { 'policy.choose#Q': policyId('minimax') } }), (e) => e.code === 'BAD_FILL');
  // one tick consults slot X only; O's fill key is declared, so it is not a typo (v0.3's first draft rejected this)
  const one = w.drive('match.tick', { state: { board: [...E], status: 'ongoing', moves: [] } }, { ticks: 1, fill: fillFor('first-empty', 'center-corners') });
  assert.equal(one.ticks, 1);
});

test('an implementation that declares slots may call only those: UNDECLARED_SLOT for slot Z and for no slot', () => {
  const w = fresh();
  const mk = (id, slot) => w.implement({ id, implements: 'match.ply', uses: ['policy.choose#X', 'policy.choose#O'],
    run: ({ board, player, status, moves }, ctx) => { ctx.call('policy.choose', { board, player }, slot ? { slot } : undefined); return { board, status, moves }; } });
  mk('match.ply/zed', 'Z'); mk('match.ply/bare', null);
  const input = { board: E, player: 1, status: 'ongoing', moves: [] };
  for (const id of ['match.ply/zed', 'match.ply/bare']) {
    assert.throws(() => w.run('match.ply', input, { fill: { 'match.ply': id }, cache: false }), (e) => e.code === 'UNDECLARED_SLOT', id);
  }
  assert.equal(w.runs().at(-1).error.code, 'UNDECLARED_SLOT');
  // a declared slot, called, runs (the real imperative ply declares X and O)
  assert.equal(w.run('match.ply', input, { fill: { 'match.ply': 'match.ply/imperative' }, cache: false }).outputs.board[0], 1);
});

test('a seat\'s select is a pin: a contract fill does not reach it, #* does on purpose (round 4: a contract fill beat the slot select)', () => {
  const w = fresh();
  w.select('policy.choose', policyId('center-corners'), 'O');
  const seats = (fill) => w.run('match.opening', {}, { fill, cache: false }).trace.calls.filter((c) => c.contract === 'policy.choose').map((c) => [c.slot, c.impl]);
  assert.deepEqual(seats(undefined), [['X', policyId('first-empty')], ['O', policyId('center-corners')]], 'slot O has its own default, slot X falls back to the contract default');
  assert.deepEqual(seats({ 'policy.choose#O': policyId('minimax') }), [['X', policyId('first-empty')], ['O', policyId('minimax')]], 'slot fill beats slot select');
  assert.deepEqual(seats({ 'policy.choose': policyId('minimax') }), [['X', policyId('minimax')], ['O', policyId('center-corners')]], 'v0.5 specificity: a contract fill does not reach a seat that has its own select (the pin); slot X has none, so the fill reaches it');
  assert.deepEqual(seats({ 'policy.choose#*': policyId('minimax') }), [['X', policyId('minimax')], ['O', policyId('minimax')]], 'policy.choose#* reaches every seat on purpose, the pin included');
  assert.deepEqual(seats({ 'policy.choose#*': policyId('minimax'), 'policy.choose#O': policyId('first-empty') }).map((x) => x[1]), [policyId('minimax'), policyId('first-empty')], 'and a slot fill is more specific than #*');
  // v0.6: the node says which rung chose it, so the claim above is read off the nodes instead of inferred from the winning impl
  const rungs = (fill) => w.run('match.opening', {}, { fill, cache: false }).trace.calls.filter((c) => c.contract === 'policy.choose').map((c) => [c.slot, c.chosenBy.rung, c.chosenBy.key]);
  assert.deepEqual(rungs(undefined), [['X', 'contract select', 'policy.choose'], ['O', 'slot select', 'policy.choose#O']]);
  assert.deepEqual(rungs({ 'policy.choose': policyId('minimax') }), [['X', 'contract fill', 'policy.choose'], ['O', 'slot select', 'policy.choose#O']], 'the contract fill reached X and stopped at the pin on O');
  assert.deepEqual(rungs({ 'policy.choose#*': policyId('minimax') }).map((r) => r[1]), ['every-slot fill', 'every-slot fill']);
  assert.deepEqual(rungs({ 'policy.choose#O': policyId('minimax') }).map((r) => r[1]), ['contract select', 'slot fill']);
  assert.throws(() => w.select('policy.choose', 'game.apply/place', 'O'), (e) => e.code === 'BAD_FILL');
  // and the match.play contract now has an example that seats both players by its own fill
  const ex = w.contracts().find((c) => c.id === 'match.play').examples[1];
  assert.deepEqual(ex.fill, fillFor('first-empty', 'center-corners'));
  assert.deepEqual([ex.out.status, ex.out.board], ['O', [1, 1, 2, 1, 2, 0, 2, 0, 0]]);
});

test('a composition names its slots statically, and gathers its move list', () => {
  const w = fresh();
  const r = w.run('match.opening', {}, { fill: fillFor('center-corners', 'first-empty'), cache: false });
  assert.deepEqual(r.outputs, { board: [2, 0, 0, 0, 1, 0, 0, 0, 0], moves: [{ player: 1, cell: 4 }, { player: 2, cell: 0 }] });
  const pc = r.trace.calls.filter((c) => c.contract === 'policy.choose');
  assert.deepEqual(pc.map((c) => [c.slot, c.impl]), [['X', policyId('center-corners')], ['O', policyId('first-empty')]]);
  const from = r.trace.out.moves.from;
  assert.equal(from.kind, 'gather');
  assert.deepEqual(from.pieces.map((p) => [p.path, p.from.kind]), [[[0], 'gather'], [[1], 'gather']], 'a gather of two gathers keeps the inner structure as pieces');
  assert.deepEqual(from.pieces.flatMap((p) => p.from.pieces.map((q) => q.path.join('.'))), ['player', 'cell', 'player', 'cell']);
  const cellLeaves = from.pieces.map((p) => p.from.pieces.find((q) => q.path[0] === 'cell').from);
  assert.deepEqual(cellLeaves, pc.map((c) => ({ kind: 'call', call: c.id, port: 'cell' })));
  assert.deepEqual(from.pieces.map((p) => p.from.pieces.find((q) => q.path[0] === 'player').from), [{ kind: 'literal' }, { kind: 'literal' }]);
});

// ------------------------------------------------------------------ gather: the move list is an output

test('match.play outputs the move list; every ply adds its own policy cell to it by provenance, through match.append (ctx.concat)', () => {
  const w = fresh();
  const g = playMatch(w, 'first-empty', 'center-corners');
  assert.deepEqual(g.moves, [[1, 0], [2, 4], [1, 1], [2, 2], [1, 3], [2, 6]].map(([player, cell]) => ({ player, cell })));
  const ticks = g.trace.calls;
  assert.deepEqual(ticks.map((t) => t.tick), [0, 1, 2, 3, 4, 5], 'one child per ply, tagged with its tick');
  const policyNodes = movesOf(g.trace, w.part);
  ticks.forEach((t, i) => {
    const p = ply(t);
    const found = origins(p.out.moves.from, [g.trace, t, p]).filter((l) => l.kind === 'call');
    assert.ok(found.some((l) => l.call === policyNodes[i].call && l.port === 'cell'), `ply ${i + 1} output moves traces to policy call #${policyNodes[i].call}`);
    assert.deepEqual([...new Set(found.map((l) => l.call))], policyNodes.slice(0, i + 1).map((m) => m.call), 'and, following the input list back through the earlier ticks, to every earlier move\'s policy call in order');
  });
  // ctx.concat: in match.append every old element is an `at` path into the input list, the new one is a gather
  const append = ply(ticks[3]).calls.find((c) => c.contract === 'match.append');
  const pieces = append.out.moves.from.pieces;
  assert.deepEqual(pieces.map((p) => p.path), [[0], [1], [2], [3]]);
  assert.deepEqual(pieces.slice(0, 3).map((p) => [p.from.kind, p.from.path]), [['at', [0]], ['at', [1]], ['at', [2]]]);
  assert.equal(pieces[3].from.kind, 'gather');
  // the match returns the last tick's state by path
  assert.deepEqual(g.trace.out.moves.from, { kind: 'at', of: { kind: 'call', call: ticks.at(-1).id, port: 'state' }, path: ['moves'] });
});

test('the output move list agrees with the trace for every match of a cache-off tournament', () => {
  const w = fresh();
  const T = tournament(w, { policies: ['first-empty', 'center-corners', 'random'], seeds: [1, 2, 3], cache: false });
  for (const g of T.games) assert.deepEqual(g.moves.map((m) => [m.player, m.cell]), movesOf(g.trace, w.part).map((m) => [m.player, m.cell]), `${g.x} v ${g.o} seed ${g.seed}`);
});

test('with the cache on, a repeated prefix is hollow in the raw trace, and world.node(cachedFrom) fills it in: movesOf with expand is complete', () => {
  const w = fresh();
  const T = tournament(w, { seeds: [1, 2, 3, 4] }); // all four policies, minimax too: world.node is indexed in v0.4 (round 3 left minimax out, 153 s)
  const expand = (n) => w.node(n.cachedFrom.run, n.cachedFrom.call);
  const short = T.games.filter((g) => movesOf(g.trace, w.part).length < g.moves.length);
  assert.ok(short.length > 10, `${short.length} of ${T.games.length} matches have moves the raw trace cannot show (unchanged from round 2)`);
  for (const g of T.games) {
    const seen = movesOf(g.trace, w.part).map((m) => `${m.player}:${m.cell}`);
    const all = g.moves.map((m) => `${m.player}:${m.cell}`);
    let at = 0; for (const x of all) if (x === seen[at]) at += 1;
    assert.equal(at, seen.length, 'what the raw trace shows is an ordered subset of the output list');
    // expanded through the cache hits: every move, in order, in the right slot, by the right policy
    const full = movesOf(g.trace, w.part, { expand });
    assert.deepEqual(full.map((m) => `${m.player}:${m.cell}`), all, `${g.x} v ${g.o} seed ${g.seed}`);
    assert.deepEqual(full.map((m) => [m.slot, m.impl]), full.map((m, k) => (k % 2 === 0 ? ['X', policyId(g.x)] : ['O', policyId(g.o)])));
    assert.ok(full.every((m) => m.verdict && m.verdict.accepted), 'and every move has its audit');
  }
  const hollow = short.find((g) => g.trace.calls[0].cached);
  assert.ok(hollow, 'a cached first ply');
  assert.equal(hollow.trace.calls[0].calls.length, 0, 'the hit node itself is still childless');
  assert.equal(hollow.trace.calls[0].contract, 'match.tick');
  assert.equal(JSON.stringify(hollow.trace.calls[0]).includes('policy.choose'), false, 'and does not say which policy sat in slot X; its original does');
  const orig = expand(hollow.trace.calls[0]);
  assert.equal(JSON.stringify(orig).includes(`"slot":"X","impl":"${policyId(hollow.x)}"`), true);
});

test('the trace shows which policy made which move, including cached minimax moves', () => {
  const w = fresh();
  const first = playMatch(w, 'minimax', 'center-corners');
  const again = playMatch(w, 'minimax', 'center-corners');
  const m1 = movesOf(first.trace, w.part); const m2 = movesOf(again.trace, w.part);
  assert.equal(again.trace.cached, true, 'the whole repeated match is one cached call (round 1: only the plies were)');
  assert.deepEqual(m2, [], 'a cached root hides every move from the raw trace');
  const m3 = movesOf(again.trace, w.part, { expand: (n) => w.node(n.cachedFrom.run, n.cachedFrom.call) });
  assert.deepEqual(m3.map((m) => [m.slot, m.impl, m.cell, m.cached, m.run]), m1.map((m) => [m.slot, m.impl, m.cell, true, first.receipt.runId]), 'through the hit, every minimax move is back, marked cached with the run that made it');
  assert.equal(m1[0].impl, policyId('minimax')); assert.equal(m1[0].slot, 'X');
  assert.deepEqual(m1.map((m) => m.slot), m1.map((_, k) => (k % 2 === 0 ? 'X' : 'O')));
  const noCache = playMatch(w, 'minimax', 'center-corners', { cache: false });
  assert.deepEqual(movesOf(noCache.trace, w.part).map((m) => [m.slot, m.impl, m.cell]), m1.map((m) => [m.slot, m.impl, m.cell]));
});

// ------------------------------------------------------------------ check: legality is a verdict
test('game.moveLegal is a check: a rejection is a normal run with a reason', () => {
  const w = fresh();
  const r = w.run('game.moveLegal', { board: [1, 0, 0, 0, 2, 0, 0, 0, 0], cell: 4 });
  assert.deepEqual(r.outputs, { accepted: false, reason: 'cell 4 is occupied by O' });
  assert.equal(r.trace.kind, 'check');
  assert.deepEqual(r.receipt.verdicts.map((v) => v.accepted), [false]);
  assert.equal(r.receipt.status, 'ok');
});

test('every ply of an honest match is audited, and the receipt lists all verdicts accepted', () => {
  const w = fresh();
  const g = playMatch(w, 'first-empty', 'center-corners');
  assert.equal(g.receipt.verdicts.length, 6);
  assert.ok(g.receipt.verdicts.every((v) => v.accepted === true && /is empty$/.test(v.reason)));
  assert.deepEqual(g.receipt.verdicts.map((v) => v.reason), ['cell 0 is empty', 'cell 4 is empty', 'cell 1 is empty', 'cell 2 is empty', 'cell 3 is empty', 'cell 6 is empty']);
});

test('a rule-breaking policy forfeits: X stubborn v O first-empty is X0, O1, then X0 again is rejected and O wins', () => {
  const w = fresh();
  const g = playMatch(w, 'stubborn', 'first-empty');
  assert.deepEqual([g.status, g.board], ['O', [1, 2, 0, 0, 0, 0, 0, 0, 0]]);
  assert.deepEqual(g.moves, [{ player: 1, cell: 0 }, { player: 2, cell: 1 }]);
  assert.deepEqual(g.receipt.verdicts.map((v) => v.accepted), [true, true, false]);
  assert.equal(g.receipt.verdicts[2].reason, 'cell 0 is occupied by X');
  assert.equal(g.receipt.status, 'ok', 'the run succeeded; the verdict is data');
  assert.equal(w.replay(g.receipt).exact, true);
  const flipped = playMatch(w, 'first-empty', 'stubborn');
  assert.deepEqual([flipped.status, flipped.moves], ['X', [{ player: 1, cell: 0 }]], 'O stubborn plays 0, already taken by X on move 1');
});

test('the forfeit status reads back to the check that refused the move: declared (a test over the check) and imperative (a named branch)', () => {
  const w = fresh();
  const g = playMatch(w, 'stubborn', 'first-empty');
  const p = ply(g.trace.calls.at(-1));
  const byContract = (n, c) => n.calls.find((x) => x.contract === c);
  const legal = byContract(p, 'game.moveLegal'); const forfeit = byContract(p, 'match.opponent');
  assert.equal(legal.kind, 'check');
  assert.equal(w.part(legal.out.accepted.hash), false);
  assert.deepEqual(p.calls.map((c) => c.contract), ['policy.choose', 'game.moveLegal', 'match.opponent'], 'apply, outcome and record were skipped: no nodes; no helper contract for the negation');
  const decision = p.decisions.find((d) => d.label === 'forfeit');
  assert.equal(decision.ran, 'forfeit');
  // v0.6: the decision is else(apply): no typed complement, no restated and(status = ongoing, …). apply was skipped by the check, so the
  // else's one operand is the check's verdict (the cause of apply's skip), and the reader still gets the check from the forfeit row
  assert.deepEqual([decision.from.op, decision.from.steps], ['else', ['apply']], 'round 5: not(legal.accepted), a typed complement');
  assert.deepEqual(decision.from.args, [{ kind: 'call', call: legal.id, port: 'accepted' }]);
  // apply, after and record are skipped with the check's verdict as the cause, `after` by inheriting apply's skip
  assert.deepEqual(['apply', 'after', 'record'].map((n) => p.decisions.find((d) => d.label === n).from), Array(3).fill({ kind: 'call', call: legal.id, port: 'accepted' }));
  assert.deepEqual(p.out.status.from, { kind: 'call', call: forfeit.id, port: 'status' }, 'the status is the forfeit step\'s output (round 2: computed)');
  assert.deepEqual(p.decisions.filter((d) => d.skipped).map((d) => d.skipped), ['pickO', 'apply', 'after', 'record']);
  // the imperative ply keeps a computed status, but its decision names the branches that ran and were skipped
  const imp = w.run('match.play', {}, { fill: { ...fillFor('stubborn', 'first-empty'), 'match.ply': 'match.ply/imperative' }, cache: false });
  assert.deepEqual([imp.outputs.status, imp.outputs.moves], [g.status, g.moves]);
  const ip = ply(imp.trace.calls.at(-1));
  assert.deepEqual(ip.out.status.from, { kind: 'computed' }, 'still computed: the decision is recorded, the dependence of the value on it is not');
  const d = ip.decisions.find((x) => x.label === 'move is legal');
  const impLegal = ip.calls.find((c) => c.contract === 'game.moveLegal');
  assert.deepEqual([d.value, d.ran, d.skipped, d.from], [false, 'forfeit', 'apply', { kind: 'call', call: impLegal.id, port: 'accepted' }]);
  // round 3: "X is to move" was a plain boolean with provenance computed; now it is a test that names its operands
  const seat = ip.decisions.find((x) => x.label === 'X is to move');
  assert.deepEqual([seat.from.kind, seat.from.op, seat.from.args], ['test', 'eq', [{ kind: 'input', call: ip.id, port: 'player' }, { kind: 'literal', value: 1 }]]);
  assert.deepEqual([seat.ran, seat.skipped], ['pickX', 'pickO']);
});

test('the two ply implementations (declared composition, imperative ctx.when) play identical games', () => {
  const w = fresh();
  for (const [x, o] of [['first-empty', 'center-corners'], ['center-corners', 'center-corners'], ['stubborn', 'first-empty'], ['first-empty', 'stubborn'], ['random', 'random'], ['minimax', 'first-empty']]) {
    const a = w.run('match.play', {}, { fill: fillFor(x, o), seed: 8, cache: false });
    const b = w.run('match.play', {}, { fill: { ...fillFor(x, o), 'match.ply': 'match.ply/imperative' }, seed: 8, cache: false });
    assert.deepEqual(b.outputs, a.outputs, `${x} v ${o}`);
    assert.deepEqual(b.receipt.verdicts.map((v) => v.accepted), a.receipt.verdicts.map((v) => v.accepted), `${x} v ${o} verdicts`);
  }
});

test('a finished game passes through its ply: every step is skipped, recorded as a decision, and leaves no node', () => {
  const w = fresh();
  const done = { board: [1, 1, 1, 2, 2, 0, 0, 0, 0], player: 2, status: 'X', moves: [] };
  const r = w.run('match.ply', done, { cache: false });
  assert.deepEqual(r.outputs, { board: done.board, status: 'X', moves: [] });
  assert.deepEqual(r.trace.calls, [], 'round 3: one match.live call; round 4: the test reads the input, no call at all');
  assert.deepEqual(r.trace.decisions.map((d) => [d.label, d.value, d.skipped]), ['pickX', 'pickO', 'legal', 'apply', 'after', 'record', 'forfeit'].map((n) => [n, false, n]));
  // v0.5: one cause for five rows (the literal keeps its value), and the steps that read a skipped step inherit it.
  // v0.6: legal (a one over two skipped picks) and forfeit (an else over a skipped apply) inherit it too, with no guard of their own;
  // the cause arrives wrapped in the single-operand and that the inheritance builds from the picks' causes
  const ongoing = { kind: 'test', op: 'eq', args: [{ kind: 'input', call: r.trace.id, port: 'status' }, { kind: 'literal', value: 'ongoing' }] };
  assert.deepEqual(r.trace.decisions.slice(2).map((d) => d.from.op), Array(5).fill('and'));
  assert.deepEqual(r.trace.decisions.slice(2).map((d) => d.from.args), Array(5).fill([ongoing]), 'legal, apply, after, record, forfeit: the same original cause, the game-on test, written once in the source');
  assert.deepEqual(r.trace.decisions.slice(0, 2).map((d) => d.from.op), ['and', 'and']);
  for (const port of ['board', 'status', 'moves']) assert.deepEqual(r.trace.out[port].from, { kind: 'input', call: r.trace.id, port }, `${port} is a passthrough of the ply's own input`);
  // an ongoing game runs its steps, and the decisions say so
  const on = w.run('match.ply', { board: E, player: 1, status: 'ongoing', moves: [] }, { cache: false });
  assert.deepEqual(on.trace.calls.map((c) => c.contract), ['policy.choose', 'game.moveLegal', 'game.apply', 'game.outcome', 'match.append']);
  // v0.6 records inherited runs: after (no guard of its own) now has a row because it ran, and says it ran because apply's check accepted.
  // legal has none: it has no guard, and a one binding is not an edge the run record inherits through
  assert.deepEqual(on.trace.decisions.filter((d) => d.ran).map((d) => d.ran), ['pickX', 'apply', 'after', 'record'], 'round 5: pickX, legal, apply, record (after had no row)');
  assert.deepEqual(on.trace.decisions.map((d) => d.label), ['pickX', 'pickO', 'apply', 'after', 'record', 'forfeit']);
  // in the composed match the nine plies are all present; those after the end skip everything
  const nine = w.run('match.play', {}, { fill: { ...fillFor('first-empty', 'first-empty'), 'match.play': 'match.play/nine-plies' }, cache: false });
  assert.deepEqual(nine.trace.calls.map((c) => c.calls.length), [5, 5, 5, 5, 5, 5, 5, 0, 0], 'seven plies ran their steps, two skipped them all');
  assert.deepEqual(nine.trace.calls.slice(7).map((c) => c.decisions.every((d) => d.skipped)), [true, true]);
});

// ------------------------------------------------------------------ tick and drive: a match as a fold
test('drive: the same match, one tick per ply, ends in the same state as match.play', () => {
  const w = fresh();
  const g = playMatch(w, 'first-empty', 'center-corners');
  const d = driveMatch(w, 'first-empty', 'center-corners');
  assert.equal(d.ticks, 6);
  assert.deepEqual(d.final, { board: g.board, status: g.status, moves: g.moves });
  assert.deepEqual(d.receipts.map((r) => r.tick), [0, 1, 2, 3, 4, 5]);
  d.receipts.forEach((r, k) => {
    const from = r.trace.in.state.from;
    if (k === 0) assert.equal(from.kind, 'input');
    else assert.deepEqual([from.kind, from.run], ['run', d.receipts[k - 1].runId]);
  });
});

test('drive: any tick of a seeded random match replays on its own, in a fresh world, from its receipt', () => {
  const w = fresh();
  const d = driveMatch(w, 'random', 'random', { seed: 9, cache: true });
  const other = fresh();
  for (const r of d.receipts) assert.equal(other.replay(r).exact, true, `tick ${r.tick}`);
  assert.deepEqual(d.receipts.map((r) => r.seed), d.receipts.map((_, k) => [9, k]), 'tick k draws from seed [seed, k]');
  assert.equal(w.runs().length, d.receipts.length, 'replaying in another world appended nothing here');
});

test('drive: the game ends the drive (until), and a finished state would pass through', () => {
  const w = fresh();
  const d = driveMatch(w, 'first-empty', 'first-empty');
  assert.equal(d.ticks, 7);
  assert.equal(d.final.status, 'X');
  const extra = w.run('match.tick', { state: d.state }, { cache: false });
  assert.deepEqual(extra.outputs.state, d.final, 'one more tick after the game is over changes nothing');
});

test('FRICTION: ctx.drive draws every tick from the run\'s one random stream, world.drive seeds each tick [seed, k]: the same seed plays two different games', () => {
  const w = fresh();
  const inside = Array.from({ length: 12 }, (_, i) => playMatch(w, 'random', 'random', { seed: i + 1 }));
  const across = Array.from({ length: 12 }, (_, i) => driveMatch(w, 'random', 'random', { seed: i + 1 }));
  const differ = inside.filter((g, i) => JSON.stringify(g.moves) !== JSON.stringify(across[i].final.moves));
  assert.ok(differ.length >= 10, `${differ.length} of 12 seeds play a different game inside a run and across runs`);
  // each is reproducible by itself
  assert.equal(w.replay(inside[0].receipt).exact, true);
  across[0].receipts.forEach((r) => assert.equal(w.replay(r).exact, true));
  // with deterministic seats the two agree (test above)
});

// ------------------------------------------------------------------ cache (round 1 asserted the bugs; these assert the fixes)
test('cache: the same board under different policies never mixes answers', () => {
  const w = fresh();
  const board = [1, 2, 0, 0, 0, 0, 0, 0, 0];
  const ask = (name) => w.run('policy.choose', { board, player: 1 }, { fill: { 'policy.choose': policyId(name) } });
  const fe = ask('first-empty'); const cc = ask('center-corners');
  assert.deepEqual([fe.outputs.cell, cc.outputs.cell], [2, 4]);
  assert.equal(cc.trace.cached, false);
  // the shared sub-call IS reused across policies: both asked game.legalMoves for the same board
  assert.equal(cc.trace.calls[0].contract, 'game.legalMoves');
  assert.equal(cc.trace.calls[0].cached, true);
  assert.equal(cc.trace.calls[0].cachedFrom.run, fe.receipt.runId);
  const fe2 = ask('first-empty'); const cc2 = ask('center-corners');
  assert.deepEqual([fe2.trace.cached, cc2.trace.cached, fe2.outputs.cell, cc2.outputs.cell], [true, true, 2, 4]);
});

test('cache: an entry made with no slot serves a call in slot X (round 1: another seat id, no sharing)', () => {
  const w = fresh();
  const bare = w.run('policy.choose', { board: E, player: 1 }, { fill: { 'policy.choose': policyId('center-corners') } });
  const opening = w.run('match.opening', {}, { fill: fillFor('center-corners', 'first-empty') });
  const x = opening.trace.calls.find((c) => c.contract === 'policy.choose' && c.slot === 'X');
  assert.equal(x.cached, true);
  assert.equal(x.cachedFrom.run, bare.receipt.runId);
});

test('cache: the random policy is impure by itself (no pure:false needed) and is never cached', () => {
  const w = fresh();
  assert.equal(w.implementations().find((i) => i.id === policyId('random')).pure, true, 'declared pure; the kernel marks it from ctx.random');
  const ask = (seed) => w.run('policy.choose', { board: E, player: 1 }, { fill: { 'policy.choose': policyId('random') }, seed });
  const cells = new Set();
  for (let s = 1; s <= 25; s += 1) { const r = ask(s); assert.equal(r.trace.cached, false); assert.equal(r.trace.impure, true); cells.add(r.outputs.cell); }
  assert.ok(cells.size > 3, 'different seeds, different cells, never a stale hit');
});

test('cache: impurity climbs to the match: a match with a random seat is never cached, a match without one is', () => {
  const w = fresh();
  const r1 = playMatch(w, 'random', 'first-empty', { seed: 3 }); const r2 = playMatch(w, 'random', 'first-empty', { seed: 3 });
  assert.deepEqual([r1.trace.cached, r2.trace.cached, r1.trace.impure, r2.trace.impure], [false, false, true, true]);
  assert.deepEqual(r1.board, r2.board);
  const s1 = playMatch(w, 'first-empty', 'center-corners'); const s2 = playMatch(w, 'first-empty', 'center-corners');
  assert.deepEqual([s1.trace.cached, s2.trace.cached, s1.trace.impure], [false, true, undefined]);
});

test('cache: a composed match is not served stale when the seating changes (round 1: the first fill\'s game came back)', () => {
  const w = fresh();
  const a = playMatch(w, 'first-empty', 'center-corners', { matchImpl: 'match.play/nine-plies' });
  const swapped = playMatch(w, 'center-corners', 'first-empty', { matchImpl: 'match.play/nine-plies' });
  const truth = playMatch(w, 'center-corners', 'first-empty', { matchImpl: 'match.play/nine-plies', cache: false });
  assert.equal(swapped.trace.cached, false);
  assert.deepEqual(swapped.board, truth.board);
  assert.notDeepEqual(swapped.board, a.board);
  assert.equal(movesOf(swapped.trace, w.part).length, 5, 'and its trace shows its moves');
  const again = playMatch(w, 'center-corners', 'first-empty', { matchImpl: 'match.play/nine-plies' });
  assert.equal(again.trace.cached, true, 'the same fill a second time IS a hit');
  assert.deepEqual(again.board, truth.board);
  assert.ok(w.stats().cacheRejectedByDeps >= 1, 'the kernel rejected a stale entry by its recorded slot choices');
});

test('cache: a pure ply under the match does not poison a later match with other seats', () => {
  const w = fresh();
  playMatch(w, 'first-empty', 'center-corners');
  const second = playMatch(w, 'center-corners', 'first-empty');
  const truth = playMatch(fresh(), 'center-corners', 'first-empty');
  assert.deepEqual(second.board, truth.board);
  assert.equal(movesOf(second.trace, w.part).length, 5);
  assert.equal(second.trace.calls[0].cached, false, 'ply 1 depends on slot X, which resolves differently now');
});

test('cache: a pass-through ply (game already decided) depends on no slot, so it IS reused across seatings', () => {
  const w = fresh();
  const a = playMatch(w, 'first-empty', 'first-empty');
  const b = playMatch(w, 'first-empty', 'center-corners');
  void a; void b;
  const r1 = w.run('match.ply', { board: [1, 1, 1, 2, 2, 0, 0, 0, 0], player: 2, status: 'X', moves: [] }, { fill: fillFor('first-empty', 'first-empty') });
  const r2 = w.run('match.ply', { board: [1, 1, 1, 2, 2, 0, 0, 0, 0], player: 2, status: 'X', moves: [] }, { fill: fillFor('minimax', 'minimax') });
  assert.deepEqual([r1.trace.cached, r2.trace.cached], [false, true]);
});

// ------------------------------------------------------------------ friction 8, re-assessed
test('a search that leans on the kernel cache runs, and replay(receipt, { maxCalls }) can now re-run it cache-off (round 2: no way to raise the limit)', () => {
  const w = fresh();
  const intArr = { type: 'array', items: { type: 'integer' } };
  w.contract({ id: 'exp.value', in: { board: intArr, player: { type: 'integer' } }, out: { value: { type: 'integer' } } });
  w.implement({ id: 'exp.value/negamax', implements: 'exp.value', uses: ['exp.value', 'game.legalMoves', 'game.apply', 'game.outcome'], run: ({ board, player }, ctx) => {
    const { status } = ctx.call('game.outcome', { board });
    if (status.value === 'draw') return { value: 0 };
    if (status.value !== 'ongoing') return { value: -(board.value.filter((c) => c === 0).length + 1) };
    const { cells } = ctx.call('game.legalMoves', { board });
    let v = -Infinity;
    cells.value.forEach((_, i) => {
      const { board: nb } = ctx.call('game.apply', { board, player, cell: ctx.at(cells, i) });
      v = Math.max(v, -ctx.call('exp.value', { board: nb, player: ctx.literal(3 - player.value) }).value.value);
    });
    return { value: v };
  } });
  const r = w.run('exp.value', { board: E, player: 1 });
  assert.equal(r.outputs.value, 0, 'tic-tac-toe is a draw');
  assert.ok(r.receipt.calls < 200_000, `with the cache as transposition table: ${r.receipt.calls} calls`);
  assert.throws(() => w.replay(r.receipt), (e) => e.code === 'CALL_LIMIT', 'cache-off replay of the empty board needs about 1.9 million calls (round 2 measured it once with maxCalls 5,000,000: exact, 1,944,615 calls, 36 s; not repeated here)');
  // the same search from a position with one corner taken: 12,908 calls with the cache, 211,087 without
  const corner = w.run('exp.value', { board: [1, 0, 0, 0, 0, 0, 0, 0, 0], player: 2 });
  assert.equal(corner.outputs.value, 0);
  assert.ok(corner.receipt.calls < 20_000);
  assert.throws(() => w.replay(corner.receipt, { maxCalls: 100_000 }), (e) => e.code === 'CALL_LIMIT');
  const rep = w.replay(corner.receipt, { maxCalls: 250_000 });
  assert.equal(rep.exact, true, rep.mismatches.join('\n'));
  assert.ok(rep.fresh.calls > 200_000 && rep.fresh.calls > 10 * corner.receipt.calls, `replay re-ran ${rep.fresh.calls} calls against ${corner.receipt.calls}`);
  assert.equal(w.runs().filter((x) => x.contract === 'exp.value').length, 2, 'replay appended nothing');
});

// ------------------------------------------------------------------ tournament and perfect play
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

test('minimax never loses to any policy in the tournament, in either seat', () => {
  const w = fresh();
  const T = tournament(w, { seeds: SEEDS });
  for (const p of POLICY_NAMES) {
    assert.equal(T.table.minimax[p].loss, 0, `minimax as X vs ${p}`);
    assert.equal(T.table[p].minimax.win, 0, `${p} as X vs minimax`);
  }
  assert.deepEqual(T.table.minimax.minimax, { win: 0, draw: 1, loss: 0, n: 1 });
  assert.equal(T.table.minimax.random.win, 12, 'against random it wins every seeded game as X');
  assert.equal(T.games.length, 9 + 7 * 12);
  // the hand-derived deterministic cells
  assert.deepEqual(T.table['first-empty']['first-empty'], { win: 1, draw: 0, loss: 0, n: 1 });
  assert.deepEqual(T.table['first-empty']['center-corners'], { win: 0, draw: 0, loss: 1, n: 1 });
  assert.deepEqual(T.table['center-corners']['center-corners'], { win: 0, draw: 1, loss: 0, n: 1 });
});

test('minimax plays the game-theoretic value on every shallow position and a fixed sample of deep ones', () => {
  // independent reference: plain negamax, values -1/0/1, no kernel
  const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const won = (b, m) => L.some((l) => l.every((c) => b[c] === m));
  const memo = new Map();
  const val = (b, m) => { // value for m to move
    const k = b.join('') + m;
    if (memo.has(k)) return memo.get(k);
    let v;
    if (won(b, 3 - m)) v = -1; else if (!b.includes(0)) v = 0;
    else { v = -2; b.forEach((c, i) => { if (c === 0) { const n = [...b]; n[i] = m; v = Math.max(v, -val(n, 3 - m)); } }); }
    memo.set(k, v); return v;
  };
  const positions = []; const seen = new Set();
  (function walk(b, m, d) {
    const k = b.join(''); if (seen.has(k)) return; seen.add(k);
    if (won(b, 1) || won(b, 2) || !b.includes(0)) return;
    positions.push({ b, m, d });
    b.forEach((c, i) => { if (c === 0) { const n = [...b]; n[i] = m; walk(n, 3 - m, d + 1); } });
  })(E, 1, 0);
  assert.equal(positions.length + 0 > 4000, true);
  const shallow = positions.filter((p) => p.d <= 3);
  let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s; };
  const deep = positions.filter((p) => p.d > 3); const sample = Array.from({ length: 150 }, () => deep[rnd() % deep.length]);
  const w = fresh();
  for (const { b, m } of [...shallow, ...sample]) {
    const cell = run(w, 'policy.choose', { board: b, player: m }, { fill: { 'policy.choose': policyId('minimax') } }).outputs.cell;
    assert.equal(b[cell], 0);
    const after = [...b]; after[cell] = m;
    const got = won(after, m) ? 1 : -val(after, 3 - m);
    assert.equal(got, val(b, m), `${b.join('')} player ${m} chose ${cell}`);
  }
});

// ------------------------------------------------------------------ replay
test('replay of a seeded match is exact, and records the seats and the seed', () => {
  const w = fresh();
  const g = playMatch(w, 'random', 'center-corners', { seed: 4 });
  assert.equal(g.receipt.seed, 4);
  assert.ok(g.receipt.randomDraws >= 1);
  const rep = w.replay(g.receipt);
  assert.equal(rep.exact, true, rep.mismatches.join('\n'));
  assert.deepEqual(rep.fresh.fill, g.receipt.fill);
  assert.equal(rep.fresh.randomDraws, g.receipt.randomDraws);
});

test('replay is sensitive: the same receipt with another seed or another fill is not exact', () => {
  const w = fresh();
  const g = playMatch(w, 'random', 'random', { seed: 4 });
  const other = [1, 2, 3, 5, 6, 7, 8, 9].find((s) => playMatch(w, 'random', 'random', { seed: s }).board.join() !== g.board.join());
  assert.ok(other, 'some other seed plays a different game');
  assert.equal(w.replay({ ...g.receipt, seed: other }).exact, false);
  const swapped = { ...g.receipt, fill: { ...g.receipt.fill, 'policy.choose#O': policyId('first-empty') } };
  assert.equal(w.replay(swapped).exact, false);
});

test('a whole tournament replays exactly, match by match, and a second world reproduces it', () => {
  const w = fresh();
  const T = tournament(w, { seeds: [1, 2] });
  const bad = T.games.filter((g) => !w.replay(g.receipt).exact).map((g) => `${g.x} vs ${g.o} seed ${g.seed}`);
  assert.deepEqual(bad, []);
  const w2 = fresh();
  const T2 = tournament(w2, { seeds: [1, 2] });
  assert.deepEqual(T2.table, T.table);
  assert.deepEqual(T2.games.map((g) => g.receipt.outputs), T.games.map((g) => g.receipt.outputs));
  // and the cache does not change any result: same tournament, cache off
  const w3 = fresh();
  const T3 = tournament(w3, { seeds: [1, 2], cache: false });
  assert.deepEqual(T3.games.map((g) => [g.status, g.board]), T.games.map((g) => [g.status, g.board]));
});

test('a match receipt replays in a fresh world from its own input values, and replay appends nothing to runs()', () => {
  const w = fresh();
  const g = playMatch(w, 'random', 'minimax', { seed: 21 });
  const before = w.runs().length;
  assert.equal(w.replay(g.receipt).exact, true);
  assert.equal(w.runs().length, before);
  const other = fresh();
  const rep = other.replay(g.receipt);
  assert.equal(rep.exact, true, rep.mismatches.join('\n'));
  assert.equal(other.runs().length, 0);
});

test('every move of a cache-off tournament was audited, and no policy in it ever forfeited', () => {
  const w = fresh();
  const T = tournament(w, { policies: ['first-empty', 'center-corners', 'random'], seeds: [1, 2], cache: false });
  for (const g of T.games) {
    assert.equal(g.receipt.verdicts.length, g.moves.length, `${g.x} v ${g.o} seed ${g.seed}`);
    assert.ok(g.receipt.verdicts.every((v) => v.accepted));
  }
});

test('receipt.verdicts includes the audits inside a cached subtree, marked cached with their origin (round 2: left out)', () => {
  const w = fresh();
  const first = playMatch(w, 'first-empty', 'center-corners');
  const second = playMatch(w, 'first-empty', 'first-empty');
  assert.equal(first.receipt.verdicts.length, 6);
  assert.equal(second.moves.length, 7);
  assert.equal(second.receipt.verdicts.length, 7, '7 verdicts for 7 audited moves, though ply 1 was a cache hit');
  const cached = second.receipt.verdicts.filter((v) => v.cached);
  assert.equal(cached.length, 1, 'only the first ply was served from the cache');
  assert.equal(cached[0].cachedFrom.run, first.receipt.runId);
  assert.equal(cached[0].reason, 'cell 0 is empty');
  assert.ok(second.receipt.verdicts.every((v) => v.accepted));
  assert.deepEqual(second.receipt.verdicts.map((v) => v.reason), ['cell 0 is empty', 'cell 1 is empty', 'cell 2 is empty', 'cell 3 is empty', 'cell 4 is empty', 'cell 5 is empty', 'cell 6 is empty']);
  // the hit node carries them too, and a fully cached match carries all six
  const again = playMatch(w, 'first-empty', 'center-corners');
  assert.equal(again.trace.cached, true);
  assert.equal(again.trace.verdicts.length, 6);
  assert.equal(again.receipt.verdicts.length, 6);
  assert.ok(again.receipt.verdicts.every((v) => v.cached));
});

test('a failed match keeps the verdicts finished before the throw, and ctx.fault names the code', () => {
  const w = fresh();
  w.implement({ id: 'policy.choose/exploder', implements: 'policy.choose', uses: [],
    run: ({ board }, ctx) => (board.value.some((c) => c !== 0) ? ctx.fault('the exploder refuses to move after move 1', 'EXPLODED') : { cell: ctx.literal(0) }) });
  assert.throws(() => w.run('match.play', {}, { fill: fillFor('first-empty', 'exploder'), cache: false }), (e) => e.code === 'EXPLODED');
  const failed = w.runs().at(-1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'EXPLODED');
  assert.deepEqual(failed.verdicts.map((v) => [v.accepted, v.reason]), [[true, 'cell 0 is empty']], 'X\'s audit finished before O threw');
});

test('a game can be branched from a recorded position: world.ref links the first tick of the new drive to the old one', () => {
  const w = fresh();
  const played = driveMatch(w, 'first-empty', 'center-corners');            // X0 O4 X1 O2 X3 O6, O wins on 2-4-6
  assert.equal(played.final.status, 'O');
  const k = 3;                                                              // after O2: X must block at 6
  assert.deepEqual(played.receipts[k].trace.out.state && w.part(played.receipts[k].outputs.state).moves.length, 4);
  const b = branchDrive(w, played, k, 'minimax', 'center-corners');
  const link = b.receipts[0].trace.in.state.from;
  assert.deepEqual([link.kind, link.run], ['run', played.receipts[k].runId]);
  assert.deepEqual(link.from, { kind: 'call', call: played.receipts[k].trace.id, port: 'state' });
  assert.deepEqual(b.final.moves.slice(0, 4), played.final.moves.slice(0, 4), 'the first four moves are the recorded ones');
  assert.notDeepEqual(b.final.moves.slice(4), played.final.moves.slice(4));
  assert.equal(b.final.moves[4].cell, 6, 'minimax blocks the line 2-4-6');
  assert.notEqual(b.final.status, 'O', 'and O no longer wins');
  assert.equal(w.replay(b.receipts[0]).exact, true, 'the branch\'s first tick replays on its own');
  assert.throws(() => w.ref(played.receipts[k].runId, 9999, 'state'), (e) => e.code === 'NO_SUCH_CALL');
});

test('forfeits count as results in a tournament table: stubborn loses to first-empty in either seat, and X wins the mirror', () => {
  const w = fresh();
  const T = tournament(w, { policies: ['stubborn', 'first-empty'], seeds: [1] });
  assert.deepEqual(T.table.stubborn['first-empty'], { win: 0, draw: 0, loss: 1, n: 1 });
  assert.deepEqual(T.table['first-empty'].stubborn, { win: 1, draw: 0, loss: 0, n: 1 });
  assert.deepEqual(T.table.stubborn.stubborn, { win: 1, draw: 0, loss: 0, n: 1 }, 'stubborn v stubborn: X plays 0, then O is the first to play an occupied cell, so X wins');
});

// ------------------------------------------------------------------ what the new language still cannot say (FRICTION.md, round 3)
test('a conditional nests by inheritance: apply written as plain legal.accepted is skipped with legal (round 4: needed and(seatX, legal.accepted); round 3: ASSEMBLY_LINT, so one ply was two contracts)', () => {
  const w = fresh();
  const seatX = { eq: ['$in.player', 1] };
  const steps = (applyWhen) => [
    { name: 'pickX', call: 'policy.choose', slot: 'X', when: seatX, bind: { board: '$in.board', player: '$in.player' } },
    { name: 'legal', call: 'game.moveLegal', when: seatX, bind: { board: '$in.board', cell: 'pickX.cell' } },
    { name: 'apply', call: 'game.apply', when: applyWhen, bind: { board: '$in.board', player: '$in.player', cell: 'pickX.cell' } },
  ];
  const returns = { board: { first: ['apply.board', '$in.board'] }, status: '$in.status', moves: '$in.moves' };
  const play = (id, player) => w.run('match.ply', { board: E, player, status: 'ongoing', moves: [] }, { fill: { 'match.ply': id }, cache: false });
  // the plain spelling, which round 4 refused with ASSEMBLY_LINT, assembles, and the and() spelling still does
  w.compose({ id: 'match.ply/plain', implements: 'match.ply', steps: steps('legal.accepted'), returns });
  w.compose({ id: 'match.ply/flat', implements: 'match.ply', steps: steps({ and: [seatX, 'legal.accepted'] }), returns });
  for (const id of ['match.ply/plain', 'match.ply/flat']) {
    const x = play(id, 1);
    assert.deepEqual([x.outputs.board[0], x.trace.calls.map((c) => c.contract)], [1, ['policy.choose', 'game.moveLegal', 'game.apply']], id);
    const o = play(id, 2);
    assert.deepEqual([o.outputs.board, o.trace.calls.length], [E, 0], `${id}: nothing runs for O`);
  }
  // for O the plain spelling's apply is skipped with the original cause: the seat test, not a test of its own
  const o = play('match.ply/plain', 2);
  const applyRow = o.trace.decisions.find((d) => d.label === 'apply');
  assert.deepEqual([applyRow.value, applyRow.skipped, applyRow.from.op], [false, 'apply', 'eq'], 'inherited: the row names the seat test that skipped pickX and legal');
  // the shipped ply is one contract, with ON written on two steps (round 5: three; round 4: all seven), pickO derived by else and forfeit by else
  const shipped = JSON.stringify(w.implementations().find((i) => i.id === 'match.ply/declared').assembly);
  assert.equal(shipped.split('{"eq":["$in.status"').length - 1, 2, 'the game-on test is written on pickX and pickO only: legal lost it when a one over skipped picks learned to skip');
  assert.ok(shipped.includes('"else":["pickX"]'), 'the O seat is the derived complement of the X seat');
  assert.ok(shipped.includes('"else":["apply"]') && !shipped.includes('"not"'), 'the forfeit is else(apply), and no typed complement is left in the ply');
  assert.equal(w.contracts().some((c) => c.id === 'match.move'), false);
});

test('a skipped value inside a gather or concat skips the alternative, and first falls through (round 3: passed the lint, failed at run time with a symbol)', () => {
  const w = fresh();
  w.compose({ id: 'match.ply/gat', implements: 'match.ply', steps: [
    { name: 'pickO', call: 'policy.choose', slot: 'O', when: { eq: ['$in.player', 2] }, bind: { board: '$in.board', player: '$in.player' } },
  ], returns: { board: '$in.board', status: '$in.status',
    moves: { first: [{ concat: ['$in.moves', { gather: [{ gather: { player: '$in.player', cell: 'pickO.cell' } }] }] }, '$in.moves'] } } });
  const fill = { 'match.ply': 'match.ply/gat' };
  const one = w.run('match.ply', { board: E, player: 1, status: 'ongoing', moves: [] }, { fill, cache: false });
  assert.deepEqual(one.outputs.moves, [], 'player 1: the O pick was skipped, so the gather inside the concat was skipped, and first fell through to the input list');
  assert.deepEqual(one.trace.out.moves.from, { kind: 'input', call: one.trace.id, port: 'moves' });
  const two = w.run('match.ply', { board: E, player: 2, status: 'ongoing', moves: [] }, { fill, cache: false });
  assert.deepEqual(two.outputs.moves, [{ player: 2, cell: 0 }], 'player 2: the pick ran and the move was appended');
  // match.append still exists, but no longer because a skip could not pass through a gather: it names a value the ply builds in one place
  assert.ok(w.contracts().some((c) => c.id === 'match.append'));
});

test('one: overlapping seats are refused at assembly where first would have run both policies; an overlap the lint cannot prove is still AMBIGUOUS_BRANCH at run time (round 4: always run time)', () => {
  const w = fresh();
  const ON = { eq: ['$in.status', { literal: 'ongoing' }] };
  const mk = (id, whenX, whenO, pick) => w.compose({ id, implements: 'match.ply', steps: [
    { name: 'pickX', call: 'policy.choose', slot: 'X', when: whenX, bind: { board: '$in.board', player: '$in.player' } },
    { name: 'pickO', call: 'policy.choose', slot: 'O', when: whenO, bind: { board: '$in.board', player: '$in.player' } },
  ], returns: { board: '$in.board', status: '$in.status', moves: { first: [{ concat: ['$in.moves', { gather: [{ gather: { player: '$in.player', cell: pick } }] }] }, '$in.moves'] } } });
  mk('match.ply/both-first', ON, ON, { first: ['pickX.cell', 'pickO.cell'] });
  const input = { board: E, player: 1, status: 'ongoing', moves: [] };
  const fill = { ...fillFor('first-empty', 'center-corners') };
  const first = w.run('match.ply', input, { fill: { ...fill, 'match.ply': 'match.ply/both-first' }, cache: false });
  assert.deepEqual([first.trace.calls.length, first.outputs.moves], [2, [{ player: 1, cell: 0 }]], 'both policies ran, the first one won silently');
  // the same two seats under one: identical conditions, so the lint refuses the composition before any run
  assert.throws(() => mk('match.ply/both-one', ON, ON, { one: ['pickX.cell', 'pickO.cell'] }), (e) => e.code === 'ASSEMBLY_LINT' && /can both be live/.test(e.message));
  // conditions on different inputs overlap at run time but no implication shows it: the run-time check stays
  mk('match.ply/maybe-one', { eq: ['$in.player', 1] }, { ne: ['$in.status', { literal: 'draw' }] }, { one: ['pickX.cell', 'pickO.cell'] });
  assert.throws(() => w.run('match.ply', input, { fill: { ...fill, 'match.ply': 'match.ply/maybe-one' }, cache: false }), (e) => e.code === 'AMBIGUOUS_BRANCH');
  // the shipped ply uses one with a derived complement: the seats exclude each other by construction
  assert.ok(JSON.stringify(w.implementations().find((i) => i.id === 'match.ply/declared').assembly).includes('"one":["pickX.cell","pickO.cell"]'));
});

test('path fills: the policy in X\'s opponent model is chosen without touching O\'s (mirror seats, one run)', () => {
  const w = fresh();
  const both = { ...fillFor('mirror', 'mirror'), 'policy.choose#X/policy.choose#opp': policyId('center-corners') };
  const r = w.run('match.opening', {}, { fill: both, cache: false });
  assert.deepEqual(r.outputs.moves, [{ player: 1, cell: 4 }, { player: 2, cell: 0 }], 'X models O as center-corners and takes the centre; O models X as the default first-empty and takes cell 0');
  assert.deepEqual(r.trace.calls.filter((c) => c.slot).map((c) => [c.slot, c.impl, c.calls.map((k) => `${k.slot}:${k.impl}`)]),
    [['X', policyId('mirror'), [`opp:${policyId('center-corners')}`]], ['O', policyId('mirror'), [`opp:${policyId('first-empty')}`]]]);
  // the flat key reaches both models, the path key one
  const flat = w.run('match.opening', {}, { fill: { ...fillFor('mirror', 'mirror'), 'policy.choose#opp': policyId('center-corners') }, cache: false });
  assert.deepEqual(flat.outputs.moves, [{ player: 1, cell: 4 }, { player: 2, cell: 4 + 0 === 4 ? 0 : 0 }].map((m, i) => (i === 1 ? { player: 2, cell: flat.outputs.moves[1].cell } : m)));
  // v0.6: reach and rung from the receipt and the node, where round 5 scanned the trace for the O seat's child
  assert.equal(flat.receipt.fillReach['policy.choose#opp'].length, 2, 'the flat key reached both model calls, X\'s and O\'s');
  assert.deepEqual(flat.trace.calls.find((c) => c.slot === 'O').calls[0].chosenBy, { rung: 'slot fill', key: 'policy.choose#opp' }, 'by a slot fill, which beats the pin');
  // the cache stays correct across the two fills: the same board asked again under the other path fill is not a stale hit
  const w2 = fresh();
  const a = w2.run('match.opening', {}, { fill: both });
  const b = w2.run('match.opening', {}, { fill: { ...fillFor('mirror', 'mirror'), 'policy.choose#X/policy.choose#opp': policyId('first-empty') } });
  assert.notDeepEqual(a.outputs.moves, b.outputs.moves);
  assert.deepEqual(b.outputs.moves, [{ player: 1, cell: 0 }, { player: 2, cell: 1 }]);
  // a mistyped path key is a typo, not silence
  assert.throws(() => w.run('match.opening', {}, { fill: { ...fillFor('mirror', 'mirror'), 'policy.choose#Y/policy.choose#opp': policyId('minimax') }, cache: false }), (e) => e.code === 'BAD_FILL');
});

test('a path fill must land: a path under a seat that has no opponent model is BAD_FILL, and the receipt lists the keys that were consulted (round 4: accepted, unused, printed as if used)', () => {
  const w = fresh();
  const path = 'policy.choose#X/policy.choose#opp';
  assert.throws(() => w.run('match.opening', {}, { fill: { ...fillFor('first-empty', 'center-corners'), [path]: policyId('minimax') }, cache: false }),
    (e) => e.code === 'BAD_FILL' && /reached no call/.test(e.message) && e.message.includes(path));
  // under a seat that does call through it, the same key lands and is listed
  const r = w.run('match.opening', {}, { fill: { ...fillFor('mirror', 'first-empty'), [path]: policyId('center-corners') }, cache: false });
  assert.ok(r.receipt.fillConsulted.includes(path), JSON.stringify(r.receipt.fillConsulted));
  assert.ok(r.receipt.fillConsulted.includes('policy.choose#X') && r.receipt.fillConsulted.includes('policy.choose#O'));
  // v0.6: the receipt names the calls each key reached, so "which call did the path fill land on" is one lookup, not a walk of the trace
  const xCall = r.trace.calls.find((c) => c.slot === 'X');
  assert.deepEqual(r.receipt.fillReach[path], [xCall.calls[0].id], 'the path key reached the model call inside X, and only that one');
  assert.deepEqual([xCall.calls[0].slot, xCall.calls[0].impl, xCall.calls[0].chosenBy], ['opp', policyId('center-corners'), { rung: 'path fill', key: path }]);
  assert.deepEqual(r.receipt.fillReach['policy.choose#O'], [r.trace.calls.find((c) => c.slot === 'O').id], 'O is seated by first-empty and has no model call, so no path key under O exists to reach');
  // a flat slot key stays standing configuration: a fill for the model seat in a run where nobody consults it is not an error
  const flat = w.run('match.opening', {}, { fill: { ...fillFor('first-empty', 'center-corners'), 'policy.choose#opp': policyId('minimax') }, cache: false });
  assert.equal(flat.receipt.status, 'ok');
  assert.equal(flat.receipt.fillConsulted.includes('policy.choose#opp'), false, 'and the receipt says it was not used');
});

test('one fill table across a tournament: landing none lets the path keys of the mirror seats ride along in matches that never reach them; a mistyped flat key still fails, a mistyped path does not (round 5: one fill table per pairing)', () => {
  const w = fresh();
  const models = { 'policy.choose#X/policy.choose#opp': policyId('center-corners'), 'policy.choose#O/policy.choose#opp': policyId('first-empty') };
  const policies = ['first-empty', 'center-corners', 'mirror'];
  // the default landing refuses the table for the first pairing: first-empty has no model, so the path key reached no call
  assert.throws(() => tournament(w, { policies, seeds: [1], fill: models, cache: false }), (e) => e.code === 'BAD_FILL' && /reached no call/.test(e.message));
  const T = tournament(w, { policies, seeds: [1], fill: models, landing: 'none', cache: false });
  assert.equal(T.games.length, 9);
  // each match's receipt says where each key landed; a key that landed nowhere is listed with no calls instead of being absent
  const reach = (x, o, key) => T.games.find((g) => g.x === x && g.o === o).receipt.fillReach[key];
  const px = 'policy.choose#X/policy.choose#opp'; const po = 'policy.choose#O/policy.choose#opp';
  assert.deepEqual([reach('first-empty', 'first-empty', px), reach('first-empty', 'first-empty', po)], [[], []], 'no mirror seat, so no model call and an empty reach');
  assert.ok(reach('mirror', 'first-empty', px).length > 0 && reach('mirror', 'first-empty', po).length === 0, 'the X path key landed on the X mirror, the O path key on nothing');
  assert.ok(reach('first-empty', 'mirror', po).length > 0 && reach('first-empty', 'mirror', px).length === 0);
  assert.ok(reach('mirror', 'mirror', px).length > 0 && reach('mirror', 'mirror', po).length > 0, 'both landed');
  // the sweep says the same thing as the per-pairing runs it replaces (the path key only for the pairings that reach it)
  for (const g of T.games) {
    const own = Object.fromEntries(Object.entries(models).filter(([k]) => (k.includes('#X/') ? g.x : g.o) === 'mirror'));
    const alone = playMatch(w, g.x, g.o, { fill: own, cache: false });
    assert.deepEqual([alone.status, alone.moves], [g.status, g.moves], `${g.x} v ${g.o}`);
  }
  // a mirror whose X model is center-corners is not the same player as a mirror whose model is the pinned first-empty
  const plain = playMatch(w, 'mirror', 'first-empty', { cache: false });
  assert.notDeepEqual(plain.moves, T.games.find((g) => g.x === 'mirror' && g.o === 'first-empty').moves);
  // landing none does not silence a mistyped flat seat or an unknown contract
  assert.throws(() => playMatch(w, 'mirror', 'first-empty', { fill: { 'policy.choose#Y': policyId('minimax') }, landing: 'none', cache: false }), (e) => e.code === 'BAD_FILL');
  assert.throws(() => playMatch(w, 'mirror', 'first-empty', { fill: { 'policy.chose#X/policy.choose#opp': policyId('minimax') }, landing: 'none', cache: false }), (e) => e.code === 'BAD_FILL');
  // FRICTION N28: but a mistyped SLOT NAME inside a path is not a typo to landing none, only a key that landed nowhere:
  // the same two typos are BAD_FILL under the default landing, and under none the run goes ahead with the pinned first-empty model
  for (const typo of ['policy.choose#Y/policy.choose#opp', 'policy.choose#X/policy.choose#oppp']) {
    assert.throws(() => playMatch(w, 'mirror', 'first-empty', { fill: { [typo]: policyId('minimax') }, cache: false }), (e) => e.code === 'BAD_FILL', `${typo} under the default landing`);
    const g = playMatch(w, 'mirror', 'first-empty', { fill: { [typo]: policyId('minimax') }, landing: 'none', cache: false });
    assert.deepEqual([g.receipt.fillReach[typo], g.receipt.fillConsulted.includes(typo)], [[], false], `${typo} under none: accepted, and the receipt is the only place that says it landed nowhere`);
    assert.deepEqual(g.moves, plain.moves, 'the mirror quietly played with its pinned model');
  }
  // so a sweep checks its own table afterwards, from the receipts: every key must have reached some call in some match
  const everyKeyLanded = (games, table) => Object.keys(table).filter((k) => games.every((g) => (g.receipt.fillReach[k] ?? []).length === 0));
  assert.deepEqual(everyKeyLanded(T.games, models), [], 'the sweep table is clean: each path key landed somewhere');
  const typoTable = { ...models, 'policy.choose#X/policy.choose#oppp': policyId('minimax') };
  const T2 = tournament(w, { policies, seeds: [1], fill: typoTable, landing: 'none', cache: false });
  assert.deepEqual(everyKeyLanded(T2.games, typoTable), ['policy.choose#X/policy.choose#oppp'], 'and the mistyped one is the only key that reached nothing in nine matches');
  // and landing all is the opposite request: every key must land, so a sweep table fails on any pairing that misses one
  assert.throws(() => playMatch(w, 'mirror', 'first-empty', { fill: models, landing: 'all', cache: false }), (e) => e.code === 'BAD_FILL' && /policy\.choose#O\/policy\.choose#opp/.test(e.message));
  assert.doesNotThrow(() => playMatch(w, 'mirror', 'mirror', { fill: models, landing: 'all', cache: false }));
});

test('FRICTION: fillReach through a cache hit names the hit node, so in a cached sweep a path key and its parent seat share ids (N30); a fresh world keeps them apart', () => {
  const models = { 'policy.choose#X/policy.choose#opp': policyId('center-corners'), 'policy.choose#O/policy.choose#opp': policyId('first-empty') };
  const reachOf = (w) => playMatch(w, 'mirror', 'mirror', { fill: models, landing: 'none' }).receipt.fillReach;
  const fresh1 = reachOf(fresh());
  assert.ok(fresh1['policy.choose#X'].every((id) => !fresh1['policy.choose#X/policy.choose#opp'].includes(id)), 'no hits: the model call is a child of the seat call');
  // a cache warmed by the other pairings makes the mirror's own calls hits
  const w = fresh();
  tournament(w, { policies: ['first-empty', 'center-corners', 'mirror'], seeds: [1], fill: models, landing: 'none' });
  const warm = reachOf(w);
  assert.deepEqual(warm['policy.choose#X/policy.choose#opp'], warm['policy.choose#X'], 'both keys name the hit nodes of the seat calls');
});

test('a named trajectory example is reported by name, and a tick implementation that never changes seat fails it at tick 1', () => {
  const w = fresh();
  const bad = 'match.tick/always-x';
  w.implement({ id: bad, implements: 'match.tick', uses: ['match.ply'], run: ({ state }, ctx) => {
    const r = ctx.call('match.ply', { board: ctx.at(state, 'board'), player: ctx.literal(1), status: ctx.at(state, 'status'), moves: ctx.at(state, 'moves') });
    return { state: ctx.gather({ board: r.board, status: r.status, moves: r.moves }), status: r.status };
  } });
  const proofs = w.prove('match.tick', bad);
  const six = proofs.find((p) => p.example === 'six ticks: O closes the diagonal 2-4-6');
  assert.equal(six.ok, false);
  assert.match(six.detail, /^tick 1: expected /, 'the first wrong tick leads: O\'s reply, played as X');
  assert.equal(proofs.find((p) => p.example === 0).ok, true, 'the unnamed one-tick example passes: X moves first anyway');
  assert.equal(w.prove('match.tick', 'match.tick/ply').every((p) => p.ok), true);
});

test('a policy that models its opponent through a slot is not seated in its own model: the pin on slot opp beats prove\'s contract fill, and policy.choose#* reaches it on purpose (round 4: DEPTH_LIMIT)', () => {
  const w = fresh();
  w.implement({ id: 'policy.choose/mirror-naive', implements: 'policy.choose', uses: ['policy.choose#opp'],
    examples: [{ in: { board: [1, 2, 1, 0, 0, 0, 0, 0, 0], player: 1 }, out: { cell: 3 } }], // no fill for the slot `opp`, as in round 4
    run: ({ board, player }, ctx) => ({ cell: ctx.call('policy.choose', { board, player: ctx.literal(3 - player.value) }, { slot: 'opp' }).cell }) });
  const proof = w.prove('policy.choose', 'policy.choose/mirror-naive').find((p) => p.example === 'impl:0');
  assert.equal(proof.ok, true, proof.detail);
  const via = w.run('policy.choose', { board: [1, 2, 1, 0, 0, 0, 0, 0, 0], player: 1 }, { fill: { 'policy.choose': 'policy.choose/mirror-naive' }, cache: false });
  assert.deepEqual([via.outputs.cell, via.trace.calls[0].impl], [3, policyId('first-empty')], 'a contract fill seats the mirror, and its model seat keeps the pin');
  assert.deepEqual([via.trace.chosenBy, via.trace.calls[0].chosenBy], [{ rung: 'contract fill', key: 'policy.choose' }, { rung: 'slot select', key: 'policy.choose#opp' }], 'v0.6: the node names the rung, so the pin is read off the node');
  assert.deepEqual(via.receipt.fillReach, { 'policy.choose': [via.trace.id] }, 'and the contract fill reached the mirror only, not the model inside it');
  // #* says every seat, the pinned one included: that is the old recursion, now by request
  assert.throws(() => w.run('match.opening', {}, { fill: { 'policy.choose#*': 'policy.choose/mirror-naive' }, cache: false }), (e) => e.code === 'DEPTH_LIMIT');
  // every policy proves with no fill for opp on any example: the workaround fills of round 4 are gone
  const failed = w.prove('policy.choose').filter((p) => !p.ok).map((p) => p.impl);
  assert.deepEqual([...new Set(failed)], [policyId('stubborn')], 'only the rule-breaker fails, as before');
  assert.equal(JSON.stringify(w.contracts().find((c) => c.id === 'policy.choose').examples).includes('#opp'), false);
});

test('match.positions: ctx.drive with collect gathers the board of every ply into one Ref, each element pointing at its tick', () => {
  const w = fresh();
  const r = w.run('match.positions', {}, { fill: fillFor('center-corners', 'center-corners'), cache: false });
  assert.equal(r.outputs.boards.length, 9);
  assert.deepEqual(r.outputs.boards.at(-1), [2, 2, 1, 1, 1, 2, 2, 1, 1]);
  assert.deepEqual(r.trace.drives, [{ contract: 'match.tick', slot: null, startTick: 0, ticks: 9, stopped: 'until', calls: r.trace.calls.map((c) => c.id) }], 'until held on tick 9, the last allowed tick, and the drive says so (round 4: maxTicks)');
  const from = r.trace.out.boards.from;
  assert.equal(from.kind, 'gather');
  assert.equal(from.pieces.length, 9);
  // each board is a path into the collected states, and the collected states point at the tick calls
  const tickIds = r.trace.calls.map((c) => c.id);
  from.pieces.forEach((p, i) => {
    const src = (function root(f) { return f.kind === 'at' ? root(f.of) : f; })(p.from);
    assert.equal(src.kind, 'gather');
    assert.deepEqual(src.pieces.find((q) => q.path[0] === i).from.kind === 'call' ? src.pieces.find((q) => q.path[0] === i).from.call : null, tickIds[i]);
  });
  assert.deepEqual(r.trace.calls.map((c) => c.tick), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // the same positions as the board after each move of the played match
  const g = playMatch(w, 'center-corners', 'center-corners', { cache: false });
  assert.equal(g.trace.drives[0].ticks, 9);
});

test('a one over two skipped picks skips the step that binds it, so legal needs no guard of its own (round 5, FRICTION N23: NO_BRANCH, so legal carried and(ON) as a workaround)', () => {
  const w = fresh();
  const ON = { eq: ['$in.status', { literal: 'ongoing' }] };
  const mk = (id, legalWhen) => w.compose({ id, implements: 'match.ply', steps: [
    { name: 'pickX', call: 'policy.choose', slot: 'X', when: { and: [ON, { eq: ['$in.player', 1] }] }, bind: { board: '$in.board', player: '$in.player' } },
    { name: 'pickO', call: 'policy.choose', slot: 'O', when: { and: [ON, { else: ['pickX'] }] }, bind: { board: '$in.board', player: '$in.player' } },
    { name: 'legal', call: 'game.moveLegal', ...(legalWhen ? { when: legalWhen } : {}), bind: { board: '$in.board', cell: { one: ['pickX.cell', 'pickO.cell'] } } },
  ], returns: { board: '$in.board', status: '$in.status', moves: '$in.moves' } });
  mk('match.ply/unguarded', null); mk('match.ply/guarded', ON);
  const done = { board: [1, 1, 1, 2, 2, 0, 0, 0, 0], player: 2, status: 'X', moves: [] };
  const bare = w.run('match.ply', done, { fill: { 'match.ply': 'match.ply/unguarded' }, cache: false });
  const guarded = w.run('match.ply', done, { fill: { 'match.ply': 'match.ply/guarded' }, cache: false });
  assert.deepEqual([bare.trace.calls.length, guarded.trace.calls.length], [0, 0], 'v0.5 threw NO_BRANCH for the unguarded one; v0.6 skips legal with the picks');
  assert.deepEqual(bare.outputs, guarded.outputs);
  // the skip is the picks' own cause, the game-on test, not a test the author wrote on legal
  const row = bare.trace.decisions.find((d) => d.label === 'legal');
  assert.deepEqual([row.value, row.skipped, row.from.op], [false, 'legal', 'and']);
  assert.deepEqual(row.from.args, [{ kind: 'test', op: 'eq', args: [{ kind: 'input', call: bare.trace.id, port: 'status' }, { kind: 'literal', value: 'ongoing' }] }]);
  // the same ply for a live game still runs the check, and the picks' seat decides which pick it reads
  const live = (player) => w.run('match.ply', { board: E, player, status: 'ongoing', moves: [] }, { fill: { ...fillFor('first-empty', 'center-corners'), 'match.ply': 'match.ply/unguarded' }, cache: false });
  assert.deepEqual(live(1).trace.calls.map((c) => c.contract), ['policy.choose', 'game.moveLegal']);
  assert.deepEqual(live(2).trace.calls.map((c) => c.contract), ['policy.choose', 'game.moveLegal']);
  assert.equal(w.part(live(2).trace.calls[0].out.cell.hash), 4, 'O seat: center-corners takes the center, and legal checked that cell');
});

test('else(apply) is false for an outer exclusion and true for a refusal: a finished game does not forfeit, a refused move does (round 5, FRICTION N22: else(apply) ran the forfeit for a finished game, so the ply spelled it not(legal.accepted))', () => {
  const w = fresh();
  const ON = { eq: ['$in.status', { literal: 'ongoing' }] };
  const mk = (id, forfeitWhen) => w.compose({ id, implements: 'match.ply', steps: [
    { name: 'pickX', call: 'policy.choose', slot: 'X', when: { and: [ON, { eq: ['$in.player', 1] }] }, bind: { board: '$in.board', player: '$in.player' } },
    { name: 'pickO', call: 'policy.choose', slot: 'O', when: { and: [ON, { else: ['pickX'] }] }, bind: { board: '$in.board', player: '$in.player' } },
    { name: 'legal', call: 'game.moveLegal', bind: { board: '$in.board', cell: { one: ['pickX.cell', 'pickO.cell'] } } },
    { name: 'apply', call: 'game.apply', when: 'legal.accepted', bind: { board: '$in.board', player: '$in.player', cell: { one: ['pickX.cell', 'pickO.cell'] } } },
    { name: 'forfeit', call: 'match.opponent', when: forfeitWhen, bind: { player: '$in.player' } },
  ], returns: { board: { first: ['apply.board', '$in.board'] }, status: { first: ['forfeit.status', '$in.status'] }, moves: '$in.moves' } });
  mk('match.ply/forfeit-not', { not: ['legal.accepted'] }); mk('match.ply/forfeit-else', { else: ['apply'] });
  const done = { board: [1, 1, 1, 2, 2, 0, 0, 0, 0], player: 2, status: 'X', moves: [] };
  const taken = { board: [1, 0, 0, 0, 0, 0, 0, 0, 0], player: 2, status: 'ongoing', moves: [] };
  for (const id of ['match.ply/forfeit-not', 'match.ply/forfeit-else']) {
    const fin = w.run('match.ply', done, { fill: { 'match.ply': id }, cache: false });
    assert.deepEqual([fin.outputs.status, fin.trace.calls.length], ['X', 0], `${id}: a finished game forfeits nothing`);
    // stubborn in the O seat plays cell 0, which X holds: the check refuses and the opponent wins
    const refused = w.run('match.ply', taken, { fill: { ...fillFor('first-empty', 'stubborn'), 'match.ply': id }, cache: false });
    assert.deepEqual([refused.outputs.status, refused.trace.calls.map((c) => c.contract)], ['X', ['policy.choose', 'game.moveLegal', 'match.opponent']], `${id}: a refused move forfeits`);
  }
  const viaElse = w.run('match.ply', done, { fill: { 'match.ply': 'match.ply/forfeit-else' }, cache: false });
  const f = viaElse.trace.decisions.find((d) => d.label === 'forfeit');
  assert.deepEqual([f.value, f.skipped, f.from.op, f.from.steps], [false, 'forfeit', 'and', undefined], 'the forfeit is skipped by inheritance: apply was skipped by the finished game, so the else is skipped, not true');
});

test('FRICTION: a pin belongs to the world, not to the implementation that declares the slot: a world that registers a model policy without select(contract, impl, slot) still recurses under prove', () => {
  const w = createWorld({ name: 'tiny' });
  w.contract({ id: 'p', in: { n: { type: 'integer' } }, out: { v: { type: 'integer' } }, examples: [{ in: { n: 1 }, out: { v: 1 } }] });
  w.implement({ id: 'p/id', implements: 'p', run: ({ n }) => ({ v: n.value }) });
  w.implement({ id: 'p/model', implements: 'p', uses: ['p#opp'], examples: [{ in: { n: 1 }, out: { v: 1 } }], run: ({ n }, ctx) => ({ v: ctx.call('p', { n }, { slot: 'opp' }).v }) });
  w.select('p', 'p/id');
  const before = w.prove('p', 'p/model').find((x) => x.example === 'impl:0');
  assert.equal(before.ok, false);
  assert.match(before.detail, /DEPTH_LIMIT/, 'prove fills p with p/model; the slot opp has no select of its own');
  w.select('p', 'p/id', 'opp');
  assert.equal(w.prove('p', 'p/model').find((x) => x.example === 'impl:0').ok, true, 'one pin in the world fixes it; the implementation had no way to carry it');
});

test('FRICTION: a slot declaration is world-wide, not per reachable call: a fill for a declared slot is accepted in a run that never reaches it', () => {
  const w = fresh();
  const r = w.run('game.legalMoves', { board: E }, { fill: { 'policy.choose#X': policyId('minimax') } });
  assert.equal(r.receipt.status, 'ok');
  assert.throws(() => w.run('game.legalMoves', { board: E }, { fill: { 'policy.choose#W': policyId('minimax') } }), (e) => e.code === 'BAD_FILL');
});

test('ctx.drive records how many ticks ran and why it stopped (node.drives); the stop is not a decision row (round 3: not recorded at all)', () => {
  const w = fresh();
  const g = playMatch(w, 'first-empty', 'center-corners');
  assert.deepEqual(g.trace.drives, [{ contract: 'match.tick', slot: null, startTick: 0, ticks: 6, stopped: 'until', calls: g.trace.calls.map((t) => t.id) }]);
  assert.equal(g.trace.decisions, undefined, 'a stop is a drive record, not a decision with operands: FRICTION N7');
  assert.deepEqual(g.trace.calls.map((t) => w.part(t.out.status.hash)), ['ongoing', 'ongoing', 'ongoing', 'ongoing', 'ongoing', 'O']);
  assert.deepEqual(ply(g.trace.calls[0]).decisions.map((d) => d.label), ['pickX', 'pickO', 'apply', 'after', 'record', 'forfeit'],
    'each ply records why each guarded step ran or was skipped; v0.6 adds after (an inherited run) and legal has no row (round 5 counted six too: legal, no after)');
  const full = playMatch(w, 'center-corners', 'center-corners');
  assert.deepEqual([full.trace.drives[0].ticks, full.trace.drives[0].stopped], [9, 'until'], 'a full board ends the drive by until, on the last allowed tick');
});

test('when `until` holds on the very tick that exhausts maxTicks, node.drives says until: the safety bound set to the exact length of the game is not a failure (round 4: maxTicks)', () => {
  const w = fresh();
  const stopOf = (maxTicks) => {
    w.implement({ id: `match.play/bound-${maxTicks}`, implements: 'match.play', uses: ['match.tick'], examples: [],
      run: (_i, ctx) => {
        const { state } = ctx.drive('match.tick', { state: ctx.literal({ board: E, status: 'ongoing', moves: [] }) }, { until: (out) => out.status !== 'ongoing', maxTicks });
        return { board: ctx.at(state, 'board'), status: ctx.at(state, 'status'), moves: ctx.at(state, 'moves') };
      } });
    const r = w.run('match.play', {}, { fill: { 'match.play': `match.play/bound-${maxTicks}`, ...fillFor('center-corners', 'center-corners') }, cache: false });
    return r.trace.drives[0];
  };
  const tight = stopOf(9);
  const roomy = stopOf(10);
  assert.deepEqual([tight.ticks, roomy.ticks], [9, 9], 'the same nine ticks, the same draw on the ninth');
  assert.equal(roomy.stopped, 'until');
  assert.equal(tight.stopped, 'until', 'v0.5: until wins when it held on the last allowed tick');
  assert.equal(stopOf(8).stopped, 'maxTicks', 'and a bound that really cut the game short still says maxTicks');
});

test('startTick: a branch continues the clock, so a branch with the same seats and seed replays the original continuation exactly (round 3: the clock restarted at 0, so a random seat drew different cells)', () => {
  const w = fresh();
  const played = driveMatch(w, 'random', 'random', { seed: 9 });
  assert.ok(played.ticks >= 5);
  for (const k of [1, 2]) {
    const b = branchDrive(w, played, k, 'random', 'random', { seed: 9 });
    assert.deepEqual(b.receipts.map((r) => r.tick), Array.from({ length: b.ticks }, (_, i) => k + 1 + i), 'the branch counts ticks from the original clock');
    assert.deepEqual(b.receipts.map((r) => r.seed), b.receipts.map((r) => [9, r.tick]), 'so tick k draws from [seed, k] as in the original');
    assert.deepEqual(b.final, played.final, `branched after tick ${k}: the same game`);
  }
  // a different seat from the branch point on is a different game
  const other = branchDrive(w, played, 2, 'minimax', 'minimax', { seed: 9 });
  assert.notDeepEqual(other.final.moves.slice(3), played.final.moves.slice(3));
});

