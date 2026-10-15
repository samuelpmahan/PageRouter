# Contest F friction: events over time with demand-driven starting of work

Domain: agents (strong, helper, orchestrator) take tasks from a frontier; completing a task can reveal tasks; completed work waits in an integration backlog of capacity N. Round 1 recorded ten points. Round 2 migrated to kernel v0.2 and added points 11 to 20. Round 3 migrated to v0.3 and added 21 to 31. Round 4 migrated to v0.4 (32 to 36). Round 5 migrated to v0.5 (37 to 41). Round 6 migrates to v0.6 (42 to 45). Part A gives the status of every earlier point (Resolved, Partly resolved, Open); each point carries a "Round 6" line, then its "Round 5" line, and the older text below is kept. Part B is the new friction (32 to 36 from v0.4, 37 to 41 from v0.5, 42 to 45 from v0.6), each with one line from Hegel and one from Wittgenstein. Part C is what fitted. Part D answers the two deferred questions (demand, implementation parameters) and says whether v0.4 changes the evidence. Part E is the one change I want next.

Numbers used below: the 36-tick N=3 simulation, `cache: false` unless said. Round 1 took 383 ms, round 2 132 ms, round 3 147 to 158 ms (16 calls per tick, a log in the state). Round 4: 15 calls per tick, 541 calls in the one-run simulation (1 root + 36 x 15; round 3 had 577). Same machine, same session, four runs each (noisy: one 199 ms outlier): round 4 module 104 to 112 ms with the cache on, 112 to 151 ms with it off; round 3 module on the v0.4 kernel 138 to 241 ms and 152 to 207 ms. A second identical drive is 36 root hits in 7 ms. These are scratch measurements, not asserted by a test. Event logs and count series are identical to round 3 for N = 1, 3, 8, both gates, both allocators (12 combinations, snapshot compared before and after the edits).

Round 5 numbers (kernel v0.5): behaviour and event logs identical to round 4 (12 combinations, snapshot compared); 15 calls per tick, 541 calls for the one-run simulation; `index.mjs` 491 to 500 lines (6 removed, 15 added: the trajectory example and the comments that replace three guards); test file 556 to 634 lines (33 tests); render script 213 lines. Counts that v0.5 let me remove: restated guards 1 to 0 (`regret when audit`), typed complements 1 to 0 (`res when eq gate 'reserve'`), pins or fills that existed only to dodge precedence 0 to 0 (none existed; v0.5 gave me the test instead), hand-kept trajectories outside `prove` 1 to 0 (the 13-event list and 5-row count series in a test), invented sentinel examples 1 to 0 (`agents.clock`).

Round 6 numbers (kernel v0.6): behaviour and event logs identical to round 5 (12 combinations, snapshot compared); 15 calls per tick, 541 for the one-run simulation; `index.mjs` 500 lines (names on the examples, `landing` passed through `runDrive`); test file 634 to 669 lines (33 tests); render script 230 lines. Counts that v0.6 let me remove: trace scans rebuilding what `fillReach` and `chosenBy` answer 3 to 0, a fill built per configuration because one table could not serve both gates 1 to 0, examples identified by position 6 to 0, guards kept only for the `one`/`else` gaps 0 to 0, `allowUnusedFill` 0 to 0.

Helper contracts: before 1 (`agents.gateKind`, plus its implementation and examples), after 0. The demand branch cost seven declarations in round 3 (gateKind contract and implementation, demandLiteral and demandReserve each contract and implementation, the composition); it costs five now. `index.mjs` went from 496 to 491 lines, with 48 lines removed and 43 added (the removed ones: the gateKind block, the `{sim, log}` state schema and its concat plumbing, the computed-boolean decisions; the added ones: test conditions, `select`, `collect`, and comments for the path fills). The test file grew from 492 to 556 lines (31 tests), because each v0.4 feature got a test.

## A. Status of the earlier points

### 1. Time: RESOLVED
- **Round 6: RESOLVED.** Unchanged.
- **Round 5: RESOLVED.** Unchanged. `agents.clock` is now proved at ticks 0 and 7 (example `tick`).
- The clock is `ctx.tick()` read by `agents.clock`; unchanged since round 3.
- **Evidence:** test "drive: each tick is a run ... NOT impurity"; f-agents-5-drive.png F5b `#2 agents.clock`.

### 2. State across runs: RESOLVED
- **Round 6: RESOLVED.** Unchanged.
- **Round 5: RESOLVED.** Unchanged; `startTick` (23) still resumes.
- Tick k+1's `state` input is `{kind:'run', run, from}` of tick k. v0.4 adds `startTick`, see 23.
- **Evidence:** test "drive: each tick is a run ..."; test "determinism ..."; F5a, F5b `← run 1`.

### 3. Demand, request(n): OPEN, deliberately deferred (case in D)
- **Round 6: OPEN, deferred.** Unchanged; seq 59 does not list demand.
- **Round 5: OPEN, deferred.** Unchanged. v0.5 did not touch demand; the gate is `lit` plus `else`, one child per tick (F9). Ledger seq 52 does not list demand/request(n); one requester.
- Demand is `agents.demand` (counts, config to limit) feeding `constraints.maxStarts`. v0.4 made the branch cheaper (no predicate contract) and the rule visible as a test, but the number is still an integer that nothing marks as a request.
- **Evidence:** F9a/F9b; test "demand gate (v0.4 test conditions + one) ..."; test "demand supplied by drive.each is lagged ..." (94, 37, 35 ticks against 79, 36, 35: unchanged).

### 4. A source that emits and collecting what it emitted: PARTLY RESOLVED (further than round 3)
- **Round 6: PARTLY RESOLVED.** Unchanged: `collect` on `ctx.drive` only. The view now writes `←@k` on the state and counts rows of the simulate root and on the last piece of `events`, but not on the other pieces (43).
- **Round 5: PARTLY RESOLVED.** Unchanged: `collect` on `ctx.drive` only; `runDrive` still flat-maps per-tick `events` because `world.drive` has no `collect`. v0.5 fixed the view (an `at` into a gathered value draws only its pieces), see 34.
- Resolved: `ctx.drive(..., { collect: ['events'] })` gathers a port across ticks, with exact provenance (test: each output event is `at[j]` of `at[k]` of one shared gather whose piece k is the call of tick k). The log left the state: the tick state is the plain world, 15 calls per tick instead of 16, no `tickState` schema, no log in any cache key.
- Still open: (a) `world.drive` has no `collect`, so `runDrive` flat-maps per-tick `events` in my driver (a small piece of host code again, as in round 2); (b) inside `ctx.drive` I still flatten with `ctx.concat(...perTick.value.map((_, k) => ctx.at(perTick, k)))` because `collected.events` is an array of per-tick lists; (c) the view cannot draw the provenance (new 34); (d) no emit or stream port.
- **Evidence:** test "concat and collect (v0.4) ..." (drives `[agents.tick, 0, 36, until, 36 calls]`, 72 events, equal to the driver's flat-map); F7a.

### 5. Async completion: OPEN, deliberately deferred
- **Round 6: OPEN, deferred.** Unchanged.
- **Round 5: OPEN, deferred.** Unchanged.
- Unchanged. Completion is still polled with `remaining`.

### 6. A contract cannot state an objective or hold implementations to it: PARTLY RESOLVED
- **Round 6: PARTLY RESOLVED.** Unchanged.
- **Round 5: PARTLY RESOLVED.** Unchanged. New in round 5: the `trajectory` example is the first place the kernel states what the whole tiny run must do tick by tick, but it is a spec of one scenario, not an objective; ranking implementations is still the audit seat. Ledger seq 52: graded checks deferred.
- Unchanged from round 3: implementation examples carry the contested input (greedy 1709, exact-dp 1909, both proved); nothing ranks implementations by an objective; the audit seat (`agents.allocate#shadow` plus `agents.regret`) is my hand-built ranking.
- New in round 4: F11 shows the audit can be made meaningless by a fill (see 35).
- **Evidence:** test "implementation examples (v0.3) ..."; F10, F11.

### 7. Implementation parameters are invisible: OPEN, deferred again (ledger seq 43); v0.4 does not change the evidence
- **Round 6: OPEN, deferred again (ledger seq 59, with the reason); v0.6 does not change the evidence.** Seq 59 says my evidence is about state the kernel cannot see, so the fix is a convention the kernel would offer, not detect. I accept the reading: `fillReach` and `chosenBy` show which implementation served a call, and the knob test (a closure outside every hash, 36 of 36 stale root hits) is unchanged and green. A convention would be: an implementation that reads outside state declares it (`params`), and the declaration enters the key. I would take the convention; section E.
- **Round 5: OPEN, deferred again (ledger seq 52, one requester); v0.5 does not change the evidence.** The knob test is unchanged and green (36 of 36 stale root hits, old schedule). `receipt.fillConsulted` lists the fill keys used, so an implementation chosen by a fill is visible in the receipt; a closure knob is not a fill and is not listed. Section D.
- `WEIGHTS` is still a module constant in no cache key and no trace header. The knob test is unchanged and still passes: knob changed between two drives gives 36 of 36 root hits and the old schedule; `cache: false` gives another schedule; making the knob an implementation gives zero hits and the new schedule.
- What v0.4 adds: path fills make "a parameter is an implementation" more targeted (one seat only, F11), and `x-` annotations exist, but they sit on port schemas of a contract, not on an implementation, and are ignored by validation (I did not test whether they reach a cache key), so they are the wrong place for a parameter of one implementation. Neither changes the silent staleness. Section D.
- **Evidence:** test "implementation parameters (FRICTION 7, now more costly) ..."; test "path slots (v0.4) ...".

### 8. Trace view is the wrong tool for a decision over big values: PARTLY RESOLVED
- **Round 6: PARTLY RESOLVED.** F1b needed another widening (1060 and 140) because the v0.6 view cut the third assignment at the old width; the cut is visible, not silent.
- **Round 5: PARTLY RESOLVED.** Unchanged (F1b still needs `colWidth: 1000`). v0.5 breaks long expressions and errors across lines, which helps F9 and F6c.
- Unchanged: `colWidth: 1000` and `valueChars: 130` for F1b. I keep my own score-matrix picture.
- **Evidence:** F1b, F2c/F2d.

### 9. Cache and time: RESOLVED BY THE KERNEL
- **Round 6: RESOLVED BY THE KERNEL.** Unchanged.
- **Round 5: RESOLVED BY THE KERNEL.** Unchanged.
- Unchanged. Round 4 adds: a drive resumed from a recorded state with the right `startTick` hits the original drive's entries (F5d: six cache hits), which is what content addressing plus a tick dependency should give.
- **Evidence:** tests "tick dependency ...", "world.ref and startTick (v0.4) ..."; F8, F5d.

### 10. Errors from implementations carry no trace: RESOLVED
- **Round 6: RESOLVED.** Unchanged.
- **Round 5: RESOLVED.** Unchanged.
- `ctx.fault(..., 'ASSIGNMENT_REJECTED')` after `ctx.when(accepted, ..., {true:'start', false:'refuse'})`; the trace shows "ran refuse, skipped start" and the code.
- **Evidence:** F6c; test "a rejecting check ... NAMED code ..." (decision expectation now includes `ran: 'refuse', skipped: 'start'`).

### 11. `ctx.tick()` is a hidden input the cache key does not contain: RESOLVED
- **Round 6: RESOLVED.** Unchanged.
- **Round 5: RESOLVED.** Unchanged.
- Unchanged. **Evidence:** test "tick dependency: the round 2 stale-clock reproduction ...".

### 12. A composition cannot read the clock: OPEN (workaround stays, harmless)
- **Round 6: OPEN (workaround stays, harmless).** Unchanged.
- **Round 5: OPEN (workaround stays, harmless).** Unchanged; seq 52 lists the clock binding as deferred.
- Unchanged: `agents.clock` is still a first step of `agents.tick/pipeline`; the clock cannot be a binding. v0.4 conditions have no `tick` operand either. Ergonomic only.

### 13. `prove` cannot set the tick, so tick-dependent behaviour has no contract example: PARTLY RESOLVED
- **Round 6: RESOLVED.** Unchanged; the examples are named now (`the tiny world, tick by tick`), `prove` reports the names. A failing tick lists every wrong tick; `(inputs ...)` appears only for `each` inputs, so the failure of my trajectory does not show the state going into the tick (45).
- **Round 5: RESOLVED.** v0.5 examples over time. `agents.clock` is proved at ticks 0 and 7 (`{ in: {}, tick: 7, out: { tick: 7 } }`), the invented sentinel `-1` example is deleted; `agents.tick` has a `trajectory` example (events, counts, finished for each of the 5 ticks); `prove` checks every tick, and a mutant integrator that never integrates is reported "tick 1: expected ..." (test "the tiny world, driven"). The hand-kept literal list in my test is gone.
- Unchanged: `ticks` examples exist (the 13-event tiny timeline on `agents.tick` and `agents.simulate`); a calculation reading the clock keeps the sentinel example `{ in: {}, out: { tick: -1 } }`. Round 4 detail: now that the state is plain, the example's last-tick events are `[{t:4, integrated t3}]`, not the whole timeline; the whole timeline is checked through `agents.simulate`'s `events` output, which `collect` now makes possible without a log in the state. So this gap shrank a little.
- **Evidence:** test "the hand-derived tiny timeline is a contract example now ..."; test "the tiny world, driven".

### 14. A check used only for its verdict fails the lint, and a verdict cannot stop a drive: PARTLY RESOLVED
- **Round 6: PARTLY RESOLVED.** Unchanged.
- **Round 5: PARTLY RESOLVED.** Unchanged: nothing halts a drive on the first rejection.
- Unchanged. Nothing halts a drive on the first rejection; `until(outputs, k)` sees outputs only. F5c now shows the rejections as red cells with `✓ ✗` counts, which makes the scan after the drive visible but does not remove it.
- **Evidence:** F6b, F5c; test "the literal rule ... says so at the tick where it breaks" (26 rejections, first at tick 2).

### 15. `drive.each(k, stateRef)` was handed a plain value at tick 0 and a Ref afterwards: RESOLVED for the value
- **Round 6: RESOLVED for the value.** Unchanged.
- **Round 5: RESOLVED for the value.** Unchanged (the tick-0 difference between `world.drive` and `ctx.drive` is still only read in the source).
- My `each` receives a plain value and the test asserts it. Source read again in v0.4 (`src/kernel.mjs` lines 622 and 710): `world.drive` passes `stateRef = null` when the initial state is a plain value, `ctx.drive` passes the minted Ref. Not exercised by a test of mine (see 27).

### 16. Only `drive` can host time: PARTLY RESOLVED
- **Round 6: PARTLY RESOLVED.** Unchanged.
- **Round 5: PARTLY RESOLVED.** Unchanged.
- `agents.simulate` is one call that folds `agents.tick` with `ctx.drive`; now with `collect` it also returns the events directly. Still open: two tick contracts at different rates coupled by credits (24).
- **Evidence:** F7a/F7b; tests "ctx.drive: the whole simulation in ONE run ...", "nested clocks ...".

### 17. `gather` assembles but cannot flatten: RESOLVED
- **Round 6: RESOLVED.** Unchanged.
- **Round 5: RESOLVED.** Unchanged.
- `{ concat }`. Unchanged.

### 18. Slots: they fit as names: RESOLVED, and now scoped (see 21)
- **Round 6: RESOLVED.** `node.chosenBy` names the rung for every seat (test "specificity (v0.5) with chosenBy and fillReach (v0.6)"): primary `contract fill agents.allocate`, shadow `slot select agents.allocate#shadow`; F12a shows both on the implementation line.
- **Round 5: RESOLVED.** v0.5 orders the rungs: path fill, slot fill, `contract#*`, slot select, contract fill, contract select. A seat's select is a pin that a contract fill does not reach: test "specificity (v0.5)", F12a (primary greedy, shadow still exact-dp, regret says no). `contract#*` sweeps the pin on purpose: F12b (both greedy, regret green).
- `slot: 'primary'` and `slot: 'shadow'`, filled by `select('agents.allocate', exact-dp, 'shadow')`; v0.4 adds fills by path. F10 and F11 show both seats in one tick.
- **Evidence:** tests "slots (v0.3) ...", "audit seat ...", "path slots (v0.4) ...".

### 19. `driveToSvg` shows no verdicts and gets wide: RESOLVED for verdicts, OPEN for width
- **Round 6: RESOLVED for verdicts, OPEN for width.** Unchanged.
- **Round 5: RESOLVED for verdicts, OPEN for width.** Unchanged (F5a, F5c, F5d).
- v0.4 prints `✓ ✗` counts per tick cell and `← run r #c` origins. F5c is the literal-gate strip: ticks 0 and 1 `2 ✓ 0 ✗`, ticks 2 to 7 red `1 ✓ 1 ✗`. Width is still a problem: 36 cells do not fit, so the strips draw 8 or 12 ticks.
- **Evidence:** F5a, F5c, F5d.

### 20. `traceToSvg` `valueChars` does not widen the column: PARTLY RESOLVED
- **Round 6: PARTLY RESOLVED.** Unchanged.
- **Round 5: PARTLY RESOLVED.** Unchanged.
- Unchanged (defined behaviour: text is capped at the box width).

### 21. A fill for a slot that was declared but never consulted is accepted silently; slot names are not scoped: PARTLY RESOLVED
- **Round 6: RESOLVED.** Unchanged; the fill line now also prints reach (`@ #9`), so a landed key and a dead key differ in the picture as well as in `fillConsulted` (F12c).
- **Round 5: RESOLVED.** Both halves. A path fill that reaches no call is `BAD_FILL` (the round 4 test that accepted a path fill on a skipped shadow seat is the red test of this round, flipped); a flat slot key for the same dead seat stays accepted as standing configuration, and `receipt.fillConsulted` plus `traceToSvg(..., { receipt })` mark it `(not consulted)` (F12c, test "slots (v0.3) ..."). New friction with it: 40.
- Resolved: scope. A fill key can be `'agents.allocate#shadow/agents.scoreMatrix#scores'`, longest wins. In the test only the shadow seat's scoreMatrix is `flat`; the primary seat and the checker keep `weights`, the cache does not serve the old entry, a longer path beats the flat key, and a typo in a path segment is BAD_FILL. F11 shows the three seats.
- Still open: a declared path key is valid even when its seat is skipped (`audit: false`), so a dead fill is silent, one step up from round 3; the receipt still has no list of consulted fill keys.
- **Evidence:** test "path slots (v0.4) ..."; F11. New friction with it: 35.

### 22. `ctx.when` on a derived boolean records `computed`: PARTLY RESOLVED
- **Round 6: PARTLY RESOLVED.** Operand values for `at` paths print now (`="a1"`, `="reserve"`: F9). Still open: the filter-derived boolean "a completed task waits" is `read computed` (36).
- **Round 5: PARTLY RESOLVED.** Literal operands keep their value (seq 49), but an `at` operand into an object prints no value (37); the filter-derived boolean is still `computed` (36, seq 52 defers filters over arrays).
- Resolved for Refs and state: `ctx.when({ ne: [ctx.at(state,'integrator','task'), null] }, 'integrator busy', {true:'busy', false:'free'})` records a test with its operator and its path; F9c reads `integrator busy = true → ran busy, skipped free, read ne($in.state[integrator.task], null)`.
- Still open: "a completed task waits" is a boolean from a filter and a sort over the agent list. The condition language stops at scalar relations (`not and or eq ne lt le gt ge`), so it stays `read computed` with named branches `take oldest` / `nothing waits` (F6b `#4`, amber). New 36.
- **Evidence:** test "integrator decisions ..." (decision `from.kind === 'test'`, op `ne`, path `['integrator','task']`); F9c, F6b.

### 23. A drive has no start tick: RESOLVED
- **Round 6: RESOLVED.** Unchanged.
- **Round 5: RESOLVED.** Unchanged (`startTick`).
- `startTick` on `world.drive` (and `ctx.drive`, read in the source, not exercised). Test: resuming from the state of tick k with `startTick: k+1` gives exactly the original tail and the same final state; without it the tail differs (round 3's shifted-by-18 reproduction). F5d: `tick 18 / run 37 / ← run 18`, and all six resumed ticks are cache hits on the original runs.
- **Evidence:** test "world.ref and startTick (v0.4) ..."; F5d.

### 24. Nested clocks: OPEN
- **Round 6: OPEN.** Unchanged; seq 59 lists a tick segment in paths, not nested clocks (deferred in seq 52).
- **Round 5: OPEN.** Unchanged; seq 52 defers nested clocks.
- Unchanged: a tick folded inside a tick reads only the inner tick; test "nested clocks ..." still passes (101, 10101, 1010101). Ledger seq 43: deferred, one entry.

### 25. A cache hit carries its verdicts but not its decisions: RESOLVED
- **Round 6: RESOLVED.** Unchanged.
- **Round 5: RESOLVED.** Unchanged.
- Hits carry decisions. Test: a second drive's hit roots have the same `decisions` as the first; F8: the hatched root shows "shadow, regret = false → skipped" and cached verdicts now name their checks ("agents.evaluate: feasible; agents.capacity: done 2 <= N 3"). My facts script no longer needs `cache: false` for decisions.
- **Evidence:** test "integrator decisions ..." (second half); F8.

### 26. The only way to collect across ticks is to carry the log in the state: RESOLVED (for `ctx.drive`)
- **Round 6: RESOLVED (for ctx.drive).** Unchanged.
- **Round 5: RESOLVED (for ctx.drive).** Unchanged.
- See 4. The state is plain; the 25 percent extra time of round 3 is gone (104 to 112 ms against 138 to 241 ms for the round 3 module on the same kernel); the provenance in the kernel is one piece per tick call.
- Not resolved: the view of that provenance (34).

### 27. `each` and `ctx.drive` differ at tick 0, and `ctx.drive` returns only the last outputs: PARTLY RESOLVED
- **Round 6: PARTLY RESOLVED.** Unchanged.
- **Round 5: PARTLY RESOLVED.** Unchanged.
- `ctx.drive` now returns `collected: { port: Ref }` besides the last outputs and `ticks`. The tick-0 difference (`null` against a minted Ref) is unchanged, by reading the source; I do not exercise it.

### 28. A ternary became three contracts, one predicate and one composition: PARTLY RESOLVED
- **Round 6: PARTLY RESOLVED.** Unchanged (5 declarations, `res` is `else(lit)`).
- **Round 5: PARTLY RESOLVED.** Unchanged in cost (5 declarations); `res` is now `else: ['lit']`, so no second typed condition remains: restated guards 1 to 0 and typed complements 1 to 0 in the entry (see top). Each rule is still its own contract. New friction: 39.
- Resolved: the predicate. `agents.gateKind` is deleted; the two rules are `when` test conditions on `config.gate` and the result is `{ one: [...] }`. Seven declarations became five, helper contracts 1 to 0, and `agents.demand/gated` is one child per tick (F9a/F9b).
- Still open: each rule is still its own contract with examples and an implementation (`agents.demandLiteral`, `agents.demandReserve`), because a step calls a contract, not an expression. The untraced ternary `agents.demand/credits` stays beside it and gives identical runs.
- **Evidence:** test "demand gate (v0.4 test conditions + one) ..." (one child under `agents.demand`, decision `from.kind === 'test'`, op `eq`, `agents.gateKind` no longer exists); F9a/F9b.

### 29. Skipped steps announce themselves on every tick: PARTLY RESOLVED
- **Round 6: PARTLY RESOLVED.** Both sides of a condition now leave rows (38), the view still merges equal causes: "shadow, regret = false → skipped" and "shadow, regret = true → ran" read as mirror images.
- **Round 5: PARTLY RESOLVED.** Unchanged: the record stays per step (seq 51 declined merging), the view merges equal causes. With inherited skips the merged row is now "shadow, regret = false → skipped" although `regret` is skipped by inheritance, not by its own guard.
- v0.4 merges identical decisions: the two skipped audit steps on a tick root are one row ("shadow, regret = false → skipped, read $in.config[audit]", F5b). The demand node still shows the unused rule as a grey row. One row per tick instead of two, still on all 36.

### 30. A decision row from an `at` path says "read at" and drops the path: RESOLVED
- **Round 6: RESOLVED.** Unchanged.
- **Round 5: RESOLVED.** Unchanged.
- Printed as `read $in.config[audit]` and `read $in.state[integrator.task]` (F5b, F10, F9c). New wrinkle: 33.

### 31. A check forces `accepted: false` to mean both "invalid" and "suboptimal": OPEN
- **Round 6: OPEN.** Unchanged.
- **Round 5: OPEN.** Unchanged; seq 52 defers graded checks. F12b adds a second way an audit reads green for the wrong reason: both seats greedy.
- Unchanged: `agents.regret` rejects at five of 36 ticks of the N=3 audit run and the test "constraints are never violated" filters verdicts by contract. F11 adds a case I had not claimed: with the shadow's scoreMatrix replaced by `flat`, the five regret rejections become zero, because the shadow now scores on another scale and the comparison measures nothing. A check cannot say that its two sides are comparable.
- **Evidence:** F10, F11; test "path slots (v0.4) ..." (regret rejections 5 to 0).

### Round 1 "suspected kernel surprises"
- Hashing cost: resolved in round 2. "Cache hits drop `from` on outputs": the hit roots in F8 and F5d show `← run r #c` origins, so this is no longer a surprise.

## B. New friction from v0.4 (32 to 36), v0.5 (37 to 41) and v0.6 (42 to 45)

Each point ends with one line from Hegel (what the concept would want) and one from Wittgenstein (what the actual use here shows, with the evidence).

### 32. `one` proves nothing in advance; the exclusivity is paid for twice
- **Round 6: RESOLVED for provable overlap.** Unchanged.
- **Round 5: RESOLVED for provable overlap.** `one` fails at assembly for an unconditional alternative and for a condition that implies another (test "one (v0.4, extended in v0.5) ..."); two `eq` of one path against different literals pass; `else` derives the complement. What the lint cannot prove (two overlapping `ne`) is still `AMBIGUOUS_BRANCH` at run time. Exhaustiveness is still the input schema's job (39).
- **Needed:** "exactly one demand rule ran", where the rules are `gate = literal` and `gate = reserve`.
- **Kernel today:** `{ one: [...] }` raises `AMBIGUOUS_BRANCH` when several are live and `NO_BRANCH` when none is. Both are run-time errors found on the first input that triggers them. The two guards are written as two separate conditions (`eq gate 'literal'`, `eq gate 'reserve'`); two equalities of the same path against different literals are exclusive by construction, and the lint does not know it. In the test, overlapping guards (`ne gate 'nothing'`, `ne gate 'nowhere'`) assemble fine, throw `AMBIGUOUS_BRANCH` at run time, and under `first` silently give limit 4 where reserve says 3. That the third enum value is impossible is held by the input schema (`INPUT_SCHEMA` for `'other'`), not by `one`.
- **Workaround:** none needed for the entry; the schema enum carries exhaustiveness.
- **Proposed shape:** the lint treats `eq(x, a)` and `eq(x, b)` on the same operand, `a != b`, as exclusive, and with an enum schema on the operand checks exhaustiveness at assembly (`one` then needs no run-time guard in the common case).
- **Severity:** ergonomic; the failure is loud, so it never gives a wrong answer.
- **Hegel would say** a branch is only a branch against its sibling, so exclusivity belongs to the pair, not to each member. **Wittgenstein would say** my two guards are one enum read twice, and the kernel found out only by running them: test "one (v0.4) ...".

### 33. A string operand loses its value in the recorded decision
- **Round 6: RESOLVED.** Literals kept (round 5) and the other operand too (audit fix): F9a and F9b differ.
- **Round 5: RESOLVED for literals.** `{kind:'literal', value:'literal'}` in the decision (test asserts `args[1]`); the rows now read `eq($in.config[gate], "literal")`. The observed value of the other operand is still not printed (37), so F9a and F9b read the same for `lit`.
- **Needed:** to read, in a picture, which demand rule's guard was true.
- **Kernel today:** the decision's provenance for `{ eq: [{ at: ['$in.config','gate'] }, { literal: 'reserve' }] }` is `eq($in.config[gate], literal)`: the operand is `{kind:'literal'}` with no value. A bare `null` in `ne(..., null)` keeps its value (`ne($in.state[integrator.task], null)`). F9a and F9b, `lit` and `res` alike read `eq($in.config[gate], literal)`; the F6b tick shows `lit = true → ran` and `res = false → skipped` with identical text. The reader has to open the child to learn which rule ran.
- **Workaround:** the child's contract name (`agents.demandReserve`, `agents.demandLiteral`) is the real marker; the claim F-37 about telling them apart by the row failed.
- **Proposed shape:** record the value of a literal operand (it is already a value in the spec), printed as `eq($in.config[gate], "reserve")`.
- **Severity:** view and provenance; a defect more than a missing concept.
- **Hegel would say** a comparison is a comparison with something, and the something is part of the judgment. **Wittgenstein would say** a test whose rows read the same in both branches has stopped being a ground: F9a against F9b.

### 34. The view flattens the `at[k]` selection of a collected gather
- **Round 6: PARTLY RESOLVED.** Unchanged apart from ticks on the state/counts rows and on the last piece: the ladder `pieces ×3 pieces ×4 ...` stays, and my round 6 claim that every label names its tick FAILED (F-52). New 43.
- **Round 5: PARTLY RESOLVED.** The `pieces ×72` wall is gone (F7a root `events` is about 24 labels, none ×72). What is left is a ladder `pieces ×3 pieces ×4 ...` with singles labelled `[12]gather[28]←[0]`; groups do not name their tick.
- **Needed:** to see, on `agents.simulate`'s root, that event j came from tick k's `events` and nowhere else.
- **Kernel today:** the kernel's provenance is exact (test: each output event is `at[j]` of `at[k]` of one gather whose piece k is tick k's call). F7a's root `events` row is a wall of about 72 repeated "pieces ×72" labels: the view's source summary drops the `at[k]` selection, so every event reads as coming from all 36 tick calls. Correct data, a picture that over-approximates, which is a worse false provenance than a missing one.
- **Workaround:** the test asserts the exact provenance; the picture draws four of 36 children and I read the provenance from the facts file (`eventPieces: 72`).
- **Proposed shape:** `sources()` keeps the selection (`events[k][j]`) or collapses to "tick k, event j" per element, and groups the 72 into 36 ranges.
- **Severity:** view only.
- **Hegel would say** a part is determined by its place in the whole, and a label that drops the place drops the part. **Wittgenstein would say** the wall of "pieces ×72" is what I see on the one picture where I wanted to check provenance: F7a.

### 35. Path slot keys are strings, can silently make an audit meaningless, and a second implementation forces `select`
- **Round 6: PARTLY RESOLVED.** Pin trampling gone (round 5). `world.select` after a second implementation is still needed. The audit made meaningless by a path fill is still possible (F11 `#12` is flat and the root says "regret = true → ran" all the same).
- **Round 5: PARTLY RESOLVED.** Pin trampling is gone (F12a). Still: a second implementation of a contract needs `world.select` to keep other callers unambiguous (test "path must land ..." needed another one for `demandLiteral`), and a valid path fill can still make the audit meaningless (F11, shadow scored on another scale). Path keys are still hand-assembled strings.
- **Needed:** to steer one seat's scoring (the shadow's) without touching the primary seat or the checker.
- **Kernel today:** the key `'agents.allocate#shadow/agents.scoreMatrix#scores'` works, a typo is `BAD_FILL`, a longer path beats the flat key. Costs: (a) the key repeats `contract#slot` at every hop and is a string I assemble by hand; (b) a valid fill can change what the audit measures: with `flat` scores in the shadow, regret rejections fall from 5 to 0 (F11) and the receipt reports success; (c) registering `agents.scoreMatrix/flat` made the contract's default AMBIGUOUS for every plain caller, and I had to `world.select('agents.scoreMatrix', 'agents.scoreMatrix/weights')` in `register` (ledger seq 43 lists "select pins that beat contract fills", one entry).
- **Workaround:** `select` in `register`; the test pins the primary seat and the checker to `weights` and asserts the shadow is the only flat seat.
- **Proposed shape:** `implement({ ..., default: false })` for an implementation that exists only to be named by a fill; path fills as an object (`{ 'agents.allocate#shadow': { 'agents.scoreMatrix#scores': ... } }`) or checked for contract and slot existence against the composition.
- **Severity:** ergonomic for (a) and (c); (b) is a design hazard rather than a kernel fault.
- **Hegel would say** a seat is defined by what surrounds it, so the path that names it is part of its identity. **Wittgenstein would say** my one use was "make only the shadow different", and what it taught me was that two seats on different scales are not an audit: F11 `#10` against `#12`.

### 36. The condition language stops at scalar relations
- **Round 6: OPEN, deferred (seq 52: filters over arrays).** Unchanged.
- **Round 5: OPEN, deferred (seq 52: filters over arrays).** Unchanged: "a completed task waits" is `read computed` (F6b `#4`).
- **Needed:** "a completed task waits" as a test (some element of the agent list has `done` and is not yet integrated), with the ground named.
- **Kernel today:** `not and or eq ne lt le gt ge` over scalars and paths. A filter, a sort and an `any` over a list are not expressible, so the boolean is computed in the implementation and recorded as `read computed` (F6b `#4`, amber, with named branches `take oldest` / `nothing waits`). It is the last decision in the entry that cannot name what it was about (22).
- **Workaround:** the branch names carry the meaning; the ground stays `computed`.
- **Proposed shape:** `ctx.when(bool, label, branches, { of: [refs] })` (the round 3 shape), or a `some`/`every` over a path with a sub-condition.
- **Severity:** ergonomic.
- **Hegel would say** a decision that cannot name its ground is a mood. **Wittgenstein would say** half of my integrate decisions now read as tests and the other half as "computed": F9c above, F6b `#4` below it.

### 37. Operand values are printed for scalar inputs and literals, not for an `at` path into an object
- **Round 6: RESOLVED.** Fixed in the audit response: operand values for `at` paths print (F9a `="reserve"`, F9b `="literal"`, F9c `="a1"`, F5b `$in.config[audit]=false`). My round 5 claims F-37 and F-46 would now pass.
- **Needed:** to read in a picture which side of `eq($in.config[gate], "literal")` held, and which task `ne($in.state[integrator.task], null)` saw.
- **Kernel today:** v0.5 keeps literal operands (the `"literal"` is there) and prints values for plain input operands (`read $in.accepted=true` on F10 `#16`). An `at` into the config or the state prints only the path. F9a (gate `reserve`, `lit` false) and F9b (gate `literal`, `lit` true) both print `eq($in.config[gate], "literal")`; F9c, F7b `#65` and F5b `#4` print `ne($in.state[integrator.task], null)` whichever task it was. My round 5 claim that F9a and F9b would differ in text FAILED (F-37, F-46).
- **Workaround:** the row's `true` or `false` and `ran` / `skipped` carry the result; the operand stays unseen.
- **Proposed shape:** print the short value of every operand, as for scalar inputs (the value is a string or null here, `"reserve"` and `"a1"`).
- **Severity:** view only.
- **Hegel would say** a comparison is its two sides, and half of one is a stub. **Wittgenstein would say** the rule for printing values is "if it is a plain port"; my two cases both sit one `at` deeper: F9a against F9b, F9c.

### 38. An inherited skip hides that the step was conditional
- **Round 6: RESOLVED.** Seq 53: `regret` records `ran` with shadow's cause; the root reads "shadow, regret = true → ran" when the audit runs and "shadow, regret = false → skipped" when it does not (F10, F12a, F5b). The red test of this round (my audit-seat test) is flipped to assert it. What is left: the composition source still shows `regret` without a `when`, and a reader of the source has to know the rule.
- **Needed:** to read, from the composition and from the trace, that `regret` only runs when the audit does.
- **Kernel today:** `regret` has no `when`: it reads `shadow.score`, so it inherits shadow's skip. Good: the guard is written once. But in the pipeline source nothing on `regret` says it is conditional, and in the record a step that runs because its producer ran has no decision at all: F10's root says "shadow = true → ran" only (round 4 said "shadow, regret = true → ran", because I had typed the guard twice). The test asserts the asymmetry: with audit off `regret` has its own decision row (cause `$in.config[audit]`, deep-equal to shadow's); with audit on it has none.
- **Workaround:** a comment on the step; the test.
- **Proposed shape:** record `ran` for inherited steps too (the view already merges equal causes, so the row would read "shadow, regret = true → ran"), or a `conditional: true` mark on the node.
- **Severity:** view and provenance; nothing computes wrongly.
- **Hegel would say** what depends on something that happened happened because of it, and that is as worth recording as the negation. **Wittgenstein would say** the skip was recorded because it needed explaining; the run was not, because it needed none: and I opened F10 to find out whether `regret` was conditional and could not tell.

### 39. `else` moves exhaustiveness into the schema and the name of the case out of the picture
- **Round 6: PARTLY RESOLVED.** `else(lit)` prints short with an edge (F9a, F9b); the case name `reserve` still appears only as the child's contract name. Seq 54 added: `else` is skipped when the step it names was skipped by inheritance (not applicable to my domain: `lit` is skipped by its own condition).
- **Needed:** the reserve rule to run for every gate that is not `literal`, and to read "reserve" somewhere.
- **Kernel today:** `res` is `when: { else: ['lit'] }`, so there is no second typed equality (the typed complement is gone). Two consequences: (a) the only thing that stops a third gate value from silently taking the reserve rule is the enum on `config.gate` (the `INPUT_SCHEMA` error for `'other'`, asserted in the `one` test); the round 4 typed `eq gate 'reserve'` plus `one` would have failed with `NO_BRANCH` instead. I did not exercise a widened enum because the contract's schema forbids it. (b) The picture reads `res = true → ran, read else(lit: eq($in.config[gate], "literal"))`: the reader must invert it; the word `reserve` appears only in the child's contract name `agents.demandReserve` (F9a, F5b `#6`).
- **Workaround:** none; the child's contract name is the label.
- **Proposed shape:** `else` for the common case, and a named-case test (`{ eq: [x, 'reserve'] }`) stays available; with an enum schema on the operand the lint checks the cases are exhaustive (as in 32).
- **Severity:** ergonomic, with a safety question for (a).
- **Hegel would say** a branch and its other are one concept, so deriving the other is right, but the concept's second moment has a name. **Wittgenstein would say** nobody typed "less than or equal" on purpose, but I did type `reserve` on purpose: the ledger line is true of a threshold and not of an enum, and F9a reads worse than round 4's typed row did for exactly that reason.

### 40. A path fill must land, and landing is decided by the run: one fill set cannot serve a sweep
- **Round 6: RESOLVED (by naming the game).** `landing: 'none'` lets ONE fill table serve both gates: F12d lands (`@ #7`), F12e misses (`(not consulted)`), no error; test "a path fill must land (v0.5) and landing: 'none' (v0.6) ...". Default stays strict, `'all'` is stricter, typos fail in every mode except one (42).
- **Needed:** to run the same experiment over both demand gates with a fill that replaces the literal rule.
- **Kernel today:** `'agents.demand/agents.demandLiteral'` lands under gate `literal` (`receipt.fillConsulted` lists it) and is `BAD_FILL` ("reached no call") under gate `reserve`, where the literal rule is never called. The same holds for `'agents.allocate#shadow/...'` with audit off (the red test of this round). So a loop over configurations has to build the fill per configuration (test "a path fill must land is evaluated per drive ...").
- **Workaround:** build the fill per configuration, as the test does.
- **Proposed shape:** a fill option `lenient: true` (or `fillMode: 'configuration'`) for sweeps, keeping the strict default; or the loud failure carrying which configuration value skipped the seat.
- **Severity:** ergonomic; the failure is loud, so it never answers wrongly.
- **Hegel would say** a path aims at one place in the whole, and a whole in which that place does not occur has no use for it. **Wittgenstein would say** "did it land?" is the right question of a path (seq 47), and in a sweep the honest answer for half the runs is no: evidence the gate sweep in the test, and the flat key for the same dead seat that is accepted and marked `(not consulted)` in F12c.

### 41. The picture shows which implementation a seat has, not which rung chose it
- **Round 6: RESOLVED, with a residue.** `node.chosenBy` and the rung on the implementation line: F12a `#9 by contract agents.allocate`, `#11 by pin agents.allocate#shadow`; F12b both `by every-slot agents.allocate#*`; F11 `#12 ⚑ by path ...`. Residue: a contract select and the only implementation print nothing, so a default and a decision look the same (44).
- **Needed:** at F12a and F12b, to read why `#11 agents.allocate#shadow` is exact-dp in one and greedy in the other.
- **Kernel today:** six rungs (path fill, slot fill, `contract#*`, slot select, contract fill, contract select) and `receipt.fillConsulted`, which prints the fill line under the title (F12a `fill: agents.allocate → agents.allocate/greedy`, F12b `agents.allocate#* → ...`). The seat's own header reads only `agents.allocate/exact-dp` or `agents.allocate/greedy`. To know that the pin held in F12a and was swept in F12b, the reader has to know the order of the six rungs and which key reaches which seat.
- **Workaround:** the F12 titles say it; the test asserts it by seat.
- **Proposed shape:** each node's header (or `node.chosenBy`) names the rung and key: `via select(allocate, slot shadow)`, `via fill allocate#*`.
- **Severity:** view and provenance.
- **Hegel would say** a seat is determined by what determined it, and the rung is part of the answer. **Wittgenstein would say** the fill line is a list of rules and the seat is a case, and I must apply the rules by hand: F12a against F12b.

### 42. A slot name that does not exist inside a path segment is not a typo under `landing: 'none'`
- **Needed:** a sweep with one fill table that still catches a mistyped key.
- **Kernel today:** under `landing: 'none'`, a flat slot typo (`'agents.demandLiteral#nobody'`) and a contract typo in any segment (`'agents.nope/agents.demandLiteral'`) are `BAD_FILL`, as KERNEL says. But `'agents.demand/agents.demandLiteral#nobody'` and `'agents.demand#nobody/agents.demandLiteral'` run without error: the slot names inside path segments are only checked by landing, and landing is switched off. Under the default landing the same keys are caught, only as "reached no call". A sweep cannot tell "missed on purpose" from "misspelt". The mode is also one setting for the whole table: there is no way to say "this key must land in every run, that one may miss".
- **Workaround:** the test asserts the behaviour; in practice I validate path keys against `world.contracts()` slots myself.
- **Proposed shape:** check the slot name of every path segment against the slots declared by the named contract (as for a flat key), in every mode; and, if a sweep wants it, `landing` per key.
- **Severity:** distorts silently in a sweep (a mistyped path fill does nothing and says nothing).
- **Hegel would say** a name is checked against the whole of what it could name, and landing is one question, existence another. **Wittgenstein would say** my sweep asked "did it land?" of a key that never could: test "a path fill must land (v0.5) and landing: 'none' (v0.6) ...", the two `doesNotThrow` lines.

### 43. The gather label numbers positions, and the tick appears on one label only
- **Needed:** to read, on `agents.simulate`'s `events` row, which tick each event came from.
- **Kernel today:** `[12]gather[28]←[0]` means piece 12 of the concat comes from position 28 of the flattened collected gather, event 0 of its list; `gather[28]` is an event index (of 72), not a tick index (of 36). The tick appears as `←@35` on the last label only, and not at all on the grouped `pieces ×3 pieces ×4 ...` (F7a). The state and counts rows carry `←@35`. My claim that every label names its tick FAILED (F-52).
- **Workaround:** the test asserts the exact provenance (each event is `at[j]` of `at[k]` of one gather); the picture is read with the facts file (`eventPieces: 72`).
- **Proposed shape:** name the tick on every label or group (`@3 ×4`), and label positions with a word (`event 28`) when they are not ticks.
- **Severity:** view only.
- **Hegel would say** a part is its place in the whole, and the place here is a tick. **Wittgenstein would say** the one label that names a tick is the one I did not need: F7a.

### 44. A default and a decision print the same way: nothing
- **Needed:** at F1b and F5b, to tell whether the greedy allocator is there because it is the only one, or because somebody selected it.
- **Kernel today:** `node.chosenBy` is `{ rung: 'contract select', key: 'agents.allocate' }` for the primary seat (and `only implementation` for the rest), but the implementation line prints a rung only for fills and slot selects (`by contract agents.allocate` in F2c, `by pin ...` in F12a). A seat chosen by `select(allocate, greedy)` reads like a seat with one implementation (F1b `#9`, F5b `#9`, F10 `#9`).
- **Workaround:** the test reads `chosenBy` (`{ primary: contract select, shadow: slot select }`).
- **Proposed shape:** print every rung except `only implementation`, or print `by select` for the two select rungs.
- **Severity:** view only.
- **Hegel would say** a choice that was made is a determination, and silence says there was none. **Wittgenstein would say** a reader who sees `by contract agents.allocate` in F2c and nothing in F1b concludes F1b was not chosen: F1b against F2c.

### 45. A trajectory failure shows the inputs of `each`, not the state that came in
- **Needed:** when the tiny timeline fails at tick 1, to see what state tick 1 started from.
- **Kernel today:** a failing trajectory lists every wrong tick as `tick k: expected X got Y` and appends `(inputs ...)` for `each` inputs. My tick has no `each`; its input is the carried state, which the message does not show. The mutant integrator in the test fails at ticks 1, 2, 3 and 4 (a cascade), and the message gives no hint that only tick 1 is the cause.
- **Workaround:** read the first wrong tick; the later ones follow from it.
- **Proposed shape:** the first wrong tick with its incoming state hash (a cross-run Ref), the later ones marked "after a wrong tick".
- **Severity:** ergonomic.
- **Hegel would say** a wrong moment makes every later moment wrong, so only the first is a finding. **Wittgenstein would say** the message I need is the one for tick 1; test "the tiny world, driven", `tick 1: expected` followed by three more.

## C. What fitted cleanly in rounds 4, 5 and 6 (also evidence)

- Test conditions: `eq` and `ne` on an `at` path replaced a predicate contract, an implementation and an example set; the 12 behaviour combinations did not move.
- `ctx.when` with a test and named branches: `integrator busy = true → ran busy, skipped free` reads as a sentence (F9c).
- Decisions on cache hits: the hit root says what the original decided, and the cached verdicts name their checks (F8).
- `startTick`: the resumed drive reproduced the original tail exactly and hit the original cache entries (F5d).
- `collect` on `ctx.drive` took the log out of the state: simpler schema, 15 calls per tick, 541 calls for the whole run, faster than round 3, with exact provenance in the kernel.
- Path slots: one seat different, the others untouched, with a typo caught (F11).
- View: merged identical decisions, `✓ ✗` counts, `← run r #c` origins make F5c and F5d readable at a glance.
- Content-addressed state and replay for determinism: unchanged and still the cleanest part.

### Round 5 additions

- `else` and inherited skips: the audit's `regret` lost its guard, the demand's `res` lost its second condition; behaviour unchanged (12 combinations).
- Examples over time: the hand-derived timeline is a `trajectory` example, and `prove` pins a wrong tick (a mutant integrator is reported at "tick 1"); the clock is proved at a tick. This replaced a hand-kept list in a test.
- Specificity: a pin on one seat survives a contract sweep (F12a), `#*` is the explicit "every seat" (F12b), and the audit stays honest in the first case.
- `receipt.fillConsulted` and the receipt fill line: a dead slot key is marked, a dead path key fails; no silent fill is left in my entry (F12c).
- The view: an `at` into a gathered value draws only its pieces, long expressions break, so F9 and F6c read.

### Round 6 additions

- Inherited runs: both sides of the audit condition now leave the same rows (F10 and F5b read as mirror images), and the red test flipped cleanly.
- `fillReach` and `chosenBy`: three trace scans in the entry became lookups by id; the fill line says where a key landed (`@ #9`).
- `landing: 'none'`: one fill table over two gates (F12d, F12e) instead of a table per gate.
- Named examples: `prove` now reads as sentences ("the tiny world, tick by tick: ok").
- The audit's view fixes: separate gutter lanes (F6b, F6c), values on `at` operands (F9), one line per cached verdict (F8).

## D. The two deferred questions, with round 4 and round 5 evidence

### Demand / request(n): unchanged, and v0.4 makes it slightly less pressing
- The demand gate is now two test conditions and a `one`, one child per tick (F9). The round 2 detour of computing demand outside the kernel in `each` still has no motive; I re-ran it: 94, 37, 35 ticks against 79, 36, 35 inside the tick for N = 1, 3, 8, stale by one tick, no provenance.
- The coupled-clock case (integrator and worker pool as two tick contracts at different rates joined by credits) is still stopped by nested clocks (24), not by anything `request(n)` would provide. One requester remains; the deferral stands.

### Round 5 on both questions

- Demand / request(n): unchanged. The gate is `lit` plus `else`; there is still one requester (ledger seq 52 does not list it as a new ask).
- Implementation parameters: v0.5 does not change the evidence. `receipt.fillConsulted` and the receipt fill line show which fills served a run, which helps when the parameter is an implementation (a fill key that names one) and does nothing when it is a closure. Test "implementation parameters (FRICTION 7, now more costly) ..." still passes unchanged.

### Round 6 on both questions

- Demand / request(n): unchanged; the gate is `lit` plus `else(lit)`.
- Implementation parameters: deferred again (seq 59). The ledger's reason is that the staleness is through state the kernel cannot see; v0.6 does not change my evidence (the knob test is unchanged and green), and I accept that a detector is impossible. What the kernel could offer is the convention: an implementation declares the outside state it reads, and the declaration is hashed. `chosenBy` and `fillReach` now give that convention somewhere to be printed (the implementation line).

### Implementation parameters: v0.4 does NOT change the evidence; still the most dangerous open item
- The knob test is unchanged and green: a mutable knob outside the hashes, changed between two drives, gives 36 of 36 root hits and the old schedule; `cache: false` gives the other; a knob made an implementation gives zero hits.
- What v0.4 offers near it: path fills let the workaround (a parameter is an implementation) target one seat, and `x-` annotations can label ports. Neither puts an implementation's parameter in its key (annotations belong to the contract's ports; not tested whether they reach a hash). F11 shows the workaround's price: the audit became meaningless when one seat was swapped (35). Ledger seq 43 says to revisit first if a second entry reads mutable state; I have no new second entry's evidence, only a sharper version of mine.

## E. The one kernel change I want next

**A declared-parameters convention for implementations** (for example `implement({ id, params: { strong: 10 } })`, hashed with version and inputs, printed on the implementation line next to the rung, overridable per fill including by path). Seq 59 is right that the kernel cannot detect a closure; it can offer the place to say it.

Evidence, round 6: unchanged and green (knob test: 36 of 36 stale root hits, old schedule). The other open items either fail loudly (24, 32 residue), are ergonomic (28, 35, 36, 39, 45), or are view and provenance (34, 43, 44); the one that distorts silently besides this is 42 (a mistyped path key under `landing: 'none'`), and that is a one-line check against declared slots, not a concept. If the ledger still wants a second requester first, take 42 and 44 now.

## F. Five rounds back: the concept that changed my domain most, and the one I would remove

**Changed most: the tick contract with a state port, `ctx.tick()` as a cache dependency, and the drive (`startTick`, `collect`).** Written from scratch today, my entry would start from a single `agents.tick` contract and its `trajectory` example (the hand-derived timeline, tick by tick), and the Gantt would be a picture of its receipts; in round 1 I wrote an event list and a loop in the host, and the simulation lived outside the kernel. Evidence from this entry: the 13-event timeline moved from a hand-kept test list into a contract example that `prove` checks per tick and that a mutant integrator breaks at "tick 1"; the whole 36-tick run is one call with 541 provenance-carrying nodes; a resumed drive hits the original cache entries (F5d); and removing `pure: false` (round 3) turned 36 uncacheable ticks into 36 root hits. Nothing else changed what I would put on a contract.

**I would remove: `{ first }`.** Every real use I had was "exactly one of these" (`one`) or "otherwise" (`else`); `first` is the form that gives an answer when two conditions overlap. In the test "one (v0.4, extended in v0.5) ..." the same overlapping guards give `AMBIGUOUS_BRANCH` under `one` and silently give limit 4 (the literal rule) where the reserve rule says 3 under `first`; the entry has not used `first` since round 4. `returns` still names `first` or `one` at the boundary; I would leave only `one`, with `else` for the derived side. Runner-up: the contract-level `fill` key as the default way to choose an implementation (`prove` and my gate sweep use it as a sweep, and F12 shows what a sweep does to a pinned seat); with `contract#*` in the language, a bare contract key says less than it appears to.

**Round 6 note on the removal vote:** ledger seq 58 declined removing `first` because B and C use it for "this or the input unchanged". I accept that: my entry's evidence (overlap under `first` silently gives limit 4 where reserve says 3) is one entry's lack of use, not the language's. The vote stands for my domain only.

## G. Round 6 retrospective: where the kernel's picture of my domain and the domain's own picture disagree most

**An agent working through time.** My domain pictures itself as agents in rows and ticks on an axis: the Gantt (F3) shows sA busy 0 to 4, the integrator busy 3 to 35 with no idle gap, six of ten agents ever working. The kernel pictures calls: a tick is one box with fifteen children, and a task running for four ticks is a field in a state value that every tick rewrites; an agent, a task or an integrator slot is never a node. The only place time appears in the kernel's picture is the drive strip (F5a), and it shows counts (`r5 w3 d0 i0`), not who.

What a reader of my kernel pictures gets wrong because of it:
- That the integrator bottleneck is invisible or absent. In F5a ticks 3 to 35 all read `2 ✓ 0 ✗` and look alike; the fact that the integrator is busy at 16 of those ticks is one row, `integrator busy = true → ran busy`, inside 16 separate tick pictures (F9c is one of them, F7b another), and `integratorBusyDecisionTicks: 16` exists only in the facts file. In the kernel's picture the bottleneck is a property of no node.
- That a red `agents.regret` box (F10, F12a) means the schedule is wrong. It means the shadow seat scored 10 higher on a seat that does not decide anything; the schedule is the primary seat's, and the Gantt is identical with the audit on (test "audit seat").
- That an `assignments` value in a trace is a decision made by a node called `a1`: it is text inside `#9`'s output, and the only nodes that exist are allocate, evaluate and commit.
Evidence: F3 against F5a and F10; the facts file's `gantt3` section; the test that derives the 16 busy ticks from decisions and compares them with the event log.
