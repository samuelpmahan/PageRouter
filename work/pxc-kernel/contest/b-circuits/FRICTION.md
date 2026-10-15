# Contest B · friction report (digital logic, sequential counter): status after migration to kernel v0.6

Numbers: one `counter.tick` is 138 trace nodes (76 NANDs). `counter.run` over 20 ticks is 2761 nodes with cache off, 246 with cache on (facts file). `adder.ripple8` is 120 NANDs. A gated tick is 138 nodes when the clock is high and 1 node when it is low.
Test names refer to `test/contest-b-circuits.test.mjs`. File lines refer to `contest/b-circuits/index.mjs` unless stated. PNG names are in `verify/out/` with the `b-circuits-` prefix; claims and verdicts for each are in `EXPLAIN.md` (B-n).
Suite (end of round 6): my file 41/41 green. Full suite: 294 tests, 287 pass, 7 fail (seven reds in other entries' tests, numbers 56 59 151 182 183 186 205; none is in my file). Round 5 for comparison: my file 41/41, full suite 274 tests, 263 pass, 11 fail. The 11 reds are the other entries' round 5 red tests listed in ROUND5.md (C 3, E 7, F 1; test numbers 57 58 62 134 145 169 171 173 175 178 210), each asserting what v0.5 changed; none is in my file.

## 00. Round 5: what v0.5 removed from my entry (counts, before = my round 4 files, after = now)

| | Round 4 | Round 5 |
|---|---|---|
| Restated guards (steps carrying a `when` that only repeats another step's guard) | 5 steps with `when: clkHigh` in `counter.tick/gated` | 1 (`inc`); the four flops read `inc.sum`, so they inherit its skip (test `counter.tick/gated...`: `steps.filter(s => s.when)` is `['inc']`) |
| Typed complements | 1: `takeA` had `when: { eq: ['$in.select', 0] }` next to `takeB`'s `eq select 1` | 0: `takeA` is `{ else: ['takeB'] }`; its decision's provenance names `takeB` and its test |
| Pins or fills that existed only to dodge precedence | 0 | 0. None existed in this domain: `world.select('gate.mux', ...)` and `world.select('counter.tick', ...)` are defaults, not pins against a sweep |
| Hand-kept trajectories outside `prove` | 2 arrays of 7 states (`STAGGERED`, `LOCKSTEP`) in the test, plus a hand-copied oscillation property | 0: they are `trajectory` examples on the two implementations; the test reads them back (`trajectoryOf`) and compares them with what `world.drive` recorded |
| Latch proofs run by `prove('latch.sr')` | 11 (4 + 4 + 3) | 13 (4 + 5 + 4); the two new ones are the seven-tick trajectories |
| Trace scans to see whether a fault key landed | 1 (the unreached flat key: `!unreached.trace.calls.some(...)`, test `slots: a fill key naming a slot nobody declares...`), plus 5 scans that count sites | 0 new landing scans: landing is `receipt.fillConsulted` (test `fills in v0.5...`, `[]` for the unreached key) or `BAD_FILL` for a path; the 5 site-count scans remain, because the receipt gives keys, not reach (N29); the old landing scan stays in its test, now with the receipt assertion beside it |
| `index.mjs` lines | 401 | 412 (16 lines added, 5 removed: the two trajectories and their helper cost more than the guards saved) |
| Test file | 760 lines, 40 tests | 833 lines, 41 tests |
| Boolean helper contracts | 0 | 0 |

## 0. What v0.4 removed from my entry (counts, kept from round 4)

| | Round 3 | Round 4 |
|---|---|---|
| Helper contracts that only emit a boolean (`bit.test`-style) | **1** contract (`bit.test`: outputs `high`, `low`) and **1** implementation (`bit.test/js`) | **0** (fact `helperContracts: []`, asserted in the test `the two behavioural multiplexers read the wire directly...`) |
| Contracts registered by `register` + `registerAudit` + `registerFaults` | 19 | 18 |
| Implementations | 27 | 24 (`bit.test/js`, `adder.ripple4/lo-nibble`, `adder.ripple4/hi-nibble` are gone) |
| `world.select(...)` calls in `index.mjs` | 7 | 5 (the two per-slot ones for the nibble copies are gone) |
| `index.mjs` lines | 422 | 401 (diff against the round 3 file: 62 lines removed, 41 added, net 21 fewer) |
| Per-nibble copies of an implementation to reach one full adder | 2 (`lo-nibble`, `hi-nibble`, each a copy of the four-step adder with other slot names) | 0 (path fill) |
| Closures that only existed to collect history | an `each` closure with a special case for zero ticks | none (`collect: ['state']`; zero ticks returns the input state) |
| Decision rows a person reads for one clock gate | 5 identical rows | 1 merged row (view only: the trace still holds 5, see N21) |
| Test file | 677 lines, 37 tests | 760 lines, 40 tests (each new feature got an assertion) |

Why no boolean helper stays: the one thing `bit.test` did (turn a wire into `high`/`low` booleans so `when` could read it) is now `{ eq: ['$in.clk', 1] }` written where the condition is used. `wire.bits4` (a test-only fixture contract that types a bit vector) stays; it is not a helper for conditions.

## 1. Status of every earlier point

| Point | Round 2 | Round 3 | Round 4 | Round 5 | Round 6 | Evidence |
|---|---|---|---|---|---|---|
| F1 feedback and stored state | Partly resolved | Partly resolved | **Partly resolved** (unchanged) | **Partly resolved** (unchanged) | **Partly resolved** (unchanged) | Zero-delay feedback is still rejected by lint (test `F1 partly resolved...`). The latch is still two timing models, each stating its own behaviour. |
| F2 a tick has no identity | Resolved in part | Resolved | **Resolved** | Resolved | Resolved | `startTick` closes the last gap: a second drive continues the numbering and the run edge (test `world.drive startTick...`; b14b: tick 10 reads `← run 10`, ticks 16-19 `cached ← run 1..4`). |
| F3 consecutive runs not linked | Resolved | Resolved | Resolved | Resolved | Resolved | unchanged tests |
| F4 replay of one tick | Resolved | Resolved | Resolved | Resolved | Resolved | unchanged tests; `counter.run` replays with `maxCalls` |
| F5 values cannot be assembled from Refs | Resolved | Resolved | **Resolved** | Resolved | Resolved | `collect` gives one gathered Ref per drive; `concat` for nibbles (b12). Residue N6 unchanged. |
| F6 variable repetition | Open | Open | **Open** | **Open**: still a new contract, `bits8` and 16 `at` specs per 8-bit adder (implementation parameters deferred, seq 52) | **Open** (implementation parameters still deferred, seq 59) | `adder.ripple8` is still a new contract plus a `bits8` const plus 16 `at` pieces. Width as a parameter is still not expressible (implementation parameters are deferred). |
| F7 the cache hides hardware | Partly resolved | Resolved | **Resolved**, and cache hits now carry their decisions | Resolved | Resolved | b6/b14 print `cached ← run r`; the gated test checks a cached idle tick still has its five decisions. Residue N11 unchanged (recursive inflation is still my `inflate`). |
| F8 view cannot collapse, label paths | Resolved | Resolved | Resolved | Resolved | Resolved | `maxDepth`, `[i]` labels, `target ← source` labels |
| F9 schemas cannot be named | Open | Open | **Open** | **Open** | **Open** | `bit`, `bits4`, `pair`, `bits8` are still JS consts copied into about 30 contracts. `x-` annotations arrived in v0.4, named schemas did not. |
| K1-K4 | Resolved | Resolved | Resolved | Resolved | Resolved | unchanged tests |
| N1 `ctx.tick()` not a cache input | Bug | Resolved | Resolved | Resolved | Resolved | test `ctx.tick() is a cache dependency (N1 fixed in v0.3)` |
| N2a slots are global names | Open | Open | **Resolved** (path-qualified fills, ledger seq 38) | **Resolved**, now with a wildcard: `adder.full#*` reaches every seat of a contract and a path key beats it (test `fills in v0.5...`, b16b, b16c) | **Resolved**, and now measurable: `receipt.fillReach` says which seats a key governed (4 for a flat key in `advance4`, 7 for a wildcard in b16c; facts `reach`) | tests `flat slot keys are still global...` (a flat key still hits 4 call sites in `counter.advance4` and 2 in `ripple8`, unchanged and still true) and `path slots (v0.4): "adder.ripple4#hi/adder.full#bit2" reaches exactly one full adder, with no per-nibble copies of the implementation` (exactly one site, cold and warm cache, 16 x 16 x 2 grid, healthy/faulty/healthy in one world); b13b shows one box, #166 under `hi`. Residue N19 (a drive tick cannot be named). |
| N2b mistyped slot key accepted | Distorts | Resolved | Resolved | Resolved. A path key that matches no call is now `BAD_FILL` as well (N15 below) | Resolved | test `slots: a fill key naming a slot nobody declares...` (BAD_FILL) |
| N3 one `state` per tick contract | Open | Open | **Open** | **Open** | **Open** | `ctx.drive` has one `slot` per drive; a per-bit flop history is still four drives sharing a tick. See N19. |
| N4 no timing model in the contract | Distorts | Resolved | Resolved | Resolved | Resolved | `latch.sr` examples with `ticks`; residue N10 |
| N5 drive strip does not say what the cache reused | Open | Open | **Resolved** | Resolved | Resolved | b6b, b6c and b14b: `cached ← run 1` .. `cached ← run 4`, the same as my own `=rN` labels (facts `resumed.cached`: `run 1 .. run 4`) |
| N6 gathered values opaque to `at` | Open | Open | **Open** | **Open** | **Open** | b10a: `d = 0 [0]` still points at `#2 adder.ripple4`, not at full adder 0. `collect` has the same grain: each element of `collected.state` points at its tick's call and no further (N22). |
| N7 check kind re-exported verdict | Ergonomic | Resolved | Resolved | Resolved | Resolved | `adder.audited` has `sum`, `cout`; b8 |
| N8 `ctx.drive` returns the last outputs only; nothing for zero ticks | n/a | New (open) | **Resolved** | Resolved | Resolved | `counter.run/drive` is now four lines with `collect: ['state']`; zero ticks gives `final = initial` and `states = [initial]` (test `counter.run (ctx.drive...)`; the `drives` row in b5a). Residue N22. |
| N9 `first` not lazy, needs two alternatives | n/a | New (open) | **Resolved** | Resolved | Resolved | Red test 36, flipped: `gated tick: a gather around skipped outputs is itself skipped, so a single-alternative first falls through (v0.3 failed at run time here)`. Red test 28, flipped: `a verdict can gate a result: a single-alternative first releases the sum for a healthy adder, and a rejected audit is NO_BRANCH`. `counter.tick/gated` has ONE `first` around ONE `gather`. |
| N10 an example repeats one input; a schedule is not an example | n/a | New (open) | **Open** (deferred in the ledger) | **Resolved** (ledger seq 48). `each` + `trajectory` on `latch.sr/lockstep` and `latch.sr/staggered`; `prove('latch.sr')` has 13 proofs, all ok (4 contract + 5 lockstep + 4 staggered); test `latch.sr: the contract specifies only Hold...` also proves a wrong wiring fails at tick 1; residue N28 | Resolved (13 proofs; the two trajectories are now named, and a wrong tick prints its inputs: N28) | The two latch trajectories (`STAGGERED`, `LOCKSTEP`) are still arrays in the test (lines 183-185). My choice for next: section 6. |
| N11 `expand` goes one level | n/a | New (open) | **Open** | **Open** | **Open** | `inflate` in `view.mjs` unchanged |
| N12 `when` reads a boolean, a wire carries 0 or 1 | n/a | New (open) | **Resolved** | Resolved | Resolved | `{ eq: ['$in.select', 1] }` in `gate.mux/branch`; `{ eq: ['$in.clk', 1] }` in `counter.tick/gated`; `bit.test` and `bit.test/js` deleted. The modelling point survives: the branch mux builds 2 NANDs where the gate mux builds 4 (b9a vs b9b); a decision is a model, not hardware. |
| N13 one cause, five decision rows | n/a | New (open) | **Partly resolved** | **Partly resolved**; the record stays per step on purpose (declined, seq 51). The view merges (b10b). Round 5 adds an asymmetry, N25 | **Partly resolved** (unchanged); the asymmetry N25 is gone | b10a and b10b show ONE merged row (`ran inc ff0 ff1 ff2 ff3`). The merge is in the view; the trace and the receipt still hold five decisions (the gated test asserts five with one `from`): N21. |
| N14 `ctx.when` and `when` record different things | n/a | New (open) | **Resolved** | Resolved | Resolved | `ctx.when(cond, label, { true: 'takeB', false: 'takeA' })` in `gate.mux/ctx-when`: b9c now says `ran takeB`, `skipped takeA` as b9b does |
| N15 slots declared in two places; "declared" is world-wide | n/a | New (open) | **Open** | **Resolved** (`receipt.fillConsulted`, and the fill line from `traceToSvg(..., { receipt })`). Test `fills in v0.5...`: `['adder.full#bit2']` when it reached a call, `[]` for a flat key aimed at `gate.xor`; b16a prints `(not consulted)`. A path key that reaches nothing is `BAD_FILL`. Residue N29 (which seats) | Resolved | A key aimed at a chain this run does not reach is still silently valid. No `receipt.fillUsed`. |
| N16 no slice | n/a | New (open) | **Open** (deferred in the ledger) | **Open** (deferred, seq 52): `nibble()` is still four `at`s, 16 in `adder.ripple8/two-nibbles` | **Open** (deferred, seq 59) | `adder.ripple8/two-nibbles`: `nibble()` is a gather of four `at`s, used four times: 16 `at` specs. |
| N17 small asymmetries | n/a | New | Mixed | Mixed (unchanged) | Mixed (unchanged) | The `→ taken` / `→ ran` word difference is gone (both say `ran` in b9b/b9c). The `tick` field on the root node of a `world.drive` receipt versus `ctx.drive` children: not re-checked. |
| N18 two view defects | n/a | n/a | New (open) | **Resolved** (ledger seq 50): b15's error sentence is wrapped inside the root box; b5a's `states` row has distinct labels, no `pieces ×20` wall | Resolved | Section 4 below (round 4 text) |
| N19 a path cannot name a tick in a drive | n/a | n/a | New (open) | **Open** (deferred, seq 52): `ctx.drive` still has one `slot` per drive; test `path slots in the counter...` still ends with `n >= 4` | **Open** (deferred again, seq 59) | Section 4 below (round 4 text) |
| N20 `one`: "or unchanged", exclusivity at run time | n/a | n/a | New (open) | **Partly resolved** (ledger seq 45): `else` derives the complement (the typed `eq select 0` is gone from `gate.mux/branch`), and the `one` lint refuses an unconditional alternative or a syntactic implication (test `one: ...`). Not resolved: "this, or the input unchanged" is still `first`, and a semantic overlap is still found by the run (N24) | **Partly resolved** (unchanged); my vote to remove `ctx.when` is recorded as declined, seq 58 | Section 4 below (round 4 text) |
| N21 merged decisions are a view, not a record | n/a | n/a | New (open) | **Declined** (seq 51: each step is its own moment). Accepted: the view merges, the record is per step. See N25 for what it now looks like | Declined | Section 4 below (round 4 text) |
| N22 `collect` omits the initial state | n/a | n/a | New (open) | **Open** (deferred, seq 52): `counter.run/drive` still writes `ctx.concat([initial], d.collected.state)` | **Open** (deferred, seq 59): `counter.run/drive` still writes `ctx.concat([initial], d.collected.state)` | Section 4 below (round 4 text) |
| N23 the condition lives in the wiring | n/a | n/a | n/a | New (open) | **Partly resolved** (seq 53). Both sides of the condition now leave rows: busy tick `inc, ff0..ff3 = true → ran  read eq($in.clk=1, 1)`, idle tick `... = false → skipped  read eq($in.clk=0, 1)` (b10a, b10b), so the trace says why every flop ran. Not resolved: the assembly still has the guard on `inc` alone and the step list still shows four unconditional flops (`guards` fact `ff0:-`) | Section 8 below (round 5 text), section 13 (round 6) |
| N24 the `one` lint knows syntax, not arithmetic | n/a | n/a | n/a | New (open) | **Open** (deferred, seq 59, rated low by two entries) | Section 8 below (round 5 text), section 13 (round 6) |
| N25 a busy tick has one decision, an idle tick five | n/a | n/a | n/a | New (open) | **Resolved** (seq 53): busy and idle both leave five decisions with one cause (facts `busyDecisions`, `idleDecisions`, `busyDecisionCauses: 1`; test 39 flipped) | Section 8 below (round 5 text), section 13 (round 6) |
| N26 a path that does not land is found after the run | n/a | n/a | n/a | New (open) | **Open**, one step closer: the `landing` option (path, all or none) lets the caller choose, and the `BAD_FILL` sentence now ends `landing: 'path'`, but it still says `no call matched, or a more specific key always won`, and it is still raised after the whole run | Section 8 below (round 5 text), section 13 (round 6) |
| N27 `[k]gather[k+1]` labels are cryptic | n/a | n/a | n/a | New (open) | **Resolved** (seq 57): pieces read `gather[k]←@k`, the tick tag; b5a (labels PASS; the 20 lanes are unreadable, N31) | Section 8 below (round 5 text), section 13 (round 6) |
| N28 a trajectory proof does not say which input or which example | n/a | n/a | n/a | New (open) | **Resolved** (seq 56): named examples (`hold, SET, hold, hold, RESET, hold, hold: the bit is stored, RESET passes through [1,1]`) and `tick 1: expected ... got ... (inputs {"r_n":1,"s_n":0}); tick 2: ...` lists every wrong tick. Parallel arrays `each` and `trajectory` remain, and `trajectory[0]` is still the state after tick 0 | Section 8 below (round 5 text), section 13 (round 6) |
| N29 the receipt says a key was used, not where | n/a | n/a | n/a | New (open) | **Resolved** (seq 55): `receipt.fillReach = { key: [ids] }`; five trace scans → 0 (test) | Section 8 below (round 5 text), section 13 (round 6) |

## 2. Workarounds removed, and kept

Removed in round 4 (each replaced by the v0.4 feature; tests green):

- `bit.test` and `bit.test/js` (the boolean-emitting helper) and every step that read `.high` / `.low`: replaced by relations in `when` (b9b, b9c, b10a, b10b).
- `adder.ripple4/lo-nibble`, `adder.ripple4/hi-nibble`, the `rippleCompose` helper that generated them, and the two per-slot `world.select(...)` calls: replaced by one path fill. `adder.ripple4` has its two implementations again (`composed`, `loop`).
- The four `first` specs, one inside each bit's gather, in the gated counter: one `first` around one `gather`.
- The duplicate alternative in `first` (the same release twice) used to satisfy a lint that wanted two.
- The `each` closure that collected per-tick Refs in `counter.run/drive`, and its zero-ticks special case: `collect` and zero-tick passthrough.
- Stale picture titles (EXPLAIN B-47).

Kept, with reasons:

- `bitsOf` / `intOf`: the I/O boundary between JavaScript integers and wires, by design.
- `adder.ripple4/loop` next to `/composed`: it is the test that imperative and declarative wiring record the same trace (test `F5 resolved...`), and the place where slots are declared with `uses`.
- `counter.advance4` (four unrolled ticks, `slot: t0..t3`): it is the only fixture where one path key reaches one tick (`counter.tick#t3/adder.full#bit2`, test `path slots in the counter...`); a drive cannot do that (N19).
- The two latch trajectory tables in the test (N10).
- `first` in `counter.tick/gated`: `one` cannot say "this step or the input unchanged" (N20).
- `wire.bits4`: a test-only fixture contract, because a step is a call to a contract.
- `inflate()` in `view.mjs` (N11), and `counterTimelineSvg` (it draws a `calls made` row the kernel strip does not).

## 3. Does v0.4 change "slot names are global"? Yes for paths; flat keys are unchanged.

- Flat key `'adder.full#bit2'`: still every call site (4 in `counter.advance4`, 2 in `ripple8`; test `flat slot keys are still global...`). Nothing broke.
- Path key `'adder.ripple4#hi/adder.full#bit2'`: exactly one site (test `path slots (v0.4)...`, b13b: one box names `adder.full/carry-stuck-0`, #166). The longest path wins over a flat key, so a flat key plus a path key reads "everywhere except here" and I can now write that fault pattern. Typos and ties are `BAD_FILL`.
- Cache correctness: one world is run healthy, faulty, healthy; sums are right each time, and on the 16 x 16 x 2 grid cold and warm results agree with independent arithmetic.
- Cost avoided: two whole implementations per 8-bit adder, which would have multiplied with nesting (four ticks of an 8-bit adder would have needed 4 x 2 copies).

## 4. New friction (round 4)

Each point ends with the Hegel / Wittgenstein line the round asked for.

### N18. Two view defects the v0.4 notes did not predict
- **Kernel today:** the v0.4 view notes say text stays inside boxes and titles. b15 contradicts that: the error line `"2 alternatives of a one binding were live: exactly one may be"` starts inside the red root box and runs 145 px past its right edge (box ends at x = 320, text at x = 465), over the green arrow gutter. And b5a's `states` row (21 pieces) repeats the grouped label `pieces ×20` about fifteen times, one per bracket, which hides the one distinct piece (the initial state).
- **Proposed shape:** measure error text and wrap it in the box; print a repeated group label once.
- **Severity:** ergonomic (pictures only); but the error box is where the picture most needs to be readable.
- **Hegel would say** a thing is what its edge says it is: text that crosses the edge of its box is not content of the box. **Wittgenstein would say** the person reading b15 does not care how the layout engine measures; they see words outside a box and cannot tell whose words they are.

### N19. A path can name a call site inside a composition, not a tick inside a drive
- **Needed:** "stick bit 2's carry in tick 3 of the counter run".
- **Kernel today:** `counter.advance4` (four hand-declared steps, `slot: t0..t3`) can be addressed (`counter.tick#t3/adder.full#bit2` hits one site). `ctx.drive` gives one `slot` to the whole drive and `world.drive` gives none; a key through the bare contract reaches every tick (test `path slots in the counter...`: at least four sites). So the natural fixture, the drive, is the one that cannot be faulted at one instant.
- **Proposed shape:** a drive tick is a path segment (`counter.tick@3/adder.ripple4/adder.full#bit2`), or `fill` may be a function of the tick.
- **Severity:** ergonomic for faults at one instant, which is the interesting test of a counter.
- **Hegel would say** a tick is a determinate moment of the process, so it belongs in the path. **Wittgenstein would say** engineers say "the fault on the third clock", and a path that has a role for "which adder" and none for "which clock" is notation for another game.

### N20. `one` cannot say "this, or nothing changed", and exclusivity is learned at run time
- **Needed:** the gated counter's state is the new state when clk is high, the input state otherwise.
- **Kernel today:** that is `first: [gather, '$in.state']`, whose second alternative is a plain input, not a conditional step. `one` over those two would always see two live alternatives (the input is always live), so it is `first` or nothing. And for the mux, `eq select 1` and `eq select 0` are exclusive by arithmetic, but the kernel learns exclusivity only when a run has both live: the test `one: a mux whose conditions overlap is AMBIGUOUS_BRANCH where first would silently take the first` finds the overlap (`eq select 1`, `ne select 7`) at select = 1, and b15 shows the failed run. An overlap that no test ever drives passes silently.
- **Proposed shape:** `one` takes a final unconditional fallback (`{ one: [...], otherwise: '$in.state' }`), and the lint proves exclusivity for relations of one wire against literals (`eq x 1` vs `eq x 0`), warning when it cannot.
- **Severity:** ergonomic for the first; for the second, a latent ambiguity that shows only on an input nobody tried.
- **Hegel would say** exclusive choice is a statement about the whole space of the input, not about one point of it. **Wittgenstein would say** "exactly one" is a rule, and a rule checked only on the case in front of you has not yet been followed.

### N21. Merging decisions is a view, not a record
- **Kernel today:** b10a and b10b show one row, but `node.decisions` still has five entries with the same `from`, and so does the cached copy. Everything that is not the kernel view (my tests, the facts file) merges them again (the gated test groups them by `from`).
- **Proposed shape:** steps sharing a `when` share one decision, `ran: [...]` / `skipped: [...]`, recorded once.
- **Severity:** ergonomic.
- **Hegel would say** the one cause is the thing and the five rows are its appearance. **Wittgenstein would say** the picture got it right and the record did not: the rule was applied once, and the record says five times.

### N22. `collect` history starts one element short: the initial state is not collected
- **Needed:** `states` is the whole history including the initial state (21 states for 20 ticks).
- **Kernel today:** `collected.state` has 20 elements, each pointing at its tick's call. The initial state is not in it, so `counter.run/drive` writes `ctx.concat([initial], d.collected.state)`, and every element of `states` is a piece of a concat of a gather element: two hops from a state to its tick, and the label noise of N18 in b5a. Also `collect` names ports of the contract, so a path inside a port (bit 3 of the state) cannot be collected.
- **Proposed shape:** `collect: { state: { withInitial: true } }`, and for a path `collect: [{ at: ['state', 3] }]`.
- **Severity:** ergonomic.
- **Hegel would say** a history is a beginning and its successors, and the beginning belongs to it. **Wittgenstein would say** nobody who says "the counter went 0, 1, 2" leaves out the 0.

## 5. What fitted cleanly in round 4 (no friction)

- **Relations in `when`:** `{ eq: ['$in.clk', 1] }` reads like the datasheet, and the decision row prints that text. KERNEL.md says `eq` and `ne` are deep equality, so a comparison of two bit vectors should be one relation; I did not need it (the audit check still compares in JavaScript) and did not test it, so I make no claim about it.
- **A skipped gather is skipped:** the idle tick is one node (138 to 1); b10b shows one passthrough.
- **Path slots:** the right grain for fault injection: one site, cold and warm cache both exact, typos refused.
- **`startTick`:** two drives joined by `← run 10` with no manual run edge (b14b).
- **`one`:** `AMBIGUOUS_BRANCH` with both candidates in the failed trace (b15) is the diagnosis a person wants.
- **Named branches:** b9c now says what it did not do.

## 6. The one kernel change I wanted after round 4 (granted in round 5: schedules as examples, seq 48)

**Schedules as examples (N10).** Evidence: the latch is a stateful contract whose real specification is a trajectory: hold, SET, hold, hold, RESET, hold, hold (b7a, b7b). v0.3 gave `ticks` (one input repeated), so each timing model states Set and Reset alone, but the sequence that separates the two models (staggered stores a bit; lockstep oscillates through `[1,1] [0,0] [1,1]`) still lives in two hand-copied arrays in the test (`STAGGERED`, `LOCKSTEP`, lines 183-185), which `prove` never checks. A `{ in, each: [inputs per tick], out: [states per tick] }` example would put each trajectory on its implementation, in the proof, and in the picture. It is deferred in the ledger (seq 43), and here the same table exists in three places (my head, the test, the strip). Next after that: slices (N16, 16 `at` specs), `collect` with the initial state (N22), and a tick segment in paths (N19).


---

# Round 5 (kernel v0.5)

## 7. Workarounds removed, and kept

Removed (all verified by the test file, 41/41):

- Four of the five `when: clkHigh` in `counter.tick/gated`: the flops read `inc.sum`, so a skipped `inc` skips them (inherited skips). The record still has one decision per step: busy tick `inc ran`; idle tick five skips with `inc`'s cause (b10a, b10b).
- The typed `eq select 0` in `gate.mux/branch`: `takeA` is `{ else: ['takeB'] }`, and a decision row prints `else(takeB: eq($in.select=1, 1))` (b9b).
- The latch trajectories kept as arrays in the test: `each` + `trajectory` on the implementations, checked by `prove`, read back by the test. A wrong wiring fails at the first differing tick (test `latch.sr: the contract specifies only Hold...`).
- The need to scan the trace to see whether a fault landed: `receipt.fillConsulted` and `BAD_FILL` for a path to nowhere (test `fills in v0.5...`).

Kept, with reasons:

- `first` in `counter.tick/gated`: `one` cannot say "this or the input unchanged" (N20 residue).
- `one` in `gate.mux/branch`, with `else`: exclusive by construction now; `one` is the honest word.
- `gate.mux/ctx-when` (the imperative twin): kept to show the two records differ (one row naming both branches; the composition has two rows).
- `counter.advance4`: still the only fixture where a path names one tick (N19).
- `driveLatch` and its `each: (k) => ...` closure: `world.drive` still takes inputs by function; the example form (`each: [...]`) exists only on examples.
- The remaining trace scans that count sites (`walk(... carry-stuck-0)`): the receipt says a key was used, not how many seats it reached (N29).
- `wire.bits4`, `bitsOf`, `intOf`, `adder.ripple4/loop`, `inflate`, `counterTimelineSvg`: reasons unchanged from section 2.

## 8. New friction (round 5)

Each point ends with the Hegel / Wittgenstein line.

### N23. With inherited skips the condition lives in the wiring, not on the step
- **Kernel today:** in `counter.tick/gated` only `inc` has a `when`. The flops have none, yet they are conditional: they read `inc.sum`. Someone reading the step list sees four unconditional flops (the `guards` fact shows `ff0:-`). The rule "the flops run only on a clock edge" is in no single place a reader can point at; it is a consequence of `d: { at: ['inc.sum', i] }`. The trace does say it (five skips, one cause), the assembly does not.
- **Proposed shape:** `receipt`/`implementation` introspection that lists each step's effective condition (own `when` and inherited ones), e.g. `world.implementations()[...].effectiveWhen`, and a view of the composition itself, not only of its runs.
- **Severity:** ergonomic; becomes a trap when someone later adds a flop that does not read `inc`, and it silently runs on an idle tick.
- **Hegel would say** what depends on a negated step is itself negated, so no second statement is needed. **Wittgenstein would say** people read the list of steps as a list of rules; a rule that has to be derived from a data edge is a rule nobody wrote, and the page no longer shows it.

### N24. The `one` lint knows syntax, not arithmetic
- **Kernel today:** unconditional alternatives and `and`-conjunct implication are refused at assembly (test `one: ...`: `takeA` without a `when`, and `and: [eq select 1, eq a 1]` against `eq select 1`). But `eq select 1` against `ne select 7` is accepted at assembly and fails only in a run that makes both live (b15 used it in round 4; in round 5 the fixture is `eq select 1` against `eq a 1`, which no lint could decide, since they read different wires). The only decidable case that matters, `eq x 1` against `eq x 0` on a bit, is fine because it is now an `else`.
- **Proposed shape:** relations of one wire against literals are decided at assembly (`eq x 1` implies `ne x 7`); the lint warns, not errors, when two conditions read different wires (it cannot know).
- **Severity:** ergonomic.
- **Hegel would say** exclusion is a property of the whole space of inputs. **Wittgenstein would say** the lint checks the spelling of the rule, and a rule is followed or not when it is used; b15 is the picture of one used wrongly.

### N25. A busy tick has one decision; an idle tick has five
- **Kernel today:** after inherited skips, `counter.tick/gated` records `inc ran` on a busy tick (one decision, the flops have none) and `inc, ff0, ff1, ff2, ff3 skipped` on an idle tick (five decisions with one cause). Anything that counts decisions per tick (my test, a replay summary) sees 1 and 5 for the same composition. The record is not symmetrical between what happened and what did not.
- **Proposed shape:** either record the inherited step's "ran, because its producers ran" or record an inherited skip as one decision with `skipped: [..]` (declined for steps with the same `when`, seq 51; this case is different because no step carries the `when`).
- **Severity:** ergonomic (counting).
- **Hegel would say** an event and its absence are one moment seen twice. **Wittgenstein would say** nobody counts the decisions; they ask "why did the flops not run?" and "why did they?", and the record answers only the first.

### N26. A path that does not land is found after the run, and the message gives two causes
- **Kernel today:** `adder.ripple4#hi/adder.full#bit2` in a 4-bit run fails with `BAD_FILL: path fill reached no call in this run: ... (no call chain matched, or a longer path always won)`. It is raised after the whole run (the failed trace has all four calls), so a typo in a 20-tick drive spends 2761 nodes before saying so, and the message cannot say whether the chain never occurred or another key beat it.
- **Proposed shape:** name which: `no call chain matched` or `beaten by <key> at calls <ids>`.
- **Severity:** ergonomic.
- **Hegel would say** a path means something only where it lands, which is only known after. **Wittgenstein would say** the person typing a path wants to know which of the two mistakes they made.

### N27. `[k]gather[k+1]` labels are cryptic
- **Kernel today:** b5a's `states` row now reads `[0] passthrough [0]gather[1] [1]gather[2] ... [19]gather[20]`, which is correct (output index, then the gather piece it came from) and which no one will parse at a glance.
- **Proposed shape:** `states[1] ← tick @0` using the tick child's tag.
- **Severity:** ergonomic.
- **Hegel would say** the label should name the moment it came from. **Wittgenstein would say** the label should say what a reader asks: "which tick made this state?".

### N28. A trajectory proof does not say which input it was on, or which example it was
- **Kernel today:** a failed trajectory reports `tick 1: expected {"state":[1,0]} got {"state":[1,1]}` (test). It does not print that tick's `s_n`, `r_n`, so you have to count into the `each` array to learn that tick 1 was the SET. The example has no name: it is `impl:4`, not "SET then RESET". `each` and `trajectory` are two parallel arrays that must be kept aligned by index, and `trajectory[0]` is the state after tick 0, not the initial state, so a latch trajectory starts with a "hold" row.
- **Proposed shape:** include the tick's merged inputs in the detail; an optional `name` on an example; or one array of `{ in, out }` rows.
- **Severity:** ergonomic.
- **Hegel would say** a step of a trajectory is its input and its outcome together. **Wittgenstein would say** a timing diagram is read column by column; the notation here splits the columns into two rows that I must realign by hand.

### N29. The receipt says a fill key was used, not where
- **Kernel today:** `receipt.fillConsulted` is a list of keys (`['adder.full#*', 'adder.ripple4#hi/adder.full#bit2']` in b16c). Which seats each key governed is read off the boxes (b16c: `#190` is `two-half`, seven others `carry-stuck-0`), and the test still scans the trace to count sites.
- **Proposed shape:** `fillConsulted: { key: [call ids] }`.
- **Severity:** ergonomic; for fault injection it is the number you want ("this fault hit 1 site", "this wildcard hit 7").
- **Hegel would say** a key is its reach. **Wittgenstein would say** "applied" is a yes-or-no for typos but a how-many for experiments; I asked the second question.

## 9. What fitted cleanly in round 5 (no friction)

- **`else`:** one word replaces a typed complement and the decision row shows its derivation (`else(takeB: eq($in.select=1, 1))`, b9b).
- **Inherited skips:** the guard is written once, the idle tick is still one node (b10b), and the cache hit still carries its five decisions (test).
- **Specificity:** `adder.full#*` plus one path key gave exactly "everything stuck except hi bit 2" (b16c; test checks the two keys and the seat impls). No pins were needed.
- **Path must land:** caught my own typo at once (`hj` for `hi`, round 4 test), and did not misfire on cache hits (the cold/warm grid in `path slots (v0.4)` runs with the cache on).
- **Examples over time:** the oscillation of the lockstep latch (`[1,1] [0,0] [1,1]`) is now an executable statement on the implementation instead of a table in the test.
- **View:** the fill line (b13b, b16), wrapped errors (b15), operand values in tests (`eq($in.clk=0, 1)`, b10b).

## 10. The one kernel change I would most want next

**`fillConsulted` with reach (N29), then a tick segment in paths (N19).** Evidence: fault injection is the use in this domain, and its output is a count ("how many adders did that hit") that I still get by scanning the trace in five tests, while the new landing check answers only the yes/no. With `{ key: [call ids] }` the receipt is the experiment's result. N19 is the same question across time: the drive cannot be faulted at one tick, and the only fixture that can (`counter.advance4`) is four hand-written steps.

## 11. Looking back over five rounds

- **The concept that most changed how I would write this domain from scratch: tick contracts with `world.drive`, `ctx.drive` and examples over time (one concept, three rounds).** Round 1 built the 20-tick counter run as a hand loop of 20 sibling calls with no tick number (2761 nodes, no way to name a tick, `counter.run/loop` plus an `each` closure for history). Today `counter.run/drive` is four lines (`collect: ['state']`), every tick has a number and a run edge to the previous one, a resumed drive continues with `startTick` (b14b), the cache reuses tick 16 for tick 0 and says so (`cached ← run 1`, b6), and the latch's specification is a trajectory the kernel proves (13 proofs). From scratch I would write the counter and the latch as tick contracts first and the adders second; everything I fought with in rounds 1 to 3 (F2, F3, F4, N1, N4, N8, N10) was one question: what is time in a run.
- **Second:** path-qualified slots (call-site identity). Without them fault injection needed a copy of an implementation per nibble.
- **The one I would remove if I could: `ctx.when`, the imperative twin of `when`.** Every use in my entry was a model of a composition's `when`, and each round added a parameter to make its record agree with the composition's (named branches in round 4, `guards` as a third argument in round 3). With `else` and inherited skips the composed form states the same decision once and derives its complement; the imperative form still records one row naming two branches where the composition records two rows. Two ways to write one decision with two different records cost me N14 and N20. I would keep the relations (`eq`, `ne`, `else`) and the composed `when`, and let an imperative implementation call a composition.


---

# Round 6 (kernel v0.6)

## 12. Workarounds removed, and kept (counts, before = round 5 files, after = now)

| | Round 5 | Round 6 |
|---|---|---|
| Trace scans that compute what `fillReach` answers (count the seats a fault key reached) | 5 (`walk(... carry-stuck-0)` fault-site counts across the tests `flat slot keys are still global`, `path slots (v0.4)` and `path slots in the counter`) | **0**: each is `receipt.fillReach[key].length`. Only one `walk(` use remains, and it counts nothing about fills |
| Guards kept only because of `one`/`else` gaps | 0 | 0 (nothing to remove; `first` in `counter.tick/gated` is "this, or the input unchanged", not a guard, N20 residue) |
| `allowUnusedFill` where `landing: 'none'` says what I mean | 1 | 1, kept: the key `adder.full#bit9` names a slot nobody declares, and a typo fails in every landing mode; `landing` answers "did the key reach a call", `allowUnusedFill` answers "is the slot declared", two different questions (N32) |
| Decisions recorded for a busy gated tick (idle: 5) | 1 | **5** (one cause); symmetric |
| Unnamed trajectory examples | 2 | **0** (`LATCH_TRAJECTORY(name, states)`) |
| Assertions that read `chosenBy` or `fillReach` | 0 | new assertions in the test `fills in v0.5...` (cold and warm cache reach, rungs of the seats, landing modes) |
| `index.mjs` lines | 412 | 414 (5 added, 3 removed) |
| Test file | 833 lines, 41 tests | 869 lines (54 added, 18 removed), 41 tests |
| Tests flipped | | **Test 39** (gated clock): old `busy tick records one decision` → new `busy and idle both leave five rows (v0.6)` |

Removed: the five fault-site scans; the unnamed examples. Kept, with reasons: `allowUnusedFill` (above); `first` in `counter.tick/gated` (N20); `ctx.when` on `gate.mux/ctx-when` (declined for removal, seq 58, so the imperative twin stays as the b9c evidence); `counter.advance4` (N19); `driveLatch`'s `each` closure; `wire.bits4`, `bitsOf`, `intOf`, `inflate`, `counterTimelineSvg`.

## 13. New friction (round 6)

### N30. The rung is in the data, but the view draws only fill rungs; and `+N` hides an id the receipt has
- **Kernel today:** `node.chosenBy` has seven rungs. The view draws `⚑ by path ...` and `⚑ by every-slot ...` (b13b, b16b, b16c) and `by contract X` on some boxes, but the two nibble boxes #2 and #127 in b16c, chosen by the contract's declared default, show no rung, and `ff.dff#bit0..3` (only implementation) none either. The fill line abbreviates seven reach ids to six plus `+1`; the seventh (#217) is only in `receipt.fillReach`.
- **Proposed shape:** draw every rung or none, so the absence of a flag means "a fill chose this" nowhere; print all ids up to a width limit and say `+N` only past it.
- **Severity:** ergonomic; in b16c I had written the claim "the nibbles are chosen by the declared default" and the picture could not confirm it (EXPLAIN B-52, FAIL on details).
- **Hegel would say** a choice is a choice at every rung, the default as much as the override. **Wittgenstein would say** a flag shown on some boxes teaches the reader that boxes without it were not chosen.

### N31. Edge lanes stop working at about twenty edges
- **Kernel today:** per-edge gutter lanes (v0.6) fixed the shared-x overlap in b1 and b3 (distinct lines about 5 px apart). In b5a the 20 dashed brackets from the 20 ticks have 20 distinct x values 2.1 px apart, and the picture shows one hatched band (EXPLAIN B-18 and the b5a row, split verdict).
- **Proposed shape:** a lane budget: past N lanes in one gutter, bundle edges from one source row into one trunk with a count, or widen the gutter proportionally; or draw the `collect` edges as a single bracket labelled `20 ticks`.
- **Severity:** ergonomic (view).
- **Hegel would say** quantity turns into quality: twenty lines are no longer twenty lines but a band. **Wittgenstein would say** a rule that is followed exactly (each edge its own lane) and gives a picture nobody can follow has the wrong rule.

### N32. Two knobs for two neighbouring questions
- **Kernel today:** `landing` ('path', 'all', 'none') decides whether a fill key must reach a call; `allowUnusedFill` decides whether a key naming a slot nobody declares is accepted. With `landing: 'none'` a flat key aimed at a gate is fine, but a key aimed at an undeclared slot still throws unless I add `allowUnusedFill`. In my entry the second is the typo and the first the experiment.
- **Proposed shape:** one document line in KERNEL.md saying which question each answers, or fold `allowUnusedFill` into `landing: 'none'` (declined for the typo reason above, so rather a doc line).
- **Severity:** ergonomic.
- **Hegel would say** "declared nowhere" and "reached nowhere" are two negations, not one. **Wittgenstein would say** the person learns the second knob only by being refused; the names do not tell the games apart.

### N33. A merged decision row names five steps and one cause, and cannot say which of them produced the others
- **Kernel today:** b10a's row reads `inc, ff0, ff1, ff2, ff3 = true → ran  read eq($in.clk=1, 1)`. Only `inc` was tested against the clock; the flops ran because they read `inc.sum` (inherited, seq 53). The five names look like five equal tests of one condition.
- **Proposed shape:** the view prints the producer: `inc: eq(...)`, `ff0..ff3: via inc`.
- **Severity:** ergonomic (a reader of b10a cannot tell a tested step from an inherited one; N23 residue).
- **Hegel would say** one is the ground, four are grounded. **Wittgenstein would say** the row reads like a list of equals; the grammar of the situation is a hierarchy.

## 14. What fitted cleanly in round 6 (no friction)

- **`fillReach`:** a fault experiment's answer is now one expression, `receipt.fillReach['adder.full#*'].length` (7 in b16c), cold or warm cache (a cache hit counts as its hit node).
- **Inherited runs:** busy and idle ticks leave the same five rows; the question "why did the flops run?" has a recorded answer.
- **Named examples and inputs in failures:** a wrong latch is reported with its example's name, the tick and `(inputs {"r_n":1,"s_n":0})`; I no longer count into an array.
- **Short `else(takeB)` with the cause as an edge** (b9b): shorter and truer than the spelled-out test.
- **Per-edge lanes at small counts** (b1, b3).

## 15. The one kernel change I would most want next

**A tick segment in paths (N19).** Evidence: it is the one request that has been deferred twice (seq 52, seq 59) and is the one place my entry still has a hand-built fixture: `counter.advance4` (four hand-written steps, lines 320-330 of `index.mjs`) exists only so that a path can name one tick, and `fillReach` now makes the gap sharper: `receipt.fillReach` can tell me a fault hit 1 site, but never "at tick 3". A drive of 20 ticks can be faulted for all of its ticks or none. Fault injection in time is what sequential hardware testing is (stuck-at at one clock edge).

## 16. Looking back, round 6: where the kernel's picture and the domain's own picture still disagree most

The place: **time**. The kernel's picture of my domain is a tree of calls: each flip-flop, latch or counter tick is one atomic call that takes a state and returns a state, and a run is a sequence of those calls (`world.drive`). The domain's own picture is a timing diagram: signals as rows against a continuous axis, gates with propagation delays, a clock with two levels inside every tick, and feedback (a latch stores a bit because its output wires back into its input, not because a step recorded it). The evidence inside my own entry is the SR latch: `latch.sr/lockstep` and `latch.sr/staggered` are two implementations of one contract, both proven by `prove`, and on the same schedule they give different answers (b7: lockstep oscillates `[1,1] [0,0] [1,1]`, staggered stores the bit and passes through `[1,1]`). The contract (Hold, Set, Reset) cannot say which one is the latch, because which one it is depends on the relative gate delays, and the kernel's unit, the tick, has no inside.

What a reader of my pictures would get wrong because of it:
- They would read b7 as two different latches, or one right and one buggy; it is one circuit under two assumptions about delay, and the pictures show neither assumption.
- They would read `skipped` and `passthrough` in b10b as "the hardware did nothing on an idle tick" (1 node against 138), while in the circuit nothing is skipped: every gate is always evaluating, and the flip-flops hold because their feedback loops hold. The trace's economy (an idle tick is one box) is the kernel's, not the circuit's.
- They would read the left-to-right order of the four `adder.full` boxes in b3 as time, a ripple in sequence. It is data dependence; with the wires settled, the carry chain is a delay, which the call tree turns into an order.

The kernel is honest about all this (a call is a value, a tick is a step), and the entry works; the disagreement is that the domain's central object, a signal over time, is not a value in this kernel, and every picture I make of it is a picture of the steps standing in for it.
