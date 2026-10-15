// Render contest E (tic-tac-toe, interchangeable policies, kernel v0.6) from real runs.
//   node verify/render-e-game.mjs verify/out
// Every picture is made from recorded runs. Claims are written into EXPLAIN.md from e-game-facts.json before the PNGs are opened.
import fs from 'node:fs';
import path from 'node:path';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, driveToSvg, traceHtml } from '../src/view.mjs';
import { register, registerStubborn, playMatch, driveMatch, branchDrive, tournament, movesOf, fillFor, policyId } from '../contest/e-game/index.mjs';
import { matchBoardsSvg, tournamentGridSvg } from '../contest/e-game/view.mjs';

const outDir = process.argv[2] ?? 'verify/out';
fs.mkdirSync(outDir, { recursive: true });
const fresh = () => { const w = createWorld({ name: 'e' }); register(w); registerStubborn(w); return w; };
const write = (name, html) => fs.writeFileSync(path.join(outDir, `e-game-${name}.html`), html);
const h = (text) => `<h3 style="font:700 16px system-ui,sans-serif;margin:14px">${text}</h3>`;
const ids = (node, depth = 9) => (depth < 0 ? [] : [`#${node.id} ${node.contract}${node.slot ? '#' + node.slot : ''}${node.tick != null ? ' @' + node.tick : ''}${node.cached ? ' (cached)' : ''}`, ...node.calls.flatMap((c) => ids(c, depth - 1))]);
const facts = {};

// 1. the ctx.drive match: X first-empty v O center-corners, collapsed to depth 2 (match.play > match.tick @k > match.ply)
const w1 = fresh();
const short = playMatch(w1, 'first-empty', 'center-corners', { seed: 1 });
write('trace-short', traceHtml([traceToSvg(short.trace, w1.part, { title: 'E1  match.play/drive: ctx.drive folds match.tick six times (the ⟳ row records the drive and why it stopped); X = first-empty, O = center-corners (depth 2)', maxDepth: 2 })]));
facts.traceShort = {
  output: { status: short.status, board: short.board, moves: short.moves.map((m) => `${m.player === 1 ? 'X' : 'O'}${m.cell}`) },
  root: { id: short.trace.id, impl: short.trace.impl, calls: short.receipt.calls },
  ticks: short.trace.calls.map((t) => ({ id: t.id, tick: t.tick, cached: t.cached, ply: t.calls[0].id, plyOutStatus: w1.part(t.calls[0].out.status.hash), stateFrom: t.in.state.from })),
  rootMovesFrom: short.trace.out.moves.from,
  drives: short.trace.drives,
  rootDecisions: short.trace.decisions ?? null,
  verdicts: short.receipt.verdicts.map((v) => `${v.call}:${v.accepted}:${v.reason}`),
};

// 2. one ply, fully expanded: O (center-corners) answers X's move 0. One declared composition, relational tests, no helper contract.
const w2 = fresh();
const anat = w2.run('match.ply', { board: [1, 0, 0, 0, 0, 0, 0, 0, 0], player: 2, status: 'ongoing', moves: [{ player: 1, cell: 0 }] }, { fill: fillFor('first-empty', 'center-corners') });
write('ply', traceHtml([traceToSvg(anat.trace, w2.part, { title: 'E2  match.ply/declared, O to move after X0: ON is written on two steps (pickX, pickO), pickO is else(pickX), legal has no guard, forfeit is else(apply); apply and record read legal.accepted', valueChars: 40, receipt: anat.receipt })]));
const showFrom = (f) => (f.kind === 'test' ? `${f.op}(${f.args.map(showFrom).join(', ')})` : f.kind === 'input' ? `$in.${f.port}` : f.kind === 'call' ? `#${f.call}.${f.port}` : f.kind === 'literal' ? `literal${'value' in f ? ' ' + f.value : ''}` : f.kind);
facts.ply = { nodes: ids(anat.trace), decisions: anat.trace.decisions.map((d) => `${d.label}=${d.value} ${d.ran ? 'ran' : 'skipped'}: ${showFrom(d.from)}`),
  outputs: anat.outputs, outFrom: Object.fromEntries(Object.entries(anat.trace.out).map(([p, o]) => [p, o.from.kind + (o.from.kind === 'call' ? ' #' + o.from.call + '.' + o.from.port : '')])),
  appendPieces: anat.trace.calls.find((c) => c.contract === 'match.append').out.moves.from.pieces.map((p) => `${p.path}:${p.from.kind}`),
  stepsWithOwnGuard: anat.trace.decisions.map((d) => d.label),
  rungs: anat.trace.calls.map((c) => `#${c.id} ${c.contract}${c.slot ? '#' + c.slot : ''} ${c.impl} by ${c.chosenBy.rung}${c.chosenBy.key ? ' ' + c.chosenBy.key : ''}`), fillReach: anat.receipt.fillReach, fillConsulted: anat.receipt.fillConsulted,
  decisionOperands: anat.trace.decisions.map((d) => `${d.label}=${d.value} ${d.ran ? 'ran' : 'skipped'}: ${JSON.stringify(d.from).slice(0, 400)}`), helperContractsInTrace: [...new Set(JSON.stringify(anat.trace).match(/"contract":"(match\.live|match\.seat|logic\.not|match\.move)"/g) ?? [])] };

// 3. the board view, one row per match. After row A, rows G (first-empty v random, cache on) hit A's first tick.
const w3 = fresh();
const expand3 = (n) => w3.node(n.cachedFrom.run, n.cachedFrom.call);
const A = playMatch(w3, 'first-empty', 'center-corners', { seed: 1 });
const B = playMatch(w3, 'minimax', 'random', { seed: 7 });
const C = playMatch(w3, 'random', 'minimax', { seed: 11 });
const D = playMatch(w3, 'first-empty', 'center-corners', { seed: 1, matchImpl: 'match.play/nine-plies', cache: false });
const F = playMatch(w3, 'stubborn', 'first-empty', { seed: 1 });
const G = playMatch(w3, 'first-empty', 'random', { seed: 3 });
write('boards', traceHtml([matchBoardsSvg([
  { title: 'A  slot X = first-empty, slot O = center-corners  (match.play/drive)', trace: A.trace },
  { title: 'B  X = minimax, O = random, seed 7', trace: B.trace },
  { title: 'C  X = random, O = minimax, seed 11', trace: C.trace },
  { title: 'D  same pair as A, played by the composition match.play/nine-plies (cache off)', trace: D.trace },
  { title: 'F  X = stubborn (always cell 0), O = first-empty: the legality check rejects X on move 3', trace: F.trace },
  { title: 'G  X = first-empty, O = random seed 3, cache on, after row A', trace: G.trace },
], w3.part, { title: 'E3  Move sequences read from traces: move, slot, implementation, legality verdict', expand: expand3 })]));
const seq = (g, expand) => movesOf(g.trace, w3.part, { expand }).map((m) => `${m.move}:${m.slot}:${m.cell}:#${m.call}${m.run !== null ? '(run ' + m.run + ')' : ''}`);
facts.boards = {
  A: { status: A.status, board: A.board, moves: seq(A), outMoves: A.moves.map((m) => `${m.player === 1 ? 'X' : 'O'}${m.cell}`) },
  B: { status: B.status, board: B.board, firstTwo: seq(B).slice(0, 2), n: seq(B).length, outMoves: B.moves.map((m) => `${m.player === 1 ? 'X' : 'O'}${m.cell}`) },
  C: { status: C.status, board: C.board, n: seq(C).length },
  D: { status: D.status, board: D.board, moves: seq(D) },
  F: { status: F.status, board: F.board, moves: F.moves, verdicts: F.receipt.verdicts.map((v) => `#${v.call} ${v.accepted} ${v.reason}`), seq: seq(F) },
  G: { status: G.status, board: G.board, rawMoves: seq(G), expandedMoves: seq(G, expand3), outMoves: G.moves.map((m) => `${m.player === 1 ? 'X' : 'O'}${m.cell}`), tick0: { id: G.trace.calls[0].id, cached: G.trace.calls[0].cached, from: G.trace.calls[0].cachedFrom } },
  runsAB: { A: A.receipt.runId, G: G.receipt.runId },
};

// 4. the tournament grid
const w4 = fresh();
const T = tournament(w4, { seeds: [1, 2, 3, 4, 5, 6, 7, 8] });
write('tournament', traceHtml([tournamentGridSvg(T, { title: `E4  Tournament: every ordered pair, ${T.games.length} matches (random seeded 1..8)` })]));
facts.tournament = { games: T.games.length, table: T.table };

// 5. the cache trap of round 1, re-run: same two runs, cache on. The composed match, so idle plies exist.
const w5 = fresh();
const first = playMatch(w5, 'first-empty', 'center-corners', { seed: 1, matchImpl: 'match.play/nine-plies' });
const second = playMatch(w5, 'center-corners', 'first-empty', { seed: 1, matchImpl: 'match.play/nine-plies' });
const again = playMatch(w5, 'center-corners', 'first-empty', { seed: 1, matchImpl: 'match.play/nine-plies' });
const truth = playMatch(w5, 'center-corners', 'first-empty', { seed: 1, matchImpl: 'match.play/nine-plies', cache: false });
const expand5 = (n) => w5.node(n.cachedFrom.run, n.cachedFrom.call);
write('cache-trap', traceHtml([
  h('E5a  match.play/nine-plies, X = center-corners, O = first-empty, cache on, AFTER an earlier run with the seats the other way round (collapsed to depth 1). The root is not cached; the plies ran fresh; the idle plies after the win are cache hits on each other.'),
  traceToSvg(second.trace, w5.part, { title: 'E5a  second run (root not cached)', maxDepth: 1, valueChars: 90 }),
  h('E5b  the same fill a third time: the whole match is one cached box, with its original subtree drawn as ghosts (depth 2)'),
  traceToSvg(again.trace, w5.part, { title: 'E5b  third run (same fill as the second), expand = world.node(cachedFrom)', maxDepth: 1, expand: expand5 }),
  matchBoardsSvg([
    { title: `second run (cache on): board ${JSON.stringify(second.board)}`, trace: second.trace },
    { title: `third run (root is a cache hit; moves read through it): board ${JSON.stringify(again.board)}`, trace: again.trace },
    { title: `same fill, cache off: board ${JSON.stringify(truth.board)}`, trace: truth.trace },
  ], w5.part, { title: 'E5c  the swapped match with the cache on, through the hit, and with the cache off', expand: expand5 }),
]));
facts.cacheTrap = {
  firstStatus: first.status, secondStatus: second.status, secondRootCached: second.trace.cached, againRootCached: again.trace.cached,
  secondBoard: second.board, trueBoard: truth.board, againBoard: again.board, stats: w5.stats(),
  secondPlies: second.trace.calls.map((p) => `#${p.id}${p.cached ? ' cached' : ''}${p.decisions?.length ? ' dec:' + p.decisions.map((d) => d.value).join('') : ''}`),
  againFrom: again.trace.cachedFrom, againVerdicts: again.trace.verdicts.length, againReceiptVerdicts: again.receipt.verdicts.map((v) => !!v.cached),
  seqSecond: movesOf(second.trace, w5.part).map((m) => `${m.slot}${m.cell}`), seqAgain: movesOf(again.trace, w5.part, { expand: expand5 }).map((m) => `${m.slot}${m.cell}@run${m.run}#${m.call}`),
};

// 6. the match as a world.drive: one tick per ply, and a branch from a recorded position (world.ref)
const w6 = fresh();
const dr = driveMatch(w6, 'first-empty', 'center-corners', { seed: 1 });
const br = branchDrive(w6, dr, 3, 'minimax', 'center-corners');
const showState = (s) => s.board.map((v) => '.XO'[v]).join(''); // 9 characters, row by row
write('drive', traceHtml([
  driveToSvg(dr.receipts, w6.part, { title: 'E6  match.tick driven by world.drive: X = first-empty, O = center-corners, one run per ply', describe: showState }),
  h('E6b  tick 2 (the third ply) on its own, depth 2: its state input is tick 1\'s output, tagged as a cross-run reference'),
  traceToSvg(dr.receipts[2].trace, w6.part, { title: `E6b  tick 2, run ${dr.receipts[2].runId}`, maxDepth: 2 }),
]));
write('branch', traceHtml([
  driveToSvg(dr.receipts, w6.part, { title: 'E7a  the game as played: O wins on move 6 (ticks 0-5)', describe: showState }),
  driveToSvg(br.receipts, w6.part, { title: `E7b  the same game branched after tick 3 (run ${br.fromRun}), X = minimax: startTick 4, so the branch counts ticks 4, 5, ... on the original clock; its first tick reads world.ref(run ${br.fromRun}, 1, 'state')`, describe: showState }),
  h('E7c  the first tick of the branch: its state input is a reference into the old drive (← run ' + br.fromRun + ')'),
  traceToSvg(br.receipts[0].trace, w6.part, { title: `E7c  branch tick ${br.receipts[0].tick}, run ${br.receipts[0].runId}`, maxDepth: 1 }),
]));
facts.drive = { ticks: dr.ticks, final: dr.final, links: dr.receipts.map((r) => r.trace.in.state.from.kind), states: dr.receipts.map((r) => showState(w6.part(r.outputs.state))), runs: dr.receipts.map((r) => r.runId), cachedTicks: dr.receipts.map((r) => r.trace.cached) };
facts.branch = { tickNumbers: br.receipts.map((r) => r.tick), fromRun: br.fromRun, ticks: br.ticks, states: br.receipts.map((r) => showState(w6.part(r.outputs.state))), runs: br.receipts.map((r) => r.runId), link: br.receipts[0].trace.in.state.from, final: br.final, firstTickCached: br.receipts[0].trace.cached, calls: br.receipts.map((r) => r.calls) };

// 7. the forfeit: a rejected check inside a match (red box). The chain legal.accepted > logic.not > forfeit is gone: the guard is not(legal.accepted).
const w7 = w3; // the same world and run as row F of E3, so the call numbers agree
const forfeit = F;
const lastTick = forfeit.trace.calls.at(-1);
const fPly = lastTick.calls[0];
write('forfeit', traceHtml([
  h('E8  the last tick of the match X = stubborn, O = first-empty: game.moveLegal rejects cell 0; the guard of the forfeit step is else(apply), with no typed complement; apply, outcome and record are skipped by inheriting the verdict of the check as their cause'),
  traceToSvg({ ...forfeit.trace, calls: [lastTick] }, w7.part, { title: `E8  match.play (only its last tick shown), receipt.verdicts: ${forfeit.receipt.verdicts.map((v) => (v.accepted ? 'accepted' : 'REJECTED')).join(', ')}`, valueChars: 36, receipt: forfeit.receipt }),
  h('E8b  the same ply with match.ply/imperative: three ctx.when decisions with named branches (ran forfeit, skipped apply), each test with its operand and value; the status is still a computed value'),
  (() => {
    const imp = w7.run('match.play', {}, { fill: { ...fillFor('stubborn', 'first-empty'), 'match.ply': 'match.ply/imperative' }, cache: false });
    const t = imp.trace.calls.at(-1);
    const ply = t.calls[0];
    facts.forfeitImperative = { status: imp.outputs.status, plyId: ply.id, decisions: ply.decisions.map((d) => `${d.label}=${d.value} ${d.ran ? 'ran' : 'skipped'}: ${showFrom(d.from)}`), statusFrom: ply.out.status.from.kind + (ply.out.status.from.call ? ' #' + ply.out.status.from.call + '.' + ply.out.status.from.port : ''), children: ply.calls.map((c) => `#${c.id} ${c.contract}${c.slot ? '#' + c.slot : ''}`), calls: imp.receipt.calls };
    return traceToSvg({ ...imp.trace, calls: [t] }, w7.part, { title: 'E8b  match.play with match.ply/imperative (last tick only)', valueChars: 36 });
  })(),
]));
facts.forfeit = { status: forfeit.status, verdicts: forfeit.receipt.verdicts, lastTick: lastTick.id, ply: fPly.id, children: fPly.calls.map((c) => `#${c.id} ${c.contract}${c.slot ? '#' + c.slot : ''}`),
  decisions: fPly.decisions.map((d) => `${d.label}=${d.value} ${d.ran ? 'ran' : 'skipped'}: ${showFrom(d.from)}`), statusFrom: fPly.out.status.from, calls: forfeit.receipt.calls };

// 8. slots named in a composition, and gather in a composition return
const w8 = fresh();
const op = w8.run('match.opening', {}, { fill: fillFor('center-corners', 'first-empty') });
write('opening', traceHtml([traceToSvg(op.trace, w8.part, { title: 'E9  match.opening/two-plies: composition steps carry slot X and slot O; `moves` is a gather of two gathers' })]));
facts.opening = { outputs: op.outputs, nodes: ids(op.trace) };

// 9. a cache hit drawn with its original subtree (ghost boxes): row G's first tick, hit on row A's first tick
write('ghost', traceHtml([
  h('E10  the first tick of match G (X = first-empty, O = random) is a cache hit on the first tick of match A; with expand = world.node(cachedFrom) its original subtree is drawn as ghost boxes (faded, dashed, labelled with run A)'),
  traceToSvg({ ...G.trace, calls: [G.trace.calls[0]] }, w3.part, { title: `E10  match.play (run ${G.receipt.runId}), only its first tick, expanded`, expand: expand3, valueChars: 36 }),
]));
const g0 = G.trace.calls[0]; const g0orig = expand3(g0);
facts.ghost = { hit: `#${g0.id} ${g0.contract} @${g0.tick} cachedFrom run ${g0.cachedFrom.run} #${g0.cachedFrom.call}`, verdicts: g0.verdicts.map((v) => v.reason), original: ids(g0orig).slice(0, 40), originalImplOfX: JSON.stringify(g0orig).match(/"slot":"X","impl":"([^"]+)"/)?.[1], receiptVerdicts: G.receipt.verdicts.map((v) => `${v.cached ? 'cached' : 'fresh'} ${v.reason}`) };

// 10. the idle plies of the composed match: the move step is skipped and recorded, not run
write('passthrough', traceHtml([
  h('E11  match.play/nine-plies, X = first-empty, O = first-empty, cache off: X wins on move 7. Plies 6-9 (collapsed to depth 2): plies 6 and 7 ran their move, plies 8 and 9 skipped it'),
  (() => {
    const nine = w3.run('match.play', {}, { fill: { ...fillFor('first-empty', 'first-empty'), 'match.play': 'match.play/nine-plies' }, cache: false });
    facts.passthrough = { status: nine.outputs.status, plyChildren: nine.trace.calls.map((c) => c.calls.map((k) => k.contract)), decisions: nine.trace.calls.slice(5).map((c) => c.decisions.map((d) => `${d.label}=${d.value} ${d.ran ? 'ran' : 'skipped'}`)), ids: nine.trace.calls.slice(6).map((c) => c.id), outFrom: nine.trace.calls[8].out.board.from };
    return traceToSvg({ ...nine.trace, calls: nine.trace.calls.slice(5) }, w3.part, { title: 'E11  plies 6-9 of match.play/nine-plies', maxDepth: 2, valueChars: 36 });
  })(),
]));

// 11. path fills: both seats are the mirror policy, which models its opponent through the slot `opp`; one run, two different opponent models
const w11 = fresh();
const pathFill = { ...fillFor('mirror', 'mirror'), 'policy.choose#X/policy.choose#opp': policyId('center-corners') };
const pr = w11.run('match.opening', {}, { fill: pathFill, cache: false });
write('path', traceHtml([
  h('E12  match.opening/two-plies, both seats = mirror. The fill key policy.choose#X/policy.choose#opp puts center-corners into X\'s model of its opponent only; O\'s model falls back to the default first-empty'),
  traceToSvg(pr.trace, w11.part, { title: 'E12  match.opening (cache off): the nested policy.choose#opp calls carry different implementations; the fill line says every key was consulted', valueChars: 40, receipt: pr.receipt }),
]));
const nested = (n) => n.calls.flatMap((c) => [`#${c.id} ${c.contract}${c.slot ? '#' + c.slot : ''} = ${c.impl}`, ...c.calls.map((k) => `   inside #${c.id}: #${k.id} ${k.contract}${k.slot ? '#' + k.slot : ''} = ${k.impl}`)]);
facts.path = { fillReach: pr.receipt.fillReach, rungs: [...pr.trace.calls.flatMap((c) => [c, ...c.calls])].filter((c) => c.contract === 'policy.choose').map((c) => `#${c.id} ${c.slot} ${c.impl} by ${c.chosenBy.rung}${c.chosenBy.key ? ' ' + c.chosenBy.key : ''}`), fillConsulted: pr.receipt.fillConsulted, receiptFill: pr.receipt.fill, fill: pathFill, moves: pr.outputs.moves, nodes: nested(pr.trace), calls: pr.receipt.calls };

// 11b. specificity: a contract-wide fill (minimax) does not reach the pinned model seat; it does reach seat O, which has no select
const w11b = fresh();
const pinFill = { 'policy.choose': policyId('center-corners'), 'policy.choose#X': policyId('mirror') };
const pn = w11b.run('match.opening', {}, { fill: pinFill, cache: false });
const wide = w11b.run('match.opening', {}, { fill: { 'policy.choose#*': policyId('center-corners'), 'policy.choose#X': policyId('mirror') }, cache: false });
write('pin', traceHtml([
  h('E14a  match.opening with fill { policy.choose: center-corners, policy.choose#X: mirror }. Seat O has no select, so the contract fill reaches it (center-corners). X is the mirror policy, and its model seat #opp is pinned by world.select, so the contract fill does not reach it: first-empty'),
  traceToSvg(pn.trace, w11b.part, { title: 'E14a  contract fill center-corners: reaches seat O, not the pinned model seat', valueChars: 40, receipt: pn.receipt }),
  h('E14b  the same with fill { policy.choose#*: center-corners, policy.choose#X: mirror }: #* reaches every seat on purpose, the pinned model seat included; the more specific slot fill for X still wins at X'),
  traceToSvg(wide.trace, w11b.part, { title: 'E14b  policy.choose#*: reaches the pin', valueChars: 40, receipt: wide.receipt }),
]));
const rungsOf = (r) => [...r.trace.calls.flatMap((c) => [c, ...c.calls])].filter((c) => c.contract === 'policy.choose').map((c) => `#${c.id} ${c.slot} ${c.impl} by ${c.chosenBy.rung}${c.chosenBy.key ? ' ' + c.chosenBy.key : ''}`);
facts.pin = { a: { rungs: rungsOf(pn), fillReach: pn.receipt.fillReach, nodes: nested(pn.trace), moves: pn.outputs.moves, fill: pn.receipt.fill, consulted: pn.receipt.fillConsulted, calls: pn.receipt.calls },
  b: { rungs: rungsOf(wide), fillReach: wide.receipt.fillReach, nodes: nested(wide.trace), moves: wide.outputs.moves, fill: wide.receipt.fill, consulted: wide.receipt.fillConsulted, calls: wide.receipt.calls } };

// 12. ctx.drive with collect: the board after every ply as one Ref, each element pointing at its tick
const w12 = fresh();
const po = w12.run('match.positions', {}, { fill: fillFor('center-corners', 'center-corners'), cache: false });
write('positions', traceHtml([
  h('E13  match.positions/drive, X and O = center-corners: ctx.drive with collect: [state] hands back the state of all nine ticks; the output is a gather of nine paths into it'),
  traceToSvg(po.trace, w12.part, { title: 'E13  match.positions (cache off; collapsed to depth 1)', maxDepth: 1, valueChars: 52 }),
]));
const rootOf = (f) => (f.kind === 'at' ? rootOf(f.of) : f);
facts.positions = { nodes: ids(po.trace, 1), boards: po.outputs.boards.map((b) => b.map((v) => '.XO'[v]).join('')), outFrom: po.trace.out.boards.from.kind, pieces: po.trace.out.boards.from.pieces.length,
  firstPiece: `${po.trace.out.boards.from.pieces[0].from.kind}`, rootKind: rootOf(po.trace.out.boards.from.pieces[0].from).kind, drives: po.trace.drives };

// 13. one fill table across a sweep (landing: 'none'): the table carries the opponent-model path of BOTH seats; this pairing is mirror v first-empty,
//     so the O path key reaches nothing. The second run mistypes the slot inside the path: landing none accepts it, and the fill line is the only place that says so.
const w13 = fresh();
const sweepTable = { 'policy.choose#X/policy.choose#opp': policyId('center-corners'), 'policy.choose#O/policy.choose#opp': policyId('first-empty') };
const sw = w13.run('match.opening', {}, { fill: { ...fillFor('mirror', 'first-empty'), ...sweepTable }, landing: 'none', cache: false });
const typoKey = 'policy.choose#X/policy.choose#oppp';
const swTypo = w13.run('match.opening', {}, { fill: { ...fillFor('mirror', 'first-empty'), [typoKey]: policyId('center-corners') }, landing: 'none', cache: false });
write('sweep', traceHtml([
  h('E15a  match.opening, X = mirror, O = first-empty, with the sweep table { X/opp: center-corners, O/opp: first-empty } and landing: none. The X path key lands on X\'s model call; the O path key reaches nothing here (O has no model), and the fill line shows it with no calls'),
  traceToSvg(sw.trace, w13.part, { title: 'E15a  one fill table, landing none (cache off)', valueChars: 40, receipt: sw.receipt }),
  h('E15b  the same run with a mistyped slot inside the path (policy.choose#oppp): landing none accepts it; the model keeps its pinned first-empty and the key lands on no call'),
  traceToSvg(swTypo.trace, w13.part, { title: 'E15b  a mistyped path key under landing none', valueChars: 40, receipt: swTypo.receipt }),
]));
facts.sweep = { a: { rungs: rungsOf(sw), fillReach: sw.receipt.fillReach, consulted: sw.receipt.fillConsulted, moves: sw.outputs.moves, calls: sw.receipt.calls },
  b: { rungs: rungsOf(swTypo), fillReach: swTypo.receipt.fillReach, consulted: swTypo.receipt.fillConsulted, moves: swTypo.outputs.moves } };

fs.writeFileSync(path.join(outDir, 'e-game-facts.json'), JSON.stringify(facts, null, 1));
console.log('wrote e-game-{trace-short,ply,boards,tournament,cache-trap,drive,branch,forfeit,opening,ghost,passthrough,path,pin,positions,sweep}.html');
