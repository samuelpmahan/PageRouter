# Contest E · friction report (earlier points with round 6 status, then new friction)

Domain: tic-tac-toe, four interchangeable policies (first-empty, center-corners, random, minimax), a match with two seats, a 65-match tournament, a legality check, a match as a drive, a game branched from a recorded position.
Evidence comes from `test/contest-e-game.test.mjs` (72 tests) and `verify/out/e-game-*.png` (fifteen pictures); claims are numbered in `EXPLAIN.md`. Round 6 targets kernel v0.6: inherited runs, `else` and `one` that inherit context, `chosenBy`, `fillReach`, `landing`, named examples, the v0.6 view.

## Round 5 friction (N22 to N27): status after round 6

| # | Point | Status | Evidence |
|---|---|---|---|
| N22 | Inheritance stops at a `one`: a step binding a `one` of skipped steps is `NO_BRANCH` (top request, with N23) | **Resolved** (seq 54) | test `a one over two skipped picks skips the step that binds it, so legal needs no guard of its own` (red 63, flipped): the unguarded `legal` is skipped with the picks, 0 calls, same outputs as the guarded one; the row's cause is the picks' own `and(eq($in.status="X", "ongoing"))`. The shipped ply has no `when` on `legal`. Pictures: E-61, E-63. Left over: a `one` over *running* picks leaves no `ran` row for `legal` (N29) |
| N23 | `else` cannot tell a refusal from an outer exclusion | **Resolved** (seq 54) | test `else(apply) is false for an outer exclusion and true for a refusal` (red 64, flipped): both spellings (`not(legal.accepted)`, `else(apply)`) forfeit a refused move (status `'X'`, calls `policy.choose, game.moveLegal, match.opponent`) and neither runs for a finished game (0 calls). The shipped ply uses `else(apply)`; **yes, `not(legal.accepted)` could become `else(apply)`**. Pictures E-62 |
| N24 | Cache hits keep the decision rows but not the operand values | **Partly resolved** (audit fix) | cache-trap E5a: the hits #44 and #45 now read `and(eq($in.status="X", "ongoing"))` like the fresh #42 (E-60 PASS). A hit's decision whose operands are a call's ports (not the hit's own inputs) was not exercised: the hits in my pictures are all finished plies |
| N25 | The derived complement prints the whole cause of what it complements | **Resolved** | ply: `pickO` reads `and(eq(…), else(pickX))` and `forfeit` reads `else(apply)`; the long expression is gone (E-53) |
| N26 | A pin belongs to the world, not the implementation that declares the slot | **Open** (deferred, seq 59) | test `FRICTION: a pin belongs to the world…` still passes unchanged; the pin is still one line in `register(world)`. Round 6 added `chosenBy`, which shows the pin when it is working (`by pin policy.choose#opp`, E-65), but cannot make a world carry it |
| N27 | A path fill must land, so one fill table cannot serve a whole tournament | **Resolved with a cost** (seq 56) | test `one fill table across a tournament: landing none…`: `tournament(w, { policies: ['first-empty','center-corners','mirror'], fill: models, landing: 'none' })` plays nine matches with a table that carries both seats' model paths; the default landing refuses it on the first pairing. Each receipt's `fillReach` lists the path keys that reached nothing with `[]`. Cost: N28 |

Round 4 and earlier statuses are as in the table below, with these changes in round 6: N14 is **Resolved** (`ON` is written on the two picks that read nothing earlier; nothing else restates it); N17 stays **Partly resolved** (trace-short at depth 2 still names `#6.accepted=true` where #6 is not drawn); N18 stays **Partly resolved** (the labels now end with the tick, `←@k`, E-72; the implementation still reads `.value.map`); N20 stays **Resolved** with `CHOSEN` as the one constant; N24 above.

## Round 5 table, kept: Round 4 friction (N13 to N21): status after round 5


| # | Point | Status | Evidence |
|---|---|---|---|
| N13 | A contract fill reaches into a slot that has a default (top request) | **Resolved** (seq 46) | test `a policy that models its opponent through a slot is not seated in its own model…` (the round 4 FRICTION test, rewritten; it was not red at the start but broke when the pin replaced the fills): `prove` passes with no fill for `opp` on any example; a contract fill leaves the pin alone; `policy.choose#*` recurses on purpose (`DEPTH_LIMIT`). Pictures E14a, E14b (E-55, E-56). The two contract examples and one mirror example lost their `#opp` fill. Remaining cost: N26 |
| N14 | Every step repeats the `and(ON, …)` guard | **Mostly resolved** (seq 44) | test `a conditional nests by inheritance…` (red 56): `ON` is written on three steps, not seven; apply and record read `legal.accepted` and inherit; forfeit is `not(legal.accepted)`; finished-game plies show one cause for five steps (E-57). The three that remain: N22 |
| N15 | A string literal operand loses its value | **Resolved** (seq 49) | `eq($in.status="ongoing", "ongoing")` in every ply picture; test `a finished game passes through its ply…` (red 32) now asserts `value: 'ongoing'` |
| N16 | `node.drives` says `maxTicks` when `until` held on the last tick | **Resolved** (seq 49) | test `when until holds on the very tick that exhausts maxTicks, node.drives says until…` (red 65) and `match.positions: …` (red 62); ghost and positions pictures (E-44) |
| N17 | View: text cut at the image edge; rows name undrawn boxes | **Partly resolved** (seq 50) | branch E7c and cache-trap E5a wrap inside the box (E-52 passes). Trace-short at depth 2 still names `#6.accepted=true` where #6 is not drawn |
| N18 | `collect`: length read by value; labels `pieces ×9` | **Partly resolved** (seq 50) | the nine `pieces ×9` lines are now `[k]gather[k]←[board]`, one per selected piece (E-48). The implementation still reads `collected.state.value.map` to learn how many (no wildcard path; slices are deferred, seq 52) |
| N19 | A path fill is checked by names, not reach | **Resolved** (seq 47) | test `a path fill must land…` (red 60): `BAD_FILL … reached no call`; the receipt lists `fillConsulted`. Cost: N27 |
| N20 | `one` is a run-time check on what the tests could prove | **Resolved** (seq 45) | test `one: overlapping seats are refused at assembly…` (red 58): `ASSEMBLY_LINT … can both be live`; an overlap the lint cannot prove is still `AMBIGUOUS_BRANCH`. Complement derived by `else` (pickO). The spec still has to be named once in a JavaScript constant (`CHOSEN`) |
| N21 | A test row names operands but not values | **Resolved** (seq 50) | rows read `eq($in.player=2, 1)`, `#4.accepted=true`. Not on cache hits (N24) |

Points 1 to 14 and N1 to N12 (statuses as in the next two tables, with the round 5 changes): point 5 is complete for the conditional and still open for the loop; point 12 (a check guards a calculation, nothing says so) and point 13 (one random stream per run, one per tick across runs) are **Open, unchanged**; point 8 (replay is cache-off) **Partly resolved, unchanged**; N5 (slot declaration world-wide) **Partly resolved**: path keys must land (N19), flat slot keys stay standing configuration (test `FRICTION: a slot declaration is world-wide…` still passes); N8 **Open, unchanged**; N12 **Unchanged**: no entry reads the clock, so the new `tick` example form has nothing to prove here.

## Workarounds removed, kept (round 5)

| | Round 4 | Round 5 |
|---|---|---|
| Steps that restate the game-on guard `ON` | 7 of 7 (inside `SEAT_X`, `SEAT_O`, `LEGAL`, `REFUSED`, and `ON` itself) | **3** (`pickX`, `pickO`, `legal`) |
| Named guard constants | 5 (`ON`, `SEAT_X`, `SEAT_O`, `LEGAL`, `REFUSED`) | **1** (`ON`; `CHOSEN` for `one` stays) |
| Typed complements | 2 (`eq(player, 2)` for the O seat; `not(legal.accepted)`) | **1** (`not(legal.accepted)`; the O seat is `else(pickX)`) |
| Composition lines (constants and compose) | 18 | 14 |
| Decision rows on a running ply, recorded / drawn | 7 / 5 | 6 / 5 |
| Fills that exist only to dodge contract-fill precedence | 3 `policy.choose#opp` fills (two on `policy.choose` examples, one on the first `mirror` example); my round 4 report said five, the file had four fills of which this is three | **0** |
| Pins | 0 | **1** (`select('policy.choose', first-empty, 'opp')`, the intended use) |
| Fills kept because they choose, not dodge | 1 (`mirror`'s second example, model = center-corners) | 1 |
| Hand-kept trajectories outside `prove` | 1 (the six states of the short match: `EXPLAIN.md` E-26, and a last-state-only `match.tick` example) | **0** (a six-tick `trajectory` on the `match.tick` example, every tick proven) |

Removed:
- `SEAT_X`, `SEAT_O`, `LEGAL`, `REFUSED` and the `ON` inside four of them;
- the `when` on `apply`, `after`, `record` (now `legal.accepted`, `legal.accepted`, none) and `forfeit` (now `not(legal.accepted)` without `ON`);
- the typed `eq(player, 2)`: `else(pickX)`;
- every `'policy.choose#opp'` fill on `policy.choose`'s own examples and on `mirror`'s first example;
- the `FRICTION` expectations of rounds 3 and 4 that v0.5 closed (see the flips below);
- the hand listing of six per-tick states: a `trajectory` example on `match.tick`.

Kept, with reasons:
- `ON` on `pickX`, `pickO` and `legal`: the two picks read nothing earlier, and `legal` reads a `one` of them, which is `NO_BRANCH` and not a skip when both are skipped (N22);
- `not(legal.accepted)` for the forfeit: `else(apply)` would run for a finished game as well (N23);
- `match.opponent` and `match.append` (value builders, as in round 4);
- the tournament as a loop; the memo in minimax; `nine-plies`; the `gather` of two `gather`s in `match.opening`;
- `match.ply/imperative` (cross-check, named branches);
- one fill that chooses: `mirror`'s second example;
- the `.value.map` in `match.positions/drive` (N18).

Tests flipped in round 5 (keep the scenario, name says what now holds):
- 21: `select takes a slot and examples carry fill…` → `a seat's select is a pin: a contract fill does not reach it, #* does on purpose (round 4: a contract fill beat the slot select)`;
- 32: `a finished game passes through its ply…` kept; asserts the literal's value, one cause on five rows, and no `after` row when it runs;
- 56: `a conditional nests through and()…` → `a conditional nests by inheritance: apply written as plain legal.accepted is skipped with legal…`;
- 58: `one: exactly one seat is live; overlapping seats fail with AMBIGUOUS_BRANCH…` → `one: overlapping seats are refused at assembly where first would have run both policies; an overlap the lint cannot prove is still AMBIGUOUS_BRANCH at run time`;
- 60: `FRICTION: a path fill is checked by the names on it…` → `a path fill must land: a path under a seat that has no opponent model is BAD_FILL, and the receipt lists the keys that were consulted`;
- 62 and 65 (and 64): `stopped: 'until'`; the N16 FRICTION test → `when until holds on the very tick that exhausts maxTicks, node.drives says until…`;
- also rewritten because my restructure changed their numbers: 30 (forfeit status reads back to the check), 61 (the N13 test: `a policy that models its opponent through a slot is not seated in its own model…`).
New FRICTION tests: inheritance stops at `one` (N22), `else` vs finished game (N23), a pin belongs to the world (N26).

## New friction in round 5

Each point ends with the Hegel/Wittgenstein line. N22, N23 are about inherited skips and `else`, N26 about specificity, N27 about path landing, N24, N25 are view.

### N22. Inheritance stops at a `one`: a step that binds a `one` of skipped steps is an error, not a skip

- **Needed:** `legal` runs when a seat was picked; for a finished game it should be skipped because both picks were, with no guard of its own.
- **Kernel today:** `legal` binds `cell: { one: ['pickX.cell', 'pickO.cell'] }`. With both picks skipped the `one` has nothing to choose and the run fails with `NO_BRANCH: every alternative of a one binding was skipped`; a step that reads a skipped step directly (`apply` reads `legal.accepted`, `after` reads `apply.board`) does inherit. So `ON` is written on `legal`.
- **Workaround:** `when: ON` on `legal`.
- **Proposed shape:** a `one` binding whose alternatives are all skipped is itself skipped, the step inherits it like any other skipped read; `NO_BRANCH` only where the `one` is a composition output (`returns`), where a value is demanded.
- **Severity:** ergonomic only (and the failure message names the step).
- **Evidence:** test `FRICTION: inheritance stops at a one binding…`.
- **Hegel would say** a choice among things that did not happen did not happen either, the same as a read of one that did not happen; **Wittgenstein would say** the word `one` was written to forbid two, and nobody used it to demand one: the `NO_BRANCH` rule for `returns` is the use, and a binding is not a return.

### N23. `else` cannot tell a refusal from an outer exclusion

- **Needed:** forfeit runs when the check refused. `else: ['apply']` reads like exactly that.
- **Kernel today:** `apply` is skipped both when the check refused and when the game was already over (it inherited the skip of `legal`). `else(apply)` is true in both, so a finished game runs the forfeit and the match records a forfeit nobody committed. `not(legal.accepted)` is skipped with `legal`, so it is right.
- **Workaround:** the typed complement `not(legal.accepted)`; `else` only for the seats (`pickO`), where the outer test is inside its own `and(ON, …)`.
- **Proposed shape:** `else` could name which cause it wants (`else: { steps: ['apply'], cause: 'own' }`), or inherit like any other read of a skipped step, so that `else(apply)` under a skipped `legal` is skipped.
- **Severity:** distorts (a silent wrong forfeit, found only because a finished-game test exists).
- **Evidence:** test `FRICTION: else cannot tell a refusal from an outer exclusion…`.
- **Hegel would say** the other of a branch is determinate only within the whole it divides, and `else` divides the wrong whole; **Wittgenstein would say** nobody uses "otherwise" without a context, and the context here is the step's own guard, which `else` forgets.

### N24. Cache hits keep the decision rows but not the operand values

- **Needed:** read why the finished plies #44 and #45 were skipped.
- **Kernel today:** fresh #43 reads `eq($in.status="X", "ongoing")`; the hits #44 and #45 read `eq($in.status, "ongoing")`. The cause is the same test; the value that decided it is gone.
- **Workaround:** read the input row above.
- **Proposed shape:** carry operand values with the decision on a hit, or recompute them from the hit's own inputs in the view.
- **Severity:** ergonomic only.
- **Evidence:** cache-trap E5a (EXPLAIN E-60).
- **Hegel would say** a hit is the original in another place and carries the same determinations; **Wittgenstein would say** a hit is a use of a stored answer, and the stored answer never held the values, only the verdict.

### N25. The derived complement prints the whole cause of the thing it complements

- **Needed:** read `pickO`'s guard.
- **Kernel today:** `and(eq(status…), else(pickX: and(eq(status…), eq(player…))))`: four lines, longest row of the box; every line of it is correct and `pickX`'s row is two lines above.
- **Workaround:** none.
- **Proposed shape:** print `else(pickX)` and the value of the step's own cause (`pickX skipped by eq($in.player=2, 1)`), not the expression a second time.
- **Severity:** ergonomic only.
- **Evidence:** ply picture E-53.
- **Hegel would say** the complement is already named by what it complements; **Wittgenstein would say** an explanation that repeats its subject is a rule quoted, not followed.

### N26. A pin belongs to the world, not to the implementation that declares the slot

- **Needed:** `mirror` declares `policy.choose#opp` and cannot work as a model of its opponent unless that slot defaults to something other than what `prove` puts there.
- **Kernel today:** v0.5 fixed the precedence (a slot select beats a contract fill), but the select is a call on the world (`world.select('policy.choose', first-empty, 'opp')`), made by whoever builds the world. A world that registers `mirror` and forgets the pin recurses under `prove` exactly as in round 4.
- **Workaround:** the pin in `register(world)`, next to the contract's default.
- **Proposed shape:** let `implement` declare its slots with defaults (`slots: { opp: { default: 'policy.choose/first-empty' } }`), so the author of the model carries its pin.
- **Severity:** ergonomic only.
- **Evidence:** test `FRICTION: a pin belongs to the world…` (a four-line world: `DEPTH_LIMIT` before the pin, proof after it).
- **Hegel would say** a seat's determination belongs to the thing that has the seat, not to its surroundings; **Wittgenstein would say** the author of `mirror` knows what its model seat means, and the one who builds the world only needs to be told.

### N27. A path fill must land in the run, so one fill table cannot serve a whole tournament

- **Needed:** a tournament of seat pairs with a path key that reaches the model seat of X when X is `mirror`.
- **Kernel today:** the key is `BAD_FILL` in every run whose X is not a mirror (test `a path fill must land…`: `reached no call`), after the run. One table of fills would be right for the mirror matches and wrong for every other pairing of such a tournament. Flat slot keys are standing configuration and pass.
- **Workaround:** none needed so far: the tournament uses the flat seat keys of `fillFor` only; the path key lives in my own `match.opening` runs, where the seat is known to be a mirror.
- **Proposed shape:** let a table of fills carry a key as `optional` (a hint, silent if unreached), or let a drive or a tournament helper declare "landed somewhere in these N runs", as a drive already does across its ticks.
- **Severity:** ergonomic only.
- **Evidence:** test `a path fill must land…` (the same key lands with a mirror at X and is `BAD_FILL` with first-empty at X).
- **Hegel would say** the standing configuration is the true statement and each run a partial view of it, so landing should be asked of the table; **Wittgenstein would say** the question "did it land" is asked of one throw at a time, and a miss in a throw is a miss, which is why v0.5 chose the path.

## Workarounds removed, kept (round 6)

| | Round 5 | Round 6 |
|---|---|---|
| Steps that restate the game-on guard `ON` | 3 (`pickX`, `pickO`, `legal`) | **2** (`pickX`, `pickO`) |
| Guards kept only because of the `one` or `else` gaps | 2 (`when: ON` on `legal`; the typed `not(legal.accepted)`) | **0** |
| Typed complements | 1 (`not(legal.accepted)`) | **0** (`pickO` is `else(pickX)`, `forfeit` is `else(apply)`) |
| Named guard constants | 1 (`ON`; `CHOSEN` for `one`) | 1 (same) |
| Decision rows on a running ply, recorded / drawn | 6 / 5 | 6 / 4 (`legal` has no row; `after` has one) |
| Steps with a `when` of their own, out of seven | 6 (`pickX`, `pickO`, `legal`, `apply`, `record`, `forfeit`) | **5** (`pickX`, `pickO`, `apply`, `record`, `forfeit`; `legal` and `after` have none) |
| Trace scans that establish which call a fill reached or which rung chose it | 5 (tests: seat helper, nested impl scan in the path test, the O model scan in the flat-key test; render: `nested()` in the path and pin pictures) | **4**: one scan replaced outright by `fillReach` and `chosenBy` (the flat-key test); the others assert what ran (the implementation), which neither answers, so they stay, and four tests plus both render facts now also read `fillReach` or `chosenBy` |
| `allowUnusedFill` where `landing: 'none'` says what I mean | 0 | **0**. The single use (the typo test) stays: typos fail in every landing mode, so `landing` cannot say it |
| Per-pairing fill tables | 0 sweeps with a mirror (N27: avoided, the tournament had no mirror) | **0**: one table, `landing: 'none'` (a tournament with a mirror seat in it is new) |
| Examples with a name | 0 | **8** (`match.tick` six ticks, `match.play` ×2, `match.play/drive`, `match.positions`, `match.opening`, `mirror` ×2) |
| Tests | 69 | 72 |
| Pictures | 14 | 15 |

Removed in round 6: the `when: ON` on `legal`; the typed `not(legal.accepted)`; one trace scan.

Kept, with reasons:
- `ON` on `pickX` and `pickO`: the picks read nothing earlier. Tried without it on `pickO` (the variant that would make `pickO = else(pickX)` alone): `else(pickX)` is true when `pickX` was skipped by its *own* condition, and that includes a finished game, so `pickO` would run on a finished game;
- `CHOSEN` (the spec of a `one`), written once as a JavaScript constant;
- `match.opponent`, `match.append`, the tournament as a loop (now with `fill` and `landing` options), the memo in minimax, `nine-plies`, the imperative ply as a cross-check;
- the three `trace.calls…impl` scans that assert what ran, and the render script's `nested()`.

Tests flipped in round 6 (the four red tests):
- 32 `a finished game passes through its ply…`: kept the name; asserts seven rows on a finished game with one cause (the game-on test in a one-operand `and`), and on a live game the `ran` rows `pickX, apply, after, record` with no `legal` row;
- 63 `FRICTION: inheritance stops at a one binding: a one over two skipped picks is NO_BRANCH…` → `a one over two skipped picks skips the step that binds it, so legal needs no guard of its own`;
- 64 `FRICTION: else cannot tell a refusal from an outer exclusion…` → `else(apply) is false for an outer exclusion and true for a refusal: a finished game does not forfeit, a refused move does`;
- 67 `ctx.drive records how many ticks ran…`: kept the name; it asserted six rows by count; against the round 5 ply it counted seven (`after` is a row now), and after the ply rewrite it counts six again with a different set, so it now lists the six labels;
- also rewritten by the ply change: 30 (the forfeit decision is `else(apply)`) and 56 (two `ON`s, no `not`); test 1 now looks up two examples by name.
New tests: `one fill table across a tournament…` (N27, N28), `FRICTION: fillReach through a cache hit names the hit node…` (N30), `a named trajectory example is reported by name…` (N32); new assertions on `chosenBy` and `fillReach` in the seat-pin test, the path-fill test, the model-seat test and the flat-key test.

## New friction in round 6

Each point ends with the Hegel/Wittgenstein line.

### N28. Under `landing: 'none'` a mistyped slot inside a path is a key that landed nowhere, not a typo

- **Needed:** one table across a sweep (N27), with typos still caught.
- **Kernel today:** KERNEL.md says that in every mode a slot nobody declares or consults is `BAD_FILL`. That holds for flat keys (`policy.choose#Y`) and for unknown contracts (`policy.chose#X/…`). It does not hold for a slot name *inside a path*: `policy.choose#Y/policy.choose#opp` and `policy.choose#X/policy.choose#oppp` are `BAD_FILL` with the default landing and accepted with `landing: 'none'`. The run goes ahead, the mirror keeps its pinned model, and the receipt lists the key in `fillReach` with `[]`.
- **Workaround:** check the sweep afterwards: a key whose reach is empty in every game of the sweep is a typo (test `one fill table across a tournament…` does this with a nine-match sweep and a typo table).
- **Proposed shape:** validate the slot names inside a path against the declared slots whatever the landing, as for a flat key.
- **Severity:** distorts (a sweep with a mistyped model seat plays a different experiment and reports success).
- **Evidence:** the test above; sweep E15b and EXPLAIN E-68.
- **Hegel would say** a name that no seat has is not a determination that failed to apply but one that never was; **Wittgenstein would say** the sweep asked for laxity about where a rule applies, and a misspelt rule is not a rule that applies nowhere.

### N29. Inherited runs are recorded unevenly: a cause arrives in a one-operand `and`, and a step reached through a `one` leaves a row when skipped and none when it runs

- **Needed:** both sides of a condition leave the same rows (ROUND6.md).
- **Kernel today:** (a) a finished game's seven rows read `and(eq($in.status="X", "ongoing"))`: an `and` with one operand that nobody wrote, the wrapper of the inherited cause. (b) `legal` binds a `one` of the picks and has no guard: for a finished game it has a skipped row, for a live game it has no `ran` row, though `after` (which has no guard either, and reads `apply`) has one. The live ply records six decisions and the finished one seven.
- **Workaround:** none; I read the `ran` rows of `apply, after, record` and know that `legal` ran from its child.
- **Proposed shape:** unwrap a single-operand `and` in the recorded cause, and record `ran` for a step that reads a `one` when one of its alternatives ran.
- **Severity:** ergonomic only.
- **Evidence:** test `a finished game passes through its ply…` (seven against six rows); EXPLAIN E-61, E-63.
- **Hegel would say** a skip and a run are the two moments of one decision and should be recorded as one kind of fact; **Wittgenstein would say** the one-operand `and` is a word with nothing to join, which readers will take for a sign that something was lost.

### N30. A key's reach through a cache hit is the hit node, so a path key and its parent share ids

- **Needed:** `fillReach` as the answer to "which call did the path key land on" in a sweep with the cache on.
- **Kernel today:** in a tournament with `cache: true` the mirror-v-mirror match gets `policy.choose#X: [2,4,6]` and `policy.choose#X/policy.choose#opp: [2,4,6]`: the hits (as documented, "cache hits count as their hit node") are the whole mirror calls, so the path key appears to have reached the seat call itself. In a fresh world (no hits) it reads `#X: [4,24,44]`, `#X/opp: [5,25,45]`. My sweep test runs `cache: false` for that reason.
- **Workaround:** `cache: false` for tests that read the reach; `world.node(cachedFrom)` for a hit's inside.
- **Proposed shape:** for a hit, report the original's nested call ids with the run, as `cachedFrom` does.
- **Severity:** ergonomic only.
- **Evidence:** test `FRICTION: fillReach through a cache hit names the hit node…` (the same mirror-v-mirror match in a fresh world and after a warm-up sweep).
- **Hegel would say** the hit is the original in another place and its fills landed where the original's did; **Wittgenstein would say** the id names the box one can point at, which is why the hit counts.

### N31. View: two decision lanes sit 5 px apart, and `(not consulted)` covers both a typo and a legitimate miss

- **Needed:** tell two decision edges apart at 1x, and tell a typo from a seat that had no model.
- **Kernel today:** the merged `apply, after, record` row and the `forfeit` row run in two dotted lanes about 5 px apart (the output lanes are 15 px); at 1x they read as one thick dotted band, at 3x to 5x as two lanes both ending at `accepted` (E-69). In the sweep pictures the fill line marks `policy.choose#O/policy.choose#opp … (not consulted)` (a key the run had no seat for) and `policy.choose#X/policy.choose#oppp … (not consulted)` (a typo) the same way (E-68).
- **Workaround:** zoom; read the receipt.
- **Proposed shape:** the decision lanes on the output lane pitch; a different mark for a key whose slot names are all declared (`(no call reached it)`) and one that names an undeclared slot (`(undeclared slot)`), once N28 lets the typo through.
- **Severity:** ergonomic only.
- **Evidence:** ply and forfeit crops, sweep E15a and E15b.
- **Hegel would say** two things that are different should not be drawn as one band; **Wittgenstein would say** a picture that says the same thing for a mistake and for a choice has not said which one it is.

### N32. A failing trajectory reports every later tick as a failure of its own

- **Needed:** one line for one wrong tick.
- **Kernel today:** a `match.tick` implementation that never changes seat fails the six-tick example at tick 1; the detail lists ticks 1 to 5, each against the example's own state, though only tick 1 differs by itself (the later ones are consequences, and the detail ends with `(inputs …)` only when the tick had inputs beyond the state; mine has none). The name of the example and `tick 1` lead, which is the useful part.
- **Workaround:** read the first one.
- **Proposed shape:** feed the example's expected state to every tick (the contract is per tick), or stop at the first mismatch.
- **Severity:** ergonomic only.
- **Evidence:** test `a named trajectory example is reported by name…`.
- **Hegel would say** a later tick is judged against what it was given, not against what an earlier tick got wrong; **Wittgenstein would say** a report with five lines for one mistake counts the echoes.

## What fitted cleanly (rounds 1 to 6)

- Inheritance through `one` and `else` (seq 54): `legal` lost its guard, the forfeit is `else(apply)`, the finished game does not forfeit, and the ply restates `ON` on the two picks only.
- `chosenBy`: the pin, the contract fill and `#*` are read off the node (`by pin`, `by contract`, `by every-slot`) instead of inferred from which implementation won.
- `fillReach` on the receipt says which call each key reached, so the path-fill test no longer walks the trace for the reach.
- `landing: 'none'` and a `fill` option on the tournament: one table with the model paths of both seats.
- Names on examples: `prove` reports `first-empty mirror: X closes 2-4-6 on move seven`.

## What fitted cleanly (rounds 1 to 5, as written then)

- Inherited skips and `else`: the ply lost four guard constants and three restated guards, and a finished game now shows one cause on five rows (E-57); the guard of a step is written once, where the cause is.
- The `one` lint refuses overlapping seats at assembly with the step names in the message.
- Specificity-first fills: `policy.choose#*` and the pin make the model seat do what it says, `fillConsulted` and the printed fill line show it (E-54, E-55, E-56, E-59).
- Path fills must land: a typo in a path is no longer a quiet experiment.
- Temporal examples: the six states of the short match are one `trajectory` that `prove` checks tick by tick.
- Operand values and literal values in the tests' rows; wrapped long expressions; `stopped by until` for a nine-ply draw.

---

## Earlier friction (status in the tables above; the text is kept as written in each round)

## Earlier points: status after round 4 (the column says what changed since round 3)

| # | Point | Status | Evidence |
|---|---|---|---|
| 1 | Two seats need two implementations of one contract in one run | **Resolved** | Test `slots: two implementations of one contract in one run…`; ply picture box #5 `policy.choose#O`; opening #2 and #5 |
| 2 | Unknown fill keys silently ignored | **Resolved** | Tests `a slot NAME is validated: a fill for slot Z (or a lower-case x) fails with BAD_FILL` (was red test 89), `a drive validates its fill across all ticks…`, `an implementation that declares slots may call only those: UNDECLARED_SLOT…`. Caveat in N5 |
| 3 | Cache key had no fill, seed, or impurity | **Resolved** | Cache tests (unchanged, green); cache-trap E5a, E5c (claims E-16, E-17) |
| 4 | A tournament is a run of runs; a receipt is not a Part | **Partly resolved** (round 4: a branch is now faithful) | A drive now has a recorded fold and a branch: test `a game can be branched from a recorded position: world.ref links…` (a game continues from `world.ref(run, 1, 'state')`, picture branch E7a-c). Round 4: `startTick` makes a branch continue the original clock, so the same seats and seed replay the original continuation exactly (test `startTick: a branch continues the clock…`; picture branch E-49, ticks numbered 4, 5, 6). The tournament is still a JavaScript loop over `world.run`; a receipt has no id; nothing hashes fill plus seed |
| 5 | Composition: no conditional, no loop, no array builder | **Partly resolved** (round 4: the conditional is complete) | Conditional: resolved by `when`/`first`. Tests `a finished game passes through its ply…`, `the forfeit status reads back to the check…`; pictures ply (E-32, E-33), passthrough (E-35), forfeit (E-36). Array builder: resolved by `{concat}`/`ctx.concat` in `match.append` (E-21). Loop: still open in a composition (`match.play/nine-plies` is nine fixed plies); inside an implementation `ctx.drive` replaced the hand loop (picture trace-short, E-30). Round 4 closed the limits of the conditional: nesting by `and` (test `a conditional nests through and()…`, was N2), booleans by `not`/`and`/`eq` (no helper contract, was N1), a skipped piece skips its gather (test `a skipped value inside a gather or concat skips the alternative…`, was N3 and red test 162). The loop is still open in a composition (`match.play/nine-plies` is nine fixed plies); the new costs are N14 and N15 |
| 6 | `uses` over-reported `unusedDependency` | **Resolved** | No such note in any picture (E-6) |
| 7 | Identical code under three ids shared no cache entries | **Resolved** | Test `cache: an entry made with no slot serves a call in slot X` |
| 8 | Replay forces the cache off | **Partly resolved** (unchanged in round 4) | `replay(receipt, { maxCalls })` exists. Test `a search that leans on the kernel cache runs, and replay(receipt, { maxCalls }) can now re-run it cache-off`: the corner-stone position is 12,908 calls with the cache and replays exactly in 211,087 calls with `maxCalls: 250000` (8 s); `maxCalls: 100000` fails with `CALL_LIMIT`. Replay is still cache-off, so a search that leans on the cache replays at 16 times the cost. Minimax keeps its per-invocation memo (see "Workarounds") |
| 9 | Slots: names unchecked, no per-slot default, examples cannot seat | **Resolved** | Names: test above. Per-slot default: test `select takes a slot and examples carry fill…` (`select('policy.choose', impl, 'O')`; order checked: slot fill, contract fill, slot select, contract select). Examples with seats: `match.play` example 1, `match.opening` example 1, `match.tick` example 1 (six ticks, seated by `fill`), all proven in test `every contract example proves…`. Slots declared in `uses`: `match.move/imperative` lists `policy.choose#X` and `#O`; the composition steps declare them for `match.move/declared` and `match.opening/two-plies` |
| 10 | A cached ancestor hides its subtree | **Resolved** (round 4: cache hits also carry their decisions, claim E-46) | (a) the trace: test `with the cache on, a repeated prefix is hollow in the raw trace, and world.node(cachedFrom) fills it in: movesOf with expand is complete` (every move of 24 matches, in slot order, right policy, each with its audit); pictures ghost (E-38), boards row G (E-39), cache-trap E5b/E5c (E-40). (b) which policy sat in slot X: read from the original node, `JSON.stringify(original)` contains `"slot":"X","impl":"policy.choose/first-empty"`; the hit node itself still has no `deps`, but the kernel guarantees the original resolved the same way. (c) `receipt.verdicts` (was red test 118): test `receipt.verdicts includes the audits inside a cached subtree, marked cached with their origin` (7 verdicts for 7 moves, the first marked `cached` from run 1). Cost N9 is gone in v0.4: `world.node` is indexed, and the hollow-trace test now expands all four policies including minimax in 1.7 seconds (round 3: 153 seconds, so minimax was left out) |
| 11 | A forfeit decided by a check has no provenance back to the check | **Resolved** in the declared ply, **Partly resolved** in imperative code | Declared: test `the forfeit status reads back to the check that refused the move…`, picture forfeit E8 (E-36): status ← `match.opponent` #23, guarded by `not(#21.accepted)` read from the check, no `logic.not`. Imperative: the decisions now carry the operands (`eq($in.player, 1)`, `#20.accepted`, E-50) but the status stays `computed`, no bracket |
| 12 | A check guards a calculation but nothing says so | **Open** (unchanged in round 4; note, one use) | In `match.move/declared` the guard is now explicit (`apply`, `after`, `record` run `when: legal.accepted`), and the skipped steps leave decision rows (E-33). But `game.apply` still throws on an occupied cell when called from anywhere else (test `game.apply places a mark, refuses an occupied cell…`), and nothing makes a second caller go through the check |
| 13 | A driven match and a run match of the same seed diverge | **Open**, in a new form (unchanged in round 4; `startTick` fixed the other half: a branch of a `world.drive` now draws the same cells as the original) | Test `FRICTION: ctx.drive draws every tick from the run's one random stream, world.drive seeds each tick [seed, k]: the same seed plays two different games`: at least 10 of 12 seeds differ between `match.play/drive` (inside one run) and `driveMatch` (across runs). Each is separately reproducible. With deterministic seats they agree (test `drive: the same match, one tick per ply, ends in the same state as match.play`) |
| 14 | Appending to a list re-gathers the whole list each time | **Partly resolved** (unchanged in round 4) | `ctx.concat` makes it one call and one line (`match.append`, E-21, test `match.play outputs the move list… through match.append (ctx.concat)`). The output still has k pieces for k moves, so the box shows k `←[i]` labels; nothing says "the list with one more element" |

## Workarounds removed, kept (round 4)

Helper contracts and lines on the ply path, before and after:

| | Round 3 | Round 4 |
|---|---|---|
| Helper contracts that only emit a boolean | 3: `match.live`, `match.seat`, `logic.not` | **0** |
| Contract that existed only to change a `when` scope | 1: `match.move` (with `match.move/declared`, `match.move/imperative`) | **0** |
| Helper contracts that build a value | 2: `match.opponent`, `match.append` | 2 (kept) |
| Contracts on the ply path in all (helpers + move) | 6 | 2 |
| Implementations on the ply path (helpers, `match.move/*`, `match.ply/branch`) | 8 | 4 (`match.opponent/other`, `match.append/concat`, `match.ply/declared`, `match.ply/imperative`) |
| Source lines for them (contracts, implementations, compositions, without examples) | about 71 | about 37 |
| Boxes in one drawn ply | 12 | 8 |
| Calls per tick, short match | 13 per tick, 79 in all | 9 per tick, 55 in all |

Removed:
- `logic.not` (contract, implementation, three examples): `{ not: ['legal.accepted'] }` in the guard of `forfeit`;
- `match.live`: `{ eq: ['$in.status', { literal: 'ongoing' }] }`;
- `match.seat`: `{ eq: ['$in.player', 1] }` and `2`;
- `match.move` and its two implementations, and the second composition layer: one composition `match.ply/declared`, the nested guards by `and` (`SEAT_X`, `LEGAL`, `REFUSED`);
- `first: ['pickX.cell', 'pickO.cell']`: `{ one: [...] }`, the two seats are exclusive and the kernel now says so if they were not (test `one: … AMBIGUOUS_BRANCH`);
- the trap around a skipped value in a gather: no longer worked around (the old `match.append` contract was kept for another reason, below);
- the restriction of the hollow-trace test to three policies (N9): all four, 1.7 seconds;
- the clock-restart in `branchDrive`: `startTick: k + 1`;
- the hand-built per-ply trail one would need for the position list: `match.positions` by `collect`.

Kept, with reasons:
- `match.opponent` and `match.append`: they are not boolean helpers, they build a value (the winner's mark; the list with one more element) inside a branch, and a step under `when` is the only way a composition has to compute a value. A mark table lookup (`MARK[3 - player]`) or a `concat` has no spec form;
- the tournament as a JavaScript loop (point 4);
- the per-invocation memo inside `policy.choose/minimax` (point 8; replay is still cache-off);
- `match.opening/two-plies` ends in a `gather` of two `gather`s, not `concat`;
- nine fixed plies in `match.play/nine-plies` (a composition still has no loop; the idle plies are now single childless boxes);
- `cache: false` in the comparison tests;
- `match.ply/imperative` next to `match.ply/declared`: the cross-check (test `the two ply implementations … play identical games`) and the only form with named branches (`ctx.when(..., { true: 'apply', false: 'forfeit' })`);
- `fill: { 'policy.choose#opp': … }` on the five examples of `policy.choose` and of `mirror` itself: workaround for N13.

Tests flipped (scenario kept, name says what now holds):
- `FRICTION: a conditional cannot be nested…` → `a conditional nests through and(): the inner step reads steps guarded by the outer condition (round 3: ASSEMBLY_LINT, so one ply was two contracts)`;
- `FRICTION: a skipped value inside a gather or concat passes the assembly lint and fails at run time with a symbol` (red test 162) → `a skipped value inside a gather or concat skips the alternative, and first falls through (round 3: passed the lint, failed at run time with a symbol)`;
- `FRICTION: ctx.drive stops on a function of the outputs…` → `ctx.drive records how many ticks ran and why it stopped (node.drives); the stop is not a decision row (round 3: not recorded at all)`;
- `the two match.move implementations … play identical games` → `the two ply implementations (declared composition, imperative ctx.when) play identical games`;
- `the forfeit status reads back to the check…` kept and rewritten: the imperative half now asserts test operands where round 3 asserted `computed`;
- the hollow-trace test: minimax back in.

## Round 3 new friction: status after round 4

| # | Point | Status | Evidence |
|---|---|---|---|
| N1 | A branch needs a boolean made by a step | **Resolved** (seq 34) | `not`/`and`/`eq` in `when`; no `logic.not`, `match.live`, `match.seat`; ply picture E-42, E-43. Cost: N14, N15 |
| N2 | A conditional cannot be nested | **Resolved** (seq 36) | test `a conditional nests through and()…`; one composition, decision rows in one box |
| N3 | A skipped value inside a gather breaks at run time | **Resolved** (seq 36) | test `a skipped value inside a gather or concat skips the alternative…` (was red 162) |
| N4 | `ctx.when` on a plain boolean records nothing about where it came from | **Resolved** | `ctx.when({ eq: [player, 1] }, …)` records `eq($in.player, 1)` with an amber edge (E-50). The status of the imperative forfeit is still `computed`, as before |
| N5 | A slot declaration is world-wide | **Open**, and now also for paths | test `FRICTION: a slot declaration is world-wide…` and N19 |
| N6 | The declared form costs more than the imperative form | **Mostly resolved** | declared ply: seven steps and five guard constants, 18 lines; imperative: 13 lines. The gap is now the repeated guard (N14), no longer helper contracts |
| N7 | `ctx.drive` stop not recorded | **Resolved**, with a flaw | `node.drives` and the `⟳` row (E-44). The flaw is N16 |
| N8 | One random stream per run, one per tick across runs | **Open** | unchanged; the FRICTION test of point 13 still passes |
| N9 | `world.node` scans | **Resolved** (seq 40) | hollow-trace test, all four policies, 1.7 s (153 s with minimax in round 3) |
| N10 | View: decision row names a call that is not drawn; tick tag repeats | **Partly resolved** | the `← run r #c` and `⟳` rows are good; trace-short (depth 2) still prints `#6.accepted` where #6 is not drawn, now inside a test expression (N17) |
| N11 | `examples: undefined` throws | **Resolved** | not reproduced; `index.mjs` still omits the key |
| N12 | The tick dependency did not matter | **Unchanged** | still no entry reads the clock; `startTick` in the branch changed only the random draws (and made them agree) |

## New friction in round 3 (kept for the record; status above)

Each point ends with the Hegel/Wittgenstein line: what a concept that contains its own other would want, against what the use in this domain shows.

### N1. A branch needs a boolean made by a step: not, and every other connective, is a contract

- **Needed:** `forfeit` runs when the check said no; `apply` when it said yes.
- **Kernel today:** `when` reads one boolean spec. The negation of `legal.accepted` had to be a step, `logic.not` (a contract, an implementation, three examples), and any `and`/`or` would be one more contract each. The ply has five tiny helper contracts (`match.live`, `match.seat`, `logic.not`, `match.opponent`, `match.append`) next to four real ones.
- **Workaround:** the helper contracts; the imperative `match.move/imperative` does the same in six lines.
- **Proposed shape:** `when: { not: spec }` and `{ all: [spec, …] }`, `{ any: […] }` in the composition language, with the decision row naming the operator, or `{ is: [spec, value] }` for a comparison (see N4).
- **Severity:** ergonomic only.
- **Evidence:** `index.mjs`, `logic.not/1`; ply picture box #9.
- **Hegel would say** a condition and its negation are one concept and should be declared as one step; **Wittgenstein would say** the use shows a negation is always read off the same output, so a connective on a spec is enough: no step, no node.

### N2. A conditional cannot be nested, so one ply is two contracts

- **Needed:** one declared ply: if the game is on, choose; if the choice is legal, apply; otherwise forfeit.
- **Kernel today:** a step may read the output of a conditional step only inside `first` or in a step with the identical `when`. `apply` is `when: legal.accepted`, and `legal` would be inside `when: seat.x`, so the lint rejects it. The workaround split the ply into `match.ply` (is the game on) and `match.move` (what did the check say), a contract boundary that exists only to change the `when` scope.
- **Workaround:** `match.ply/branch` over `match.move/declared`; every ply is a composition node plus a move node.
- **Proposed shape:** a conditional region, `{ when: spec, steps: […], returns: … }`, whose inner steps may carry their own `when`; or let `when` read an output of a conditional step when its own condition implies the outer one.
- **Severity:** ergonomic only; it adds nodes, not wrongness.
- **Evidence:** test `FRICTION: a conditional cannot be nested…` (the lint message is quoted in the assertion); ply picture (two decision levels: #1 and #3).
- **Hegel would say** the inner choice is a moment of the outer one and belongs inside it; **Wittgenstein would say** the two levels are used separately (the ply decision is reused by the drive and the composition, the move decision never leaves the move), so two contracts are no loss. I think the use sides with Hegel here: nobody calls `match.move` alone except tests.

### N3. A skipped value inside a gather or concat passes the lint and breaks at run time

- **Needed:** `record` (append the move to the list) only on the accepted path.
- **Kernel today:** I wrote the append as `{ first: [ { concat: ['$in.moves', { gather: [{ gather: { cell: 'pickO.cell' } }] }] }, '$in.moves' ] }`. It assembles. For player 1 the O pick is skipped and the run fails with `NOT_JSON gather.cell is not JSON (symbol)`. The skip marker is a symbol and a gather swallows it. `first` can skip an alternative only when that alternative is a bare reference.
- **Workaround:** `match.append` as a contract, itself skipped as a whole by `when`.
- **Proposed shape:** either the lint rejects a conditional reference inside `gather`/`concat`/`at` in any alternative, or a skipped reference makes the enclosing alternative skipped.
- **Severity:** distorts (a trap: the failure names a symbol, not the step).
- **Evidence:** test `FRICTION: a skipped value inside a gather or concat passes the assembly lint and fails at run time with a symbol`.
- **Hegel would say** a value built from a thing that did not happen did not happen either; **Wittgenstein would say** the word "skipped" is used for steps, not for pieces of a value, so the kernel should refuse the sentence at assembly instead of failing in the middle of it.

### N4. `ctx.when` on a plain boolean records nothing about where it came from

- **Needed:** the imperative move picks its slot by `player === 1` and I wanted the decision explained.
- **Kernel today:** `ctx.when(player.value === 1, 'X is to move')` records the decision, with provenance `computed` (E-37: `read computed`, no amber edge). The boolean from `verdict.accepted` has provenance because a check made it. A comparison on a Ref has none; the only route to one is a contract call (N1's `match.seat`).
- **Workaround:** none in imperative code; `match.seat` in the declared one.
- **Proposed shape:** `ctx.is(ref, test)` returning a boolean Ref with `from: { kind: 'test', of: ref.from, op }` (and the same `{ is: … }` in compositions).
- **Severity:** distorts the trace (a decision whose reason cannot be drawn).
- **Evidence:** test `the forfeit status reads back to the check…` (second half: `from: { kind: 'computed' }`); forfeit E8b.
- **Hegel would say** a decision that cannot say what decided it is not a decision yet; **Wittgenstein would say** "player is 1" is a use of the input, so it should be an `at`-like path with an operator, not an act of the implementation's private JavaScript.

### N5. A slot declaration is world-wide, not per reachable call

- **Needed:** a fill for `policy.choose#X` should be refused where nothing can reach `policy.choose`.
- **Kernel today:** the declared-slot set belongs to the world. A run of `game.legalMoves` with `fill: { 'policy.choose#X': … }` is accepted because some other implementation declares `#X`; only a name nobody declares (`#W`) fails. Typos are caught, misdirected fills are not.
- **Workaround:** none needed so far; `fillFor` generates the keys.
- **Proposed shape:** check a fill key against the slots declared in the implementations reachable from the contract being run (`uses` closure, including composition steps), at assembly.
- **Severity:** ergonomic only.
- **Evidence:** test `FRICTION: a slot declaration is world-wide…`.
- **Hegel would say** a fill means something only in the whole it fills, and the whole is the call graph under this run; **Wittgenstein would say** the typo check already catches what is actually mistyped, and a reachability check would reject the standing tournament fill on the one-tick drive. v0.3's first draft did exactly that and broke my drive tests, so the world-wide rule is the usable one. I side with Wittgenstein for runs and Hegel for drives only if a drive's reachable set is the union over ticks.

### N6. The declared form costs nine steps and five contracts where the imperative form costs six lines

- **Needed:** to decide which form to ship.
- **Kernel today:** `match.move/declared` is nine steps, three of them to produce booleans or small values the imperative form gets free (`seat`, `refused`, `forfeit`), and it draws a trace in which every branch (also the skipped ones) is a row. `match.move/imperative` is six lines, shows two decisions, loses the dependence of the status on the check. Both are proven and agree.
- **Workaround:** both are registered; the declared one is the default.
- **Proposed shape:** none by itself; N1 to N4 are what would make the declared form shorter.
- **Severity:** ergonomic only.
- **Evidence:** `index.mjs`; test `the two match.move implementations … play identical games`; ply picture against forfeit E8b.
- **Hegel would say** both forms are the same concept seen from two sides and the kernel should be able to read one from the other; **Wittgenstein would say** the use differs: the declared one is for the reader of the trace, the imperative one for the writer of the code, and the kernel's job is only to make the second record enough that the first is not needed.

### N7. `ctx.drive` stops by a function and does not record why

- **Needed:** the match drive node should say it stopped because the status was no longer `ongoing`.
- **Kernel today:** `until: (out) => out.status !== 'ongoing'` is plain JavaScript. The `match.play/drive` node has no `decisions`, while each ply has one (test `FRICTION: ctx.drive stops on a function of the outputs…`). The picture shows six ticks and nothing about the seventh that did not happen.
- **Workaround:** none; the last tick's `status` is `"O"`, which a reader can compare with the earlier `ongoing`.
- **Proposed shape:** `until` as a boolean port of the tick (`out.done`) read through `ctx.when`, or the drive records `{ label: 'until', value, from }` on the node after every tick.
- **Severity:** ergonomic only.
- **Evidence:** the test; trace-short (no decision row on #1).
- **Hegel would say** ending is a moment of the fold and part of its content; **Wittgenstein would say** a stop is shown by the last tick, and nobody asked why in this domain, but the other branches all show their reason, so this one is the odd one out.

### N8. One random stream per run, one per tick across runs

- Point 13 in a new form. `ctx.drive` inside a run draws from the run's single stream; `world.drive` seeds tick k with `[seed, k]`. The same seed gives two games (12 seeds tested). Hegel would say a seed is the identity of a game and should not depend on how the fold is staged; Wittgenstein would say the two staging are different uses, so a seed means "this run" or "this tick" and the receipt already says which. Proposed: record on the receipt which scheme drew (`randomScheme: 'run' | 'tick'`), or let `ctx.drive` seed tick k with `[seed, k]` as well so the two agree. Severity ergonomic. Evidence: the FRICTION test of point 13.

### N9. `world.node` scans the trace; reading through hits across a tournament is quadratic

- **Needed:** draw or check every move of every match through its cache hits.
- **Kernel today:** `world.node(run, call)` finds the run by `runs.find` and the call by walking the whole recorded trace. My first version of the hollow-trace test expanded 65 matches including minimax traces of about 26 thousand nodes each and took 153 seconds; restricted to the three cheap policies it takes 0.15 seconds. Nothing is wrong; it is a cost the test file had to design around (the test says why minimax is left out).
- **Workaround:** the test leaves minimax out and checks one minimax match separately (test `the trace shows which policy made which move, including cached minimax moves`, which passes with `expand`).
- **Proposed shape:** an index from `(run, call)` to node built when a run is recorded.
- **Severity:** ergonomic only.
- **Evidence:** the test (see its comment).
- **Hegel would say** a hit and its original are one thing and the reference between them should be a pointer, not a search; **Wittgenstein would say** a reference you can only follow by looking for it is a description, not a reference.

### N10. View: a decision row can name a call that is not drawn; the tick tag and the kind tag repeat each other

- Trace-short at depth 2 prints `read #4.live` on every ply, but box #4 is hidden, so no amber edge starts anywhere and the reader sees a pointer to nothing. Suggested: print `read #4.live (not drawn)` when the source is collapsed, or draw a stub. The tick box header says `@0` in amber and `tick` in purple. Severity: ergonomic. Evidence: trace-short, plies #3 … #68; EXPLAIN History. Hegel/Wittgenstein: not applicable, it is a drawing detail.

### N11. `implement` with `examples: undefined` throws a `TypeError` in `prove`

- Passing `examples: undefined` (a policy that has none) overrides the default `[]` through the spread in `implement`, and `prove` then fails with `Cannot read properties of undefined (reading 'map')`. I worked around it by not passing the key. Proposed: default after the spread. Severity: ergonomic only. Evidence: the first `prove` run in round 3 (`index.mjs` now builds the field only when examples exist).

### N12. The tick dependency did not matter, and that is information

- `ctx.tick()` is never read by `match.tick/ply`, so no entry depends on the tick: a position reached at another tick index would be a hit. Ticks of G's match hit run 1's tick `@0` (ghost picture, E-38) because both were at tick 0 and, separately, because nothing reads the clock. I have no case where the tick index changes the answer, so I did not exercise the dependency. Hegel would say the tick is a moment of every call; Wittgenstein would say it is a moment only for calls that read it, which is what v0.3 does. The result fits this domain: a position's value does not depend on when it is reached.

## New friction in round 4

Each point ends with the Hegel/Wittgenstein line. The first five are about the new concepts themselves: tests (N14, N15), `one` (N20), path slots (N13, N19), `collect` (N18); N16 and N17 are a flaw and a view defect.

### N13. A contract-level fill reaches into a slot that has a default, so a policy that models its opponent through a slot recurses

- **Needed:** `mirror`, a policy that decides by asking `policy.choose#opp` what its opponent would do. A model of the opponent is exactly what a slot is for.
- **Kernel today:** the order is slot fill, contract fill, slot select, contract select. `prove` fills the contract `policy.choose` with the implementation under test, and so does any caller who fills `policy.choose` without a slot. The nested call in slot `opp` finds no slot fill, finds the contract fill, and calls the implementation under test again: `DEPTH_LIMIT: call depth exceeds 256`.
- **Workaround:** `fill: { 'policy.choose#opp': 'policy.choose/first-empty' }` on the five contract examples and on `mirror`'s own examples; a comment says why.
- **Proposed shape:** a contract fill applies to calls with no slot only; to reach every slot say so (`policy.choose#*`). Or let a slot's own `select` beat the contract fill.
- **Severity:** distorts (the failure is a depth limit three calls away from the cause).
- **Evidence:** test `FRICTION: a policy that models its opponent through a slot is seated in its own model by the contract fill…` (`mirror-naive`: `prove` fails with `DEPTH_LIMIT`, and so does a run with a contract fill).
- **Hegel would say** the opponent in the model is another instance of the concept, not the same one, and should not inherit the seat; **Wittgenstein would say** a contract fill reads "use this wherever the word is used", and that is what it did. The use here wants two words (the seat, the model), which is what a slot is, so the precedence rule is the part that is wrong.

### N14. Every step repeats the guard; nesting is by `and`, not by a region

- **Needed:** the ply's steps all live only while the game is on.
- **Kernel today:** a step may read steps guarded by `A` only if its own guard is `{and: [A, …]}`. So `ON` is written inside the guard of all seven steps (`SEAT_X`, `SEAT_O`, `ON`, `LEGAL`, `REFUSED`), and the decision rows print `and(eq($in.status, literal), …)` seven times (merged into five, but only where the expressions are identical).
- **Workaround:** JavaScript constants (`ON`, `LEGAL`, …) built outside the composition.
- **Proposed shape:** the region of N2 after all, now that the rule is understood: `{ when: ON, steps: [...] }`, the inner steps implicitly under `and(ON, …)`; the row would read once.
- **Severity:** ergonomic only.
- **Evidence:** `index.mjs` (`match.ply/declared`); ply picture E-43.
- **Hegel would say** the outer condition is the context of the inner steps and should be written once as the context; **Wittgenstein would say** the repetition is the proof of use: each step is checked against the guard, and a region would hide that a step quietly stopped needing it. The constants in my file already make the repetition one word, so the cost is in the picture, not the code.

### N15. A string literal operand in a composition test loses its value in the provenance

- **Needed:** the guard row should say `eq(status, "ongoing")`.
- **Kernel today:** `{ eq: ['$in.status', { literal: 'ongoing' }] }` records `{ kind: 'literal' }` with no `value`; the row prints `eq($in.status, literal)`. A bare number (`{ eq: ['$in.player', 1] }`) keeps its value, and so does a string given to `ctx.when({ eq: [status, 'ongoing'] })` in imperative code (E-50 reads `eq($in.status, "ongoing")`).
- **Workaround:** none; the reader looks at the title of the step.
- **Proposed shape:** record the value of every literal operand, as the imperative form already does.
- **Severity:** distorts the trace (the most important operand of the most important guard is a blank).
- **Evidence:** ply picture E-43; test `the forfeit status reads back to the check…` reads both forms.
- **Hegel would say** a comparison with an unnamed operand compares nothing; **Wittgenstein would say** the string is in the assembly, in plain sight, and the record of the run should be able to say what the assembly said.

### N16. `node.drives` says `maxTicks` when `until` held on the last allowed tick

- **Needed:** the nine-ply draw should say it stopped because the game was over.
- **Kernel today:** `kernel.mjs` sets `stopped = 'maxTicks'` whenever `n === max && opts.ticks === undefined`, after the `until` branch has set `'until'`. A full board (nine plies, `maxTicks: 9`, the true bound of the game) reports `maxTicks`; the same drive with `maxTicks: 10` reports `until`. Every drawn game in the tournament is misreported.
- **Workaround:** the entry's tests assert the tick count for draws and the stop reason only for games that end earlier; one FRICTION test pins the behaviour.
- **Proposed shape:** let `until` win when both hold, or record both (`stopped: 'until', atLimit: true`).
- **Severity:** distorts (a safety bound, set to the exact length of the domain, reads as a failure).
- **Evidence:** test `FRICTION: when until holds on the very tick that exhausts maxTicks…`; ghost and positions pictures (E-44).
- **Hegel would say** a stop that is both the end of the game and the end of the bound is the end of the game; the bound is only the form it took. **Wittgenstein would say** the record answers "did the limit fire?" and the limit and the condition coincided, so two yes answers is the honest report, and the single word is the flaw.

### N17. View: decision-row text is cut at the right edge of the image, and rows still name boxes that are not drawn

- **Needed:** read a guard expression at the box where it is decided.
- **Kernel today:** where the ply box sits left and the image ends just to the right of its children (branch E7c, cache-trap E5a), `eq($in.player, 1))` is cut to `eq($in.play` and `not(#263.accepted))` to `not(#263.ac`. Elsewhere the same text overflows the box border and is drawn through the edges. At depth 2 the rows name `#6.accepted` where #6 is not drawn.
- **Workaround:** none in the entry (the pictures are the kernel's).
- **Proposed shape:** wrap a test expression like any other row; size the image from the widest row.
- **Severity:** ergonomic only.
- **Evidence:** EXPLAIN E-52, trace-short, branch, cache-trap.
- **Hegel would say** a thing that is not shown in full is not shown; **Wittgenstein would say** a picture whose rows cannot be read is a rule you cannot follow.

### N18. `collect` hands back a Ref whose length you can only learn by reading its value, and the output labels do not say which tick an element came from

- **Needed:** `match.positions`: the board after every ply.
- **Kernel today:** `collect: ['state']` returns one gathered Ref. To take `board` of every element I wrote `ctx.gather(collected.state.value.map((_, i) => ctx.at(collected.state, i, 'board')))`: the number of elements is read from the value, outside the provenance. The result is right (nine `at` paths, each rooted in the gather whose pieces point at the tick calls, test `match.positions: ctx.drive with collect…`) and the picture draws nine dashed edges to nine ticks, but the output row prints `pieces ×9` nine times (E-48).
- **Workaround:** the `.value.map`.
- **Proposed shape:** a wildcard path (`ctx.at(collected.state, '*', 'board')`) that produces the nine paths with a label per element reading `← tick k`.
- **Severity:** ergonomic only (the provenance is right; reading and writing it are clumsy).
- **Evidence:** `match.positions/drive`; positions picture.
- **Hegel would say** the whole and its parts are one thing and a Ref of nine should know it is nine and where each came from; **Wittgenstein would say** "every board" is a use that today needs a loop in the implementation, and a path with a star names the loop in the data.

### N19. A path fill is checked by its names, not by what the call graph reaches

- **Needed:** a path fill `'policy.choose#X/policy.choose#opp'` should be refused when X's implementation has no `opp` slot.
- **Kernel today:** only names are checked (`#Y` fails with `BAD_FILL`, as in N5). With `first-empty` in seat X the key is accepted, reaches nothing, and is printed in the receipt as part of the fill.
- **Workaround:** `fillFor` and one path key built together in the test.
- **Proposed shape:** as in N5, check a fill against the slots reachable from the contract being run, or mark in the receipt which keys were used.
- **Severity:** ergonomic only.
- **Evidence:** test `FRICTION: a path fill is checked by the names on it…`.
- **Hegel would say** a fill that is never reached is not a fill; **Wittgenstein would say** a receipt that lists a key as part of the run says that it was used.

### N20. `one` is a runtime check on what the tests could prove

- **Needed:** the two seats are exclusive by `eq($in.player, 1)` and `eq($in.player, 2)`.
- **Kernel today:** `{ one: [...] }` fails with `AMBIGUOUS_BRANCH` when two alternatives are live, found at run time on the run that overlaps (test `one: …`); the kernel could see at assembly that `and(ON, eq(p, 1))` and `and(ON, eq(p, 2))` exclude each other. It also has to be named once in a constant (`CHOSEN`) and repeated by reference in four steps; and `first` stays for the outputs where fall-through is the point (`first: ['apply.board', '$in.board']`), so the composition now has two words for two things.
- **Workaround:** none needed; the run-time check is enough for tic-tac-toe.
- **Proposed shape:** at assembly, prove exclusion of `eq` tests on one input with different literals, and say `one: proven exclusive` in the lint; allow naming a spec once in the composition.
- **Severity:** ergonomic only.
- **Evidence:** test `one: exactly one seat is live…`; `index.mjs` (`CHOSEN`).
- **Hegel would say** exclusion is a relation between the tests, and a relation should be seen before it is lived; **Wittgenstein would say** nobody ever asked the question before the overlap happened, so the run-time check is the whole use.

### N21. A test row names operands but not their values

- **Needed:** to see why `pickX = false` for a ply with player 2.
- **Kernel today:** the row says `and(eq($in.status, literal), eq($in.player, 1))`; the value of `$in.player` is on the input row above, not in the expression, and the intermediate truth of each operand is not shown (the first `eq` was true, the second false).
- **Workaround:** read the input rows.
- **Proposed shape:** print the evaluated operands under the expression, or annotate the first false operand of an `and`.
- **Severity:** ergonomic only.
- **Evidence:** ply picture, `pickX` row.
- **Hegel would say** a judgement that does not show its steps is not mediated; **Wittgenstein would say** the answer is on the line above, and a rule explained twice is read twice.

## What fitted cleanly (rounds 1 to 4)

- Relational tests, `not`, `and`, `eq`: all the helper contracts in the ply went away and the trace got shorter and more legible (E-42, E-43); operand provenance on the guard rows reads straight from the check.
- Nesting by `and`: one composition for the whole ply; the nested forfeit reads the check without a second contract layer.
- `one` found no overlap in 65 matches and the AMBIGUOUS_BRANCH test shows it would have.
- Path slots: a mirror policy seated differently in each model with one run and one key; the cache stayed correct across the two fills (test `path fills: …`); a mistyped slot in a path is `BAD_FILL`.
- `collect`: a position list from one drive, every element pointing at its tick, with no trail kept in the state.
- `startTick`: a random branch replays the original continuation exactly (test `startTick: …`).
- `node.drives` and the `⟳` row (flaw N16 aside); cache hits carry decisions; indexed `world.node`.
- Contracts, ports, schemas for the game; `prove` runs 55 proofs over the library (58 in round 3, three helper contracts fewer, their examples gone with them); slots; `when`/`first`; deps-validated cache; `ctx.drive`; `world.ref`; the check and `receipt.verdicts`; replay with `maxCalls`; the assembly lint.
