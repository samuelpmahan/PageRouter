# Contest C · friction report (round 1, with round 2 status on kernel v0.2, round 3 status on kernel v0.3 and round 4 status on kernel v0.4, round 5 status on kernel v0.5 and round 6 status on kernel v0.6)

Domain: models fitted on training data and applied to new inputs. Entry `c-fitted`, 26 tests in `test/contest-c-fitted.test.mjs` (14 in round 2, 8 new in round 3, one of the 14 flipped; round 4 flipped four and added three; round 5 flipped three and added one; round 6 flipped two (tests 15 and 18) and extended one (21), still 26 tests).

## What a fitted model is here (round 2)

A fitted model is a plain Part, always a tagged object: `{kind:'standardizer', means, sds}`, `{kind:'linear', coefficients}`, `{kind:'constant', value}`, `{kind:'kmeans', centroids}`. A `*.fit` contract has a `model` output port, a `*.apply` / `*.predict` contract has a `model` input port, and the Ref is handed from one to the other. Fit and apply are **two contracts** per family: they run at different times on different data and share only the model schema.

Round 2 answers to the four questions in the brief:
- **Trace of an apply names the fit that made its model?** Yes, in one run (picture 1c) and across runs when the model is passed as a Ref (pictures 6, 6c): the apply's `model` input carries `{kind:'run', run, from}` and `lineage.mjs: resolveProducer` follows it to the `*.fit` node, through a pipeline's output port if needed.
- **Stale model detectable?** Yes for an apply that holds a Ref: `stalenessOfApply` follows the edge to the fit call and compares that call's recorded input hashes with the data now in hand. No for a model that arrives as a plain value; then only `producersAcrossRuns` (a scan of `world.runs()`) remains. Equal Parts from different fits cannot be told apart by hash; the edge can.
- **Where each field of a model came from?** Yes: models are built with gather, and `fieldOrigins` reads the pieces (pictures 7, 7b).
- **One contract or two for fit/apply?** Two. Nothing in v0.2 pushed toward one.

## Round-1 points: status (round 6 column added)

| # | Point | Round 2 status | Round 3 status | Evidence | Round 4 status | Round 5 status | Round 6 status |
|---|---|---|---|---|---|---|---|
| 1 | Building a model value from call results | Resolved | **Resolved** | tests 'fit then apply: ...'; pictures 7, 7b. v0.3 added nothing here; `concat` is the same idea for arrays (see N12) | **Resolved.** `collect` gives an array of states the same way (picture 3b `history`, three brackets) | **Resolved** | **Resolved.** `history` labels now name their tick (`gather[2]←@2`, picture 3b) |
| 2 | Seed is not in the cache key | Resolved | **Resolved** | test 'seeded randomness is never served from cache: ...'. v0.3: `kmeans.fit` is still impure, but its tick children are cache hits on a repeat with the same seed (test 'v0.3 ctx.drive', picture 3b header `impure`) | **Resolved.** `kmeans.fit` is still impure; a drive resumed with `startTick` hits the cache entries of the uninterrupted drive (test 'FRICTION v0.4 guard restated...', second half), because the tick never reads its clock | **Resolved** | **Resolved** |
| 3 | A model that crosses a run boundary loses its producer | Resolved for Ref, open for plain values | **Resolved for Ref, open for plain values.** New: `world.ref(run, call, port)` addresses a model made INSIDE a pipeline run | test 'v0.3 addressing' (apply of `world.ref(run, 7, 'model')` resolves to fit #7 through the edge); picture 6c, row 4. Plain value: unchanged (picture 6c, run 21) | **Resolved for Ref, open for plain values.** Unchanged; `world.node` being indexed (seq 40) changes only speed here | **Resolved for Ref, open for plain values** | **Resolved for Ref, open for plain values** |
| 4 | Model family is checked only at run time, lint blind | Open | **Open** | test 'a model of the wrong family is refused at run time, but assembly lint cannot see it' passes unchanged | **Open.** Unchanged (test 'a model of the wrong family...' passes as before) | **Open** | **Open** |
| 5 | Fit/apply pairing is a naming convention | Open (deferred) | **Open (deferred); need unchanged, evidence sharper.** See N8 | tests 'role annotation is still needed: ...', 'v0.3 tick state is a model in progress: ...' | **Resolved in practice by `x-role`**: lineage no longer matches names (C-31). The kernel still has no fit/apply kind and nothing needs one; N8 below | **Resolved in practice by `x-role`** | **Resolved in practice by `x-role`** |
| 6 | "Train only" is a property of the trace | Partly resolved | **Partly resolved.** v0.3 fixed what was fragile about the check: its verdict now survives a cache hit | test 'v0.3 cached verdicts: ...'; picture 11 (C11b #42 `1 cached verdict`). The check still judges Parts, not provenance (N6) | **Partly resolved.** The check is unchanged. The outside `trainOnly` now reports `null` when it recognised no fit, instead of `true` (test 'v0.4 x-role: ...'); `x-role` alone does NOT make the vacuous answer go away (N17) | **Partly resolved**; unchanged | **Partly resolved**; unchanged (see the last item of the round-6 retrospective) |
| 7 | Examples compare whole ports; `seed` undocumented | Open | **Partly resolved.** `seed` is documented, examples take `fill` and `ticks`, implementations carry examples. A port is still compared whole, so a string port has no tolerance (N13) | test 'every contract example ... proves ...' (step example with `ticks: 2`, audit example with `fill`, two implementation examples) | **Partly resolved.** Unchanged (N13) | **Partly resolved, better.** `trajectory` examples check a tick contract tick by tick inside `prove` (C-38); a string port still has no tolerance (N13) | **Partly resolved.** Examples take `name`, a failing trajectory tick ends with its inputs; a string port still has no tolerance (N13) |
| 8 | Models equal up to permutation are different Parts | Open | **Open** | `kmeans.fit` still sorts centroids; picture 3b labels show the sort (`gather[0]<-[centroids.1]`) | **Open.** Unchanged; picture 3b model labels still show the sort | **Open** | **Open** |
| 9 | Value-equal Parts have different hashes (OLS leak 1.8e-15) | Open | **Open** | test 'leakage: ...' unchanged; picture 4 note `OLS max prediction diff: 1.8e-15` | **Open.** Unchanged | **Open** | **Open** |

## Workarounds removed, and kept

- **Removed:** `pure:false` on k-means (point 2). `computed` model objects in three fits (point 1). `computed` row arrays in `standardizer.apply` (it passed `.values.value` into transpose; now `ctx.gather(z)`, picture 1 slice at `#15 lin.transpose`, label `gather[0]`, was a red `computed` tag). The copy-and-trim `fold()` in the renderer (now `maxDepth: 1`). The bare-number constant model (now tagged `{kind:'constant', value}`; the tag no longer costs lineage).
- **Kept, `lineage.mjs: producersAcrossRuns` and `staleness`:** the cross-run edge exists only for a Ref. A model loaded from storage or pasted as JSON is a plain value and arrives as `{kind:'input', call:0}`, exactly as in round 1. The scan is the only way to ask "which fit made this model" then (test 'stale model: ... scan fallback'). It is no longer the main path.
- **Kept, name-based pairing in `lineage.mjs`:** see point 5.
- **Kept, `trainingRows` / `trainOnly`:** see N2. They found nothing wrong in the slot-fill case and the check found nothing wrong either; both are needed.
- **Kept, sorting k-means centroids:** point 8.

### Round 3: workarounds removed, and kept

- **Removed: the hand loop in `fitted.kmeans.fit/lloyd`** (a `while` over `iterations`, a `prev` label vector, an early `break`, and a copy of the seeded draw that `fitted.kmeans.init` already had). It is now `ctx.call('fitted.kmeans.init')` and `ctx.drive('fitted.kmeans.step', ..., { until, maxTicks })`: about 17 lines became five statements, the iterations are child nodes tagged `@k`, `converged` is a Ref the last tick made (was a plain boolean), and the model's centroids are paths into the last tick's state. The test that compared loop and drive (`tick kind: ...`) stays and now compares `fit` (which drives) with a `world.drive`; they agree.
- **Removed: the untraced `if (converged)` in `kmeans.step`** (it decided whether `update` is called, and `converged` came from `.value`, so its provenance was `computed`). It is now `ctx.when(same, 'labels unchanged?')` on a Ref produced by a call (`fitted.labels.same`), and `converged` forwards that Ref. Picture 3b shows the decision row on each tick.
- **Removed: always augmenting.** `linear.fit` ran `ridge.augment` with zero-penalty rows even for ordinary least squares (an arithmetic no-op, but a node in the trace and a claim that ridge happened). It is now a declared conditional step; penalty 0 skips it (picture 12a). Evidence that the skip changes nothing: the plot of picture 2 (penalty 0) and test 'pipeline on constructed data' are unchanged.
- **Removed: `computed` rows in `ridge.augment`** for the rows that came from the input (`...matrix.value, ...extra`): `ctx.concat(matrix, extra)` keeps a path into the input for them. The penalty rows stay `computed` (N12).
- **Removed: the scan of `world.runs()` in `lineage.mjs: runTrace`** (now `world.node(run, 1)`), and the "give up on `cached`" branch of `fieldOrigins` (now reads the original node through `node.cachedFrom` and `world.node`).
- **Removed: reasons with last-digit noise.** The audit's reason string now rounds to six significant digits, because an example compares strings exactly (N13).
- **Added: three deliberately wrong implementations are now two plus one** (`standardizer.apply/self-stats`, `pipeline.regression/leaky` from before; `standardizer.fit/sample-sd` new), and `self-stats` and `sample-sd` carry an implementation example that states what they compute. The bug is now an executable fact that proves, next to the contract example that fails it.
- **Kept: `lineage.mjs: producersAcrossRuns` and `staleness`** (a plain-value model has no edge; `world.node` does not help because the question is "which fit emitted this hash", and nothing indexes by hash).
- **Kept: name-based pairing, `trainingRows`, `trainOnly`** (N8, and the check judges Parts not provenance).
- **Kept: sorting k-means centroids** (point 8).
- **Kept: `fitted.kmeans.init` as its own contract and the `world.drive` form of k-means** (picture 10). `fit` now uses the same contracts through `ctx.drive`, so there is one iteration, two ways to run it: inside one run (`ctx.drive`, one receipt, cacheable around) and across runs (`world.drive`, one receipt per tick, each replayable alone). The second is the only one where a single tick can be `world.replay`ed on its own.
- **Kept: `cache: false` in pictures 7 and 7b**, so that the fit boxes are computed and their brackets are drawn. With `expand` they could be hits drawn with ghosts (picture 11c does this for an audit); I kept the plain form because those two pictures are about the gather brackets, not about caching.
- **Not used: `ctx.tick()` and the tick cache dependency.** No fitted-model implementation reads the tick number; k-means state carries everything. See "What did not fit" below.

### Round 4: workarounds removed, and kept

- **Removed: two helper contracts that only emit a boolean.** `fitted.penalty.isRidge` (one comparison, `penalty > 0`) and `fitted.labels.same` (one equality of two integer arrays, with its `sameInts` function and a `uses` entry). Helper contracts in the entry: **2 before, 0 after** (22 `fitted.*` contracts now, 24 in round 3). Lines: about nine lines of definitions (two contracts with descriptions and examples, two implementations, `sameInts`) plus the `uses` entry and the two call sites; the file itself went from 398 to 396 lines because the same round added the `x-role` helper and annotations (about 20 lines), the `history` port and the drive row. Trace nodes: a ridge fit lost one child (the `isRidge` box, ids after #20 return to round 2), a k-means tick lost one child (the `same` box, ids #3 #7 #11 became #3 #6 #9).
- **Removed: the name table in `lineage.mjs`** (`isFit`, `FITS`, three regular expressions, port names `model`, `matrix`, `values` written into code). Pairing, training ports and row sources are read from `x-role` on the ports of `world.contracts()`. The file is 205 lines now.
- **Removed: the `first` with a pass-through** for ridge versus plain least squares. It is `{one}` over two least-squares calls now (N15 says what that cost).
- **Removed: the ordering trick for the k-means history.** None existed, but the round-3 picture could not show the states of the three ticks; `collect: ['state']` now returns them with provenance (picture 3b).
- **Kept: nothing was kept for a v0.4 reason that I could remove.** Kept for older reasons: `lineage.mjs: producersAcrossRuns` and `staleness` (a plain-value model has no edge), the centroid sort (point 8), `fitted.kmeans.init` as its own contract, `cache: false` in pictures 7 and 7b, the outside `trainOnly`/`trainingRows` (N2, N6).
- **Used and found a use for:** path-qualified fill (C-29, N10), `{one}` (C-25), `ctx.test` and named branches (C-27), `collect` (C-28), `startTick` (C-30), `x-role` (C-31). Not used: `first` with one alternative, `ctx.when` on `{and}`/`{or}`/`{not}` (no condition in this domain combines relations), zero ticks.

### Round 5: workarounds removed, and kept

Counts, round 4 to round 5 (kernel v0.5), measured in `contest/c-fitted/index.mjs`, the test file and `verify/render-c-fitted.mjs`:

| What | Round 4 | Round 5 | How |
|---|---|---|---|
| Restated guards (the same relation written on a step and again on a step that reads it) | 1 (`ridgeNow` on `aug` and on `betaRidge`) | **0** | `betaRidge` has no `when`; it reads `aug`, so it is skipped when `aug` is, and its decision records `aug`'s cause |
| Typed complements (a relation written only to be the negation of another) | 1 (`le: [$in.penalty, 0]` on `betaPlain`) | **0** | `betaPlain` is `when: { else: ['aug'] }`; the picture reads `else(aug: gt($in.penalty=0, 0))` |
| Pins or fills that existed only to dodge precedence | 2 (the `#reference` pin in test 'slot declaration' and in picture 13b, both written because a contract-wide fill beat the slot select) | **0** | the slot select at `fitted.standardizer.fit#reference` is itself the pin; a contract fill does not reach it (test 'v0.5 specificity', picture 13a). Two slot fills remain on purpose, to demonstrate blindness (test, picture 13b); they are experiments, not dodges |
| Hand-kept trajectories outside `prove` (a per-tick expectation written in a test instead of in an example) | 1 (the final-only `ticks: 2` example plus the per-tick `converged` false then true that test 17 re-asserted by hand) | **0** | a `trajectory` example on `kmeans.step`: each of two ticks is checked inside `prove`; `kmeans.step` now has three proofs. Test 17 still asserts the decisions and the history provenance, which a trajectory cannot say |

Lines: `index.mjs` is 398 lines (396 in round 4); the removals (the `ridgeNow` constant, one `when`, one `le` guard, the `ticks: 2` example, a comment) were paid back by the three-line trajectory example and the comment on the slot pin. The test file grew by about 70 lines (three flipped tests longer, two new friction tests).

- **Kept: nothing for a v0.5 reason I could remove.** Kept: `one` at the boundary (`returns` still demands `first` or `one` for an inherited output, test 'inherited conditions still guard the boundary'); the cross-run hash scan; the centroid sort; `fitted.kmeans.init` as its own contract; `cache: false` in pictures 7 and 7b; the outside `trainOnly` and `trainingRows`; `iterations: d.ticks` (a plain number; the count Ref was deferred, ledger seq 52).
- **Used:** `else`, inherited skips (C-25, C-36), the specificity order with a slot select as a pin (C-34, C-35), `contract#*` (test only, see N25), path landing as an error (test 'v0.5 path fill must land'), `trajectory` (C-38), the receipt's fill line in pictures (C-34, C-35, C-37), `receipt.fillConsulted` in tests. Not used: `each` (no input varies per tick), the `tick` example (nothing reads the clock), `startTick` in an example.

### Round 6: workarounds removed, and kept

Counts, round 5 to round 6 (kernel v0.6), measured in `contest/c-fitted/index.mjs`, the test file and `verify/render-c-fitted.mjs`:

| What | Round 5 | Round 6 | How |
|---|---|---|---|
| Trace scans that compute what `fillReach` answers (a walk over the trace to find which calls a fill chose) | 3 (the flat-key check in test 18, the contract-fill count in test 21, and the walk in the render script that found the fits for 13c and 13d) | **1, plus one oracle** | `receipt.fillReach` answers the first two directly (`{ key: [call ids] }`). The render script still walks once, but only to find the pinned `#reference` fit, the call NO key of that run reached (`fillReach` lists calls a key reached, so the call nothing reached is not in it); the path-fill fit itself is read from `fillReach`. Test 21 keeps one `L.walk` as an ORACLE that `fillReach` is compared with, so it is a check, not a workaround |
| Guards kept only because of the `one` or `else` gaps | 0 | **0** | nothing was kept for them in round 5 (`one` stays at the output boundary because `returns` still fails with `NO_BRANCH`, which v0.6 left as it was) |
| `allowUnusedFill` used where `landing: 'none'` says what I mean | 0 | **0** | I never used `allowUnusedFill`; in round 5 I read `fillConsulted` by hand instead |
| Hand landing checks (`fillConsulted` compared with the keys I passed) | 3 | **0** | `landing: 'all'` throws `BAD_FILL` for a flat key no call took (tests 18 and 21); `'none'` lets a sweep's dead path miss (test 18); `fillReach` is asserted as the receipt |

Lines: `index.mjs` 398 (no change, nothing in it was a workaround for v0.6), `lineage.mjs` 210, the test file 632 lines (two flipped tests rewritten, test 21 gained about ten lines), `verify/render-c-fitted.mjs` 302 (claims, verdicts and observations for round 6 added; picture 13 prints rung and reach).

- **Kept: nothing for a v0.6 reason I could remove.** Kept: `one` at the boundary; the cross-run hash scan; the centroid sort; `fitted.kmeans.init` as its own contract; `cache: false` in pictures 7 and 7b; the outside `trainOnly` and `trainingRows`; `iterations: d.ticks`; the contract-wide fill in tests and picture 13e (the ledger declined removing it, seq 58, and it is what shows the audit staying honest).
- **Used:** inherited runs (C-41), `chosenBy` (the rung asserted in tests 15 and 21, printed in 13a, 13c, 13d), `fillReach` (13b, 13e and tests 18, 21), `landing: 'all'` and `'none'` (tests 18, 21), named examples (the trajectory examples keep their names). Not used: `each`, `tick` examples.

## New friction, round 2

### N1. Slots name a call site but cannot express "same input, different expectation per slot"
**Round 3: Resolved.** `fill['fitted.standardizer.apply#tset']` is `BAD_FILL` (run recorded as failed); test 'slots: one fill key injects ...' flipped from `doesNotThrow` to `throws BAD_FILL`, and the declared spelling `#test` still runs. The slots are declared by the pipeline compositions' steps and, for the audit refit, by `uses: ['fitted.standardizer.fit#reference']`. Two small leftovers: the error arrives after the run (a typo costs the whole run, 50 calls for the pipeline, before it is reported), and there is still no `world.slots(contractId)` to list what is declared, which is what I proposed in round 2.
- **Needed:** two call sites of one contract in one composition (`standardizer.apply` for train and for test) where a test or an audit can target one site.
- **Kernel today:** works. `fill['fitted.standardizer.apply#test']` swapped one site (test 'slots: ...', picture 9: #8 `apply#train` stays `columns`, #9 `apply#test` is `self-stats`). Friction: an unknown slot in a fill key is silently accepted (`...#tset` does not throw; asserted in the test), contradicting KERNEL.md's "unknown fill keys fail". Only an unknown contract or a wrong implementation throws.
- **Workaround:** none; the test pins the current behaviour.
- **Proposed shape:** `BAD_FILL` for `contract#slot` where no composition or implementation in the world declares that slot (needs a slot registry: compositions already list their step slots, so `world.slots(contractId)` is cheap).
- **Severity:** ergonomic.
- **Evidence:** test 'slots: one fill key injects a wrong implementation at the test call site only...'.

### N2. "Passed" is not "used": neither provenance nor a model-vs-rows check sees an implementation that ignores its model
**Round 3: Open, no change.** The v0.3 slot work made the blindness easier to show (picture 13: a contract-wide fill gives the audit the same wrong implementation as the pipeline, so it accepts) but gave no read flag. Tests 'slots: ...' (`trainOnly` stays true under `self-stats`) and 'check: ...' (audit accepts the `#test` fill) still assert the blindness.
- **Needed:** to catch `standardizer.apply#test` refitting on the test rows (a leak) when it was handed a perfectly good model.
- **Kernel today:** the trace records that the model Ref was passed to #9 (`fitApplyPairs` reports fit #7 → #9, `trainOnly` is still true) and the check `fitted.audit.pipeline` compares the fitted standardizer with the train statistics, which is correct, so it accepts. Both lie by omission. Only the contract example for `standardizer.apply` caught it: `prove` fails `self-stats` on example 0 (test 'every contract example proves; only the two deliberately wrong implementations fail').
- **Workaround:** none. A real catch would need either a trace-level fact "port `model` was read by the implementation" (a read log per input port) or a metamorphic check (apply the model to a different matrix and compare to `vec.standardize` of the model's own numbers).
- **Proposed shape:** `node.in[port].read: boolean`, set when the implementation touches `.value` or `ctx.at` on that input. One flag, no API change.
- **Severity:** distorts the trace (the picture of an unused model edge is identical to a used one).
- **Evidence:** test 'slots: ...' lines `L.trainOnly(leak.trace)` true and, in the check test, `blind.outputs.accepted` true; picture 9, #9 has the model row and an `apply/self-stats` header with the arrow into the model row drawn exactly as on #8.

### N3. Gather inside gather is not flattened, and the kernel's `at` over a gather is not resolved
**Round 3: Partly resolved (view only).** The kernel still nests the inner gather as one piece, but the view now prints the inner paths in the label (picture 3b, `#1 model`: `gather[centroids]gather[0]<-[centroids.1]`, `gather[1]<-[centroids.0]`). `fieldOrigins` still recurses (test 'v0.3 ctx.drive' asserts the flattened result).
- **Needed:** a model whose field is itself a gathered array (`kmeans.centroids`), asking "which call made `centroids[0]`".
- **Kernel today:** `ctx.gather({kind, centroids: ctx.gather(sorted)})` gives an outer piece `{path:['centroids'], from:{kind:'gather', pieces:[...]}}`. Each level is its own gather; a reader has to recurse (`lineage.mjs: fieldOrigins`, `expand`). The kernel's own view prints the outer labels only (picture 3b, `gather[kind] literal gather[centroids] gather...` runs off the box and the inner pieces are not labelled). A reader that wants the producer of `centroids[0]` from a gathered Ref has to read the gather pieces itself; `ctx.at(gatheredRef, i)` was not exercised here, so I make no claim about it.
- **Workaround:** recursion in `fieldOrigins`; `ctx.gather(sorted)` kept as two levels because flattening by hand (`centroids.0.0 ...`) would lose the row structure.
- **Proposed shape:** `ctx.gather` flattens a nested gather Ref into its pieces with the path prefixed (a Ref that is itself a gather contributes its pieces, not one piece).
- **Severity:** ergonomic; distorts the view (inner pieces unlabelled).
- **Evidence:** test 'tick kind: ...' (init centroids are `centroids.0`/`centroids.1` only after recursion), `facts.json` `gather`, picture 3b #1 `model` row.
- Positive: sorting the centroid Refs and gathering them back kept provenance through the permutation: with seed 11 the model's `centroids.0` comes from `#5 update.centroids[1]` and `centroids.1` from `[0]`, i.e. the sort is visible in the trace (checked in the console, `fieldOrigins`).

### N4. A cache hit hides how an input arrived, and its output provenance is `cached`
**Round 3: Partly resolved.** A hit's `out.model.from` is still `{kind:'cached'}`, but `cachedFrom` plus `world.node(run, call)` returns the original node with its gather pieces, and `lineage.mjs: fieldOrigins(trace, node, port, world)` now uses it (test 'v0.3 addressing': with the world the cached fit answers like the computed one, without it `[{kind:'cached'}]`). Picture 11c shows the same for an audit as ghost boxes. What remains: the node itself still lies by omission; every reader has to know to follow `cachedFrom`.
- **Needed:** an apply call's `model` edge for audit, even when the same call ran before with the model passed another way; a fit's output provenance when it was a cache hit.
- **Kernel today:** the cache key is impl + input hashes, so an apply with a Ref model (run 20) and the identical apply with a plain-value model (run 21) are the same call: run 21 is a single hatched box, `cached`, with no run tag (picture 6, lower trace). The edge is still recorded on the node's `in`, so `fitApplyPairs` works on a cached apply; but a cached `*.fit` has `out.model.from = {kind:'cached'}`, which hides its gather pieces. `resolveProducer` stops at the fit node and does not need them, but `fieldOrigins` on a cached fit returns `[{kind:'cached'}]` (pictures 7 and 7b run with `cache:false` for that reason).
- **Workaround:** `cache:false` when rendering gather brackets.
- **Proposed shape:** on a hit, copy `out[port].from` from the node that was cached (`cachedFrom.run`/`call`) instead of `{kind:'cached'}`, or store it as `from: {kind:'cached', of: <original from>}`.
- **Severity:** distorts the trace on re-runs.
- **Evidence:** picture 6 lower trace; test 'a model applied in a later run...' (the `f2` cached fit still resolves by node, not by gather).

### N5. A tick contract is a fold the caller drives; it cannot be called from a composition
**Round 3: Resolved.** `ctx.drive` is the shape I proposed (`ctx.drive(tick, inputs, {until, maxTicks})`), each tick a child tagged `@k`. Test 'v0.3 ctx.drive', picture 3b. New friction about it in N11.
- **Needed:** k-means fit as ticks (assign, update, test convergence), reachable from the pipeline.
- **Kernel today:** `fitted.kmeans.step` as `kind:'tick'` works and is nicer to inspect than the loop (picture 10: one cell per iteration, state hash and `← run k` per tick; any tick replays alone, test 'tick kind: ...'). But `world.drive` is a world method, not a contract: a composition or `ctx.call` cannot run it, so `fitted.kmeans.fit` stays an imperative loop inside one run. Two paths exist for the same model (loop, drive) and the pipeline can only use the loop. The initial state also needs its own run (`fitted.kmeans.init`, seeded), so the model's lineage starts at that run.
- **Workaround:** both implementations kept; test asserts they give the same centroids and the same iteration count.
- **Proposed shape:** `ctx.drive(tickContractId, inputs, {until, maxTicks})` returning `{state: Ref, ticks, receipts}` from inside an implementation, recording each tick as a child call (slot `tick:k`).
- **Severity:** ergonomic (distorts the trace only in that the loop's iterations are unnamed siblings #2..#6 in picture 3b).
- **Evidence:** pictures 3b and 10, test 'tick kind: ...'.

### N6. A check cannot see traces, only Parts
**Round 3: Open, no change.** Still one use. v0.3's cached verdicts do not change it.
- **Needed:** `fitted.audit.pipeline` would like to say "standardizer.fit read train rows only" (provenance), the same fact `trainOnly()` computes.
- **Kernel today:** a check's inputs are Parts; it has no handle on the trace of the run it sits in. I wrote the Part-level version (refit on the train rows, compare), which is a stronger statement in one respect (it ignores how the wiring looks) and weaker in another (it cannot say which call read what).
- **Workaround:** both: the check in the kernel, `trainOnly` outside.
- **Proposed shape:** none yet; one use. If a second entry wants provenance-aware checks: `ctx.provenance(ref): from` returning the kernel's `from` tree for a Ref, read-only.
- **Severity:** ergonomic.
- **Evidence:** test 'check: ...' versus 'leakage: ...'.

### N7. `ctx.random` on a pipeline of cached children: only the random node is excluded
**Round 3: still fits, and better.** With `ctx.drive` the cached children are whole ticks: a repeat run with the same seed has its three `step` children cached while `fit` itself is not (test 'v0.3 ctx.drive', `again.trace.calls.filter(tick).map(cached) = [true,true,true]`); a `world.drive` from the same init is then three cache hits (picture 10, third strip).
- **Needed:** to reuse the expensive deterministic children of a seeded fit.
- **Kernel today:** works well and is worth recording as fitting: the second k-means run with seed 1 re-draws and re-runs the loop, yet its `assign`/`update` calls whose inputs repeat are cache hits (test asserts `some(n => n.cached)`); its ancestors are never cached (receipt `impure: true`). No friction, listed because it was the round-1 distortion.

### N8. The fitted-model kind (ledger seq 23, deferred): is it still really needed?
**Round 3: does v0.3 change the need for a model-role annotation? No, it sharpens it. Open (deferred).** Evidence from this round:
1. **A pair that does not follow the names disappears silently, and the audit says yes.** Test 'role annotation is still needed': `x.shift.learn` / `x.shift.use` pass a model by a recorded edge (the kernel's trace has `from.kind = 'call'` on `u.model`), the compose deliberately learns from the test values, and `fitApplyPairs` returns `[]`, `trainingRows` returns `[]` and `trainOnly` returns `true`. An audit that answers true because it saw nothing is the worst failure mode of a name-based convention. A role on the port (`role: 'model'`) lets the lineage ask the kernel "which ports are models" instead of matching `/\.fit$/`, and lets it say "there are ports I do not understand" instead of true.
2. **Tick state is a model under construction.** `fitted.kmeans.step` has `state` in and out, no `model` port and no `.fit` name, so now that `kmeans.fit` contains its ticks as children (picture 3b), the lineage walks through four `step` boxes and sees none of them as fitting anything (test 'v0.3 tick state is a model in progress'). The annotation should be able to say that a `state` port is a model in progress (`role: 'model-state'`), which also gives N2's read flag somewhere to live.
Neither needs behaviour. The smallest addition is unchanged from round 2: `role` on a port schema, exposed by `world.contracts()`.
Case against, after migration: pairing by contract-id naming gave the audit I needed (pictures 1c, 6c) and nothing in the kernel was blocked. Case for, concretely, two things that are still manual and error-prone and that a `kind:'fit'`/`kind:'apply'` pair with a declared model port would remove:
1. `lineage.mjs` hard-codes `/\.fit$/`, `/\.(apply|predict)$/`, port names `model`, `matrix`, `values`, and the `FITS` table of training-data ports. A contract that does not follow the naming is silently missing from every audit (nothing fails; the picture just has no edge).
2. N2: "the model was passed" and "the model was used" cannot be told apart; a declared model port on an apply is where a kernel read-flag (N2) would attach naturally.
Neither needs the full kind. The smallest addition that covers both: `ports` role annotation, `out: { model: { ...schema, role: 'model' } }`, `in: { model: { ...schema, role: 'model' } }`, with `world.contracts()` exposing the role so tools find fit/apply by role, not by name. I would not add behaviour for it. One entry still asks; leaving it deferred is consistent with the ledger.

## New friction, round 3 (kernel v0.3)

Each point ends with the line "Hegel would say ... / Wittgenstein would say ...": what a concept that contains its own other would want, against what the actual use in this domain shows.

### N9. `ctx.when` and `when`/`first` need a boolean that a call produced, and the decision row does not say which branch ran
- **Needed:** record that `update` happens or does not (k-means tick), that `augment` happens or does not (ridge or plain least squares).
- **Kernel today:** works, with a cost. A decision points at the Ref that decided it, so each boolean needed a contract of its own whose only job is to be pointed at: `fitted.penalty.isRidge` (one comparison) and `fitted.labels.same` (one equality). Both are real nodes in every trace (picture 12, #3; picture 3b, #5, #9, #13). Second: a composition's decision row reads `aug = true -> ran` / `-> skipped` with the step's name; a `ctx.when` row reads `labels unchanged? = false -> not taken` and does not say what was not taken. On the first two ticks the grey row says `not taken` while `update` ran (it is the child #6 below it); a reader has to know that `false` here means "go on and update". The code takes a third argument (`guards`) that would produce the same `ran`/`skipped` as the composition, but KERNEL.md documents `ctx.when(boolRef, label)` only, so my implementation cannot use it without reading the source.
- **Workaround:** the two tiny contracts; the label `labels unchanged?` written as a question whose `true` is the shortcut.
- **Proposed shape:** document the third argument and have the view print what it names: `ctx.when(same, 'labels unchanged?', 'update')` draws `labels unchanged? = true -> skipped update`. Allow `ctx.when` to take a plain comparison with named sources, so a one-line comparison needs no contract (see N12).
- **Severity:** distorts the trace (the row's `not taken` reads backwards on the common path); ergonomic for the extra contracts.
- **Evidence:** picture 3b rows at #3 and #7 against #11; picture 12a; tests 'v0.3 branching: ...', 'v0.3 ctx.drive: ...'.
- **Hegel would say** a decision is one thing with two sides, so the row should name the side taken and the side negated, because the negated side is what the reader cannot see (it left no node). **Wittgenstein would say** the use shows readers asking "did `update` run?", which they answer by looking for a box; a row in the language of boxes ("skipped update") beats a row in the language of booleans ("not taken").

### N10. A reference computation inside an audit cannot protect itself from a contract-wide fill; only the caller can pin it, and must remember to
- **Needed:** `fitted.audit.standardizer` refits the statistics to compare with the model. If the experimenter breaks every standardizer fit with one fill (`{standardizer.fit: sample-sd}`), the audit's own reference breaks the same way and the audit agrees with the broken pipeline.
- **Kernel today:** the slot language gives the reference its own call site: it declares `uses: ['fitted.standardizer.fit#reference']`, a call without the slot is `UNDECLARED_SLOT`, a typo in the slot is `BAD_FILL`, and `fill['...fit#reference']` pins it (picture 13b: rejected, with the reason naming sd 1.1547 against 1). But `world.select(contract, impl, 'reference')` does NOT protect it: the order is `fill[contract#slot]`, `fill[contract]`, `select(.., slot)`, `select(..)`, so a contract-wide fill beats the world's slot default (test 'v0.3 slot declaration', third assertion). Picture 13a is the blind result.
- **Workaround:** the caller adds the `#reference` pin to every fill that touches `standardizer.fit` (the test does).
- **Proposed shape:** a fixed select, `world.select(contract, impl, slot, { fixed: true })`, that `fill[contract]` cannot override but `fill[contract#slot]` can. Or the same on the declaring side: `uses: ['fitted.standardizer.fit#reference=fitted.standardizer.fit/columns']`.
- **Severity:** wrong answer under a plausible fill (the audit says accepted).
- **Evidence:** pictures 13a and 13b; test 'v0.3 slot declaration: ...'.
- **Hegel would say** a check contains what it negates: its reference must be insulated from the thing it judges, or the judgement is an identity. **Wittgenstein would say** nobody breaks a whole contract by accident, `fill[contract]` is the experimenter's lever and is meant to reach everywhere; what the use shows is that the audit's reference call site is a different kind of call site, one that the lever should skip unless asked by its full name.

### N11. `ctx.drive` returns `{...lastOutputs, ticks}`; the tick count and the final state are the only handles, and the count is `computed`
- **Needed:** `kmeans.fit` reports `iterations`.
- **Kernel today:** `d.ticks` is a plain number, so `iterations` is a `computed` output (picture 3b, `iterations = 3` with no bracket) although the trace holds exactly three children tagged `@0 @1 @2`. `converged` forwards cleanly as a Ref because it is a port of the last tick. The result also mixes ports and a bookkeeping field in one object (`ticks` would collide with a tick contract that has a port of that name), and gives no handle to the per-tick Refs (no `d.states`), so a fit that wants "the state at tick 1" must go back to the trace.
- **Workaround:** `iterations: d.ticks`.
- **Proposed shape:** return `{ outputs: {...}, ticks: n, nodes: [call ids] }`, and let `ctx.concat`/`ctx.gather` accept the node list so a count or a history has provenance.
- **Severity:** ergonomic; small distortion (a number the trace could explain says `computed`).
- **Evidence:** picture 3b #1 `iterations`; test 'v0.3 ctx.drive: ...'.
- **Hegel would say** the count is a moment of the fold, not a fact about it from outside: the drive contains its own tally. **Wittgenstein would say** nobody uses the count except to print it and to compare with a cap; the use shows `converged` is what matters, and that already has provenance. Keep the object, add the node list.

### N12. `computed` has no sources: rows built from a Ref's value say only `computed`
- **Needed:** the penalty rows `[0, sqrt(penalty)]` in `ridge.augment` are made from `penalty`; the trace should say so.
- **Kernel today:** `ctx.concat(matrix, extra)` gives the first rows a path into the input and the new rows a bare `gather[2]` (picture 14; picture 1 #23 `pieces x4 passthrough gather[4]`). The word `computed` no longer appears in the view, so a computed piece is distinguishable only by having no `<-` and no tag. A reader cannot tell "made from the penalty" from "typed in as a constant".
- **Workaround:** none.
- **Proposed shape:** `ctx.derive(value, [refs])` returning a Ref with `from: {kind:'computed', of: [from, ...]}`, usable inside `concat` and `gather`. Same shape would let `ctx.when` take a comparison (N9), and would give `iterations` (N11) a source.
- **Severity:** distorts the trace (provenance lost at exactly the step where the value stops being a copy).
- **Evidence:** picture 14; picture 1 #23; test 'v0.3 concat: ...' (`[2, 'computed', null, null]`).
- **Hegel would say** a derived value contains what it was derived from; `computed` is a name for "I have forgotten", which is the negation of provenance without its content. **Wittgenstein would say** in use there are two kinds of computed: derived from something named, and given; the word should be split by what the reader asks next ("from what?").

### N13. A check's reason is a string, an example compares strings exactly, and the number inside it carries last-digit noise
- **Needed:** an example on `fitted.audit.pipeline` with a `fill`, expecting the leaky pipeline to be rejected with its reason.
- **Kernel today:** the example works (`fill` in examples is new and fine), but the reason embedded `sd 1.6749792701868154`; my hand formula gave `...154`, the run gave `...15`, and `prove` compares strings with no tolerance.
- **Workaround:** the audit rounds to six significant digits (`sd 1.67498`), which an example can state.
- **Proposed shape:** none for the kernel; a reason string that embeds a number should not carry noise, and now it does not. Listed because the kernel's `tolerance` cannot help a string, so the workaround belongs to every check author.
- **Severity:** ergonomic.
- **Evidence:** contract example 1 of `fitted.audit.pipeline`; picture 8b (reason starts `column 0: model has mean 2.16...`).
- **Hegel would say** the reason says the number twice, once as a Part and once as prose, and the two must be one; **Wittgenstein would say** nobody reads the 16th digit, so the prose should round and the Part should stay exact. Which is what the audit now does.

### N14. View notes (not kernel semantics)
- `maxDepth` hides the ghosts of an expanded cache hit: my first C11b (`maxDepth: 1`, `expand`) drew the hit with `+ 1 nested calls not drawn` and no ghosts, contradicting my claim; C11c, with no `maxDepth`, shows them.
- On a cached check, the green or red header colour hides the hatch; only the `cached from run 1` text in the implementation line says it is a hit (picture 11, #42).
- A trace with a single small box clips its title at the box width (first render of picture 14 read `C14 ridge.augment: ctx.concat(matrix,`); strips grow to fit their title, traces do not.
- An audit drawn inside a 50-call pipeline run is 5400 pixels tall (first render of picture 13) and unreadable; I redrew it on the audit alone.
- Verdict rows are cut at the box width (`...statistics...;`), so a rejected reason cannot be read in the picture, only in the facts file.

## Round 4: status of N1 to N14

| # | Point | Status in round 4 | Evidence |
|---|---|---|---|
| N1 | slot names a call site | **Resolved** (round 3); path fills extend the naming from one site to a chain | test 'v0.3 slot declaration (v0.4: and a path fill)'; pictures 9, 13c, 13d |
| N2 | passed is not used | **Open, no change.** No read flag in v0.4; the `x-role` place could hold one but nothing reads it | tests 'slots: ...' and 'check: ...' unchanged |
| N3 | gather inside gather not flattened | **Partly resolved (view only), no change.** Labels now read target<-source and the inner path is legible (`gather[0]<-[0] passthrough`) | picture 14, 3b |
| N4 | a hit hides how an input arrived | **Partly resolved, no change.** v0.4 says hits now carry decisions; none of my hits has a decision to carry, so I did not exercise it | picture 6b, 11 |
| N5 | tick is not callable from a composition | **Resolved** (round 3) | picture 3b |
| N6 | a check cannot see traces | **Open, no change** | tests 'check: ...' versus 'leakage: ...' |
| N7 | `ctx.random` with cached children | **Still fits.** A drive resumed with `startTick` hits the uninterrupted drive's cache entries | test 'FRICTION v0.4 guard restated ...' (second half) |
| N8 | the fitted-model kind | **Resolved in practice by `x-role`.** The need was "find fit and apply by role, not by name"; the annotation does that with no behaviour. What is left is N17 | tests 'v0.4 x-role: ...' (two), picture 1c, 5b |
| N9 | helper contracts; `not taken` reads backwards | **Resolved.** Helpers 2 to 0; the row reads `ran update, skipped keep centroids`; relations carry their operands (`read eq(#4.labels, $in.state[labels])`, `read gt($in.penalty, 0)`). Two new frictions in the same place: N15, N16 | pictures 3b, 12, 7; tests 'v0.4 branching', 'v0.4 ctx.drive + ctx.test' |
| N10 | the audit's reference cannot protect itself | **Partly resolved.** A path fill (`'fitted.pipeline.regression/fitted.standardizer.fit'`) breaks the pipeline's fit only, so the audit rejects with no pin. A contract-wide fill still blinds the audit, and the protection is still the experimenter's choice of key (ledger seq 43 deferred the select that beats a fill) | pictures 13a to 13d; tests 'v0.3 slot declaration (v0.4: ...)', N19 |
| N11 | iteration count and history have no handle | **Partly resolved.** `collect` gives the history with provenance (three brackets), `node.drives` records `ticks: 3, stopped: 'until'` and the call ids. `iterations` is still a plain number, so `iterations = 3` still has no source | picture 3b (history row, drive row, `iterations = 3` with no bracket); test 'v0.4 ctx.drive + ctx.test' |
| N12 | `computed` has no sources | **Open, and sharper.** A boolean now has operands (`gt($in.penalty, 0)`); a number still does not: the penalty rows of `ridge.augment` print as a bare `gather[2]`, and `iterations` has no bracket. v0.4 made the contrast visible | pictures 14, 3b vs 12 |
| N13 | strings compared exactly | **Open, no change** (the audit still rounds to six digits) | picture 8b |
| N14 | view notes | see the list below | pictures 11, 3b, 10, 1c, 6c |

N14 list, one line each: hit ghosts are still hidden by `maxDepth` (open, my C11b); the check colour no longer hides the hatch (**resolved**: C11b `#41` is green and hatched); a long title in a small box (not re-tested: I shortened picture 14's title in round 3 and did not draw a long one again); an audit inside a 50-call pipeline run is unreadable (open: I still draw the audit alone); verdict rows are cut at the box width (**open**: `...statistics ...;` in C11b); titles of hatched headers now end with an ellipsis inside the box (**resolved**, C-33); `<- run r #c` shows on the `model` row of 6 and on `state` in 10b (**resolved**); cached verdicts name their check (**resolved**, C-32).

## New friction, round 4 (kernel v0.4)

Each point ends with "Hegel would say ... / Wittgenstein would say ...".

### N15. `{one}` needs two parallel calls and a complement written by hand
- **Needed:** ridge or plain least squares: if the penalty is positive, augment and solve the augmented system; otherwise solve the plain system.
- **Kernel today:** works. `one` over `betaRidge.coefficients` and `betaPlain.coefficients`, each a separate `lin.leastSquares` call with its own `when`: `gt($in.penalty, 0)` for the ridge side and `le($in.penalty, 0)` for the plain side. The two guards are each other's negation and nothing says so: `one` finds an overlap when it runs (test 'v0.4 branching', `AMBIGUOUS_BRANCH` on `x.both`), but a gap or a guard written wrong at assembly is invisible. In this domain the gap cannot happen (`penalty < 0` and `NaN` are refused by the input schema before any guard is evaluated, probed with `-1` and `NaN`), so I could not test what `one` does when no alternative is live.
- **Workaround:** the `le` guard is typed out. The old shape (`first` over `[augmented, passthrough of x1]`) does not translate: a pass-through of a Ref needs an identity call or a `{at}`, which is the helper I was removing.
- **Proposed shape:** let a step say `when: {not: 'betaRidge'}` (the guard of another named step), or `otherwise: true` inside `{one}` so the last alternative is "everything else" and the complement is derived, not typed. Either removes the typed `le` and the possibility of a gap.
- **Severity:** ergonomic (a wrong complement is a wrong model, and it is only caught if a test hits the gap).
- **Evidence:** `contest/c-fitted/index.mjs` `fitted.linear.fit/leastSquares`; test 'v0.4 branching: ...'; picture 12.
- **Hegel would say** a branch and its other are one concept: writing the complement out states the same thing twice, once as `gt` and once as `le`, and the two can disagree. **Wittgenstein would say** nobody ever wrote `le` on purpose; every use says "otherwise", and the grammar made me spell out what the word means.

### N16. A step that reads a conditional step must restate the guard, and one choice becomes three decisions
- **Needed:** `betaRidge` reads `aug.matrix` and `aug.vector`; it can run only when `aug` ran.
- **Kernel today:** the assembly lint refuses `betaRidge` without a `when` ("aug.matrix comes from conditional step aug; use it inside { first } or { one }, or in a step whose when is the same condition or an { and } containing it"). The refusal is correct and the message is good. The cost: `ridgeNow` is written on `aug` and again on `betaRidge`, and the trace records three decisions (`aug`, `betaRidge`, `betaPlain`) for one choice. The view merges the first two into one row (`aug, betaRidge = true -> ran`), but `node.decisions` and `decisionsOf` have three entries with the same operands, and my test has to assert three.
- **Workaround:** a shared constant (`const ridgeNow = {gt: [...]}`), written twice.
- **Proposed shape:** a step is skipped when a Ref it binds is skipped (the rule v0.4 already has for gather, concat, at and test), and the lint accepts that for a call step too. The guard then lives once, on `aug`, and `betaRidge` has none. Alternatively a guarded block of steps (`when` on a group).
- **Severity:** ergonomic; the duplicated decision distorts nothing in the picture but doubles what a reader of the data has to dedupe.
- **Evidence:** test 'FRICTION v0.4 guard restated: ...' (the unguarded composition fails `ASSEMBLY_LINT`); `facts.branch.decisions` (three entries, two with the same `from`).
- **Hegel would say** skipping propagates: what depends on a thing that did not happen did not happen either, so the dependent is already negated. **Wittgenstein would say** the lint's rule is the use ("only run this where aug ran"), and the author is made to say it again in different words.

### N17. `x-role` finds the pairs; it does not fix the vacuous-true audit by itself
- **Needed:** coordinator question (ledger seq 41): does an annotation let lineage stop guessing by name, and is "the audit says true when it saw nothing" fixed?
- **Kernel today:** annotations ride on the port schemas and `world.contracts()` shows them. `lineage.mjs` builds its fit, apply and select tables from them (`'x-role': 'model'` on a `model` port, `'data'` on the rows a fit learns from, `'rows'` and `'selection'` on `rows.select`). Evidence: an annotated pair whose names match nothing (`x.shift.learn`/`x.shift.use`) is found, and its leak is caught (test 'v0.4 x-role: ...'); k-means, `kmeans.predict` and regression targets are audited by role with no table entry (test 'v0.4 x-role covers k-means'); tick state needs no role of its own once the enclosing fit contract is annotated.
- **What it does not do:** an UNannotated pair is exactly as invisible as before, and `trainOnly` used to answer `true` for it. The fix for that was mine, not the annotation's: `trainOnly` now returns `null` ("no fit recognised") instead of `true`. The annotation made it possible for the answer to be `true` for a reason. Two smaller costs: nothing checks an annotation (a typo `'x-rol'` or a wrong value is ignored in silence, and the lineage then reports `null`, which is the honest answer but not an error at registration); and the role says what a port holds, not what a call does with it, so "this is a fit" is a rule in my lineage (a contract with a `model`-role output and a `data`-role input) that every other entry would write again.
- **Workaround:** `trainOnly` is tri-state; the lineage rule is in `lineage.mjs`.
- **Proposed shape:** nothing new yet. The ledger's own rule applies: one entry uses these keys. If a second entry writes `'x-role': 'model'`, `world.contracts()` could take `{role}` as a query (`contracts({ portRole: 'model' })`), which is the lookup I wrote by hand.
- **Severity:** ergonomic; distorts the answer only when annotations are missing, and then it says so (`null`).
- **Evidence:** tests 'v0.4 x-role: ...' and 'v0.4 x-role covers k-means: ...'; pictures 1c, 5b (identical to round 3: the point is that nothing visible changed).
- **Hegel would say** a model port is what it is for the apply that takes it, so the role belongs to the relation between two ports, not to one port. **Wittgenstein would say** "model" and "data" are used here as labels people stick on boxes; as a label it does its job, and it is wrong to ask it also to be a guarantee.

### N18. `collect` returns the history, not the count, and the output port repeats the state schema
- **Needed:** `kmeans.fit` reports the states of every tick, and how many ticks there were.
- **Kernel today:** `collect: ['state']` returns one gathered Ref (`d.collected.state`), each element pointing at its tick's call (`facts.kmeansTrace.historyFrom = [3,6,9]`), and `node.drives` has `ticks: 3, stopped: 'until'`. Good. Two leftovers: `iterations` is still `d.ticks`, a plain number, so its row says nothing about where it came from although the history has exactly that many elements; and the `history` output port needs a schema (`array`, `minItems: 1`, `items: kmeansState`) that repeats the shape of the tick's state port, which I had to hoist into a constant (`kmeansState`) to avoid writing it twice.
- **Workaround:** `iterations: d.ticks`; the shared `kmeansState` constant.
- **Proposed shape:** `d.collected.state.length` as a Ref (`ctx.at(history, 'length')` with a source), or `d.tickCount` as a Ref pointing at `node.drives`. Let a port declare `{collected: 'step.state'}` so the item schema is taken from the tick contract.
- **Severity:** ergonomic (N11's small distortion, reduced).
- **Evidence:** picture 3b (`iterations = 3` with no bracket, `history` with three); test 'v0.4 ctx.drive + ctx.test: ...'.
- **Hegel would say** the count is the length of the history: a number that is also a list, said twice. **Wittgenstein would say** the use of the count is "was it 3 or the cap", which `node.drives.stopped` now answers better than the number does.

### N19. A path fill that names real contracts but no call chain is accepted and does nothing
- **Needed:** break the standardizer fit inside the pipeline, not the audit's reference refit.
- **Kernel today:** `'fitted.pipeline.regression/fitted.standardizer.fit'` does exactly that (pictures 13c and 13d: `sample-sd` in the pipeline, `columns` in the reference; the audit rejects, no pin). The path is matched as a chain ending at the call, not rooted at the run's root (the root of the audit run is `audit.pipeline`, which the key does not mention), so the same key works wherever `pipeline.regression` is called. Errors are good where they exist: a typo in a contract (`...fitt`) and a typo in a slot (`#nope`) are `BAD_FILL`. But `'fitted.error.mse/fitted.standardizer.fit'` (both contracts exist, `error.mse` never calls a standardizer fit) is silently accepted, the run goes through unchanged, and the audit says `accepted = true`: a fill that was meant to break something and broke nothing looks exactly like a fill that was tried and survived.
- **Workaround:** the test asserts the audit's verdict, and I check the fill took effect by looking at which implementation the call nodes show (picture 13).
- **Proposed shape:** like the slot check, `BAD_FILL` for a path that no call consulted in the run ("fill names a chain no call took"). A fill that matches nothing is almost always a mistake; a test that wants it can say so.
- **Severity:** wrong answer under a plausible slip (an experiment that passes because it did not run).
- **Evidence:** test 'FRICTION v0.4 path fill: ...'.
- **Hegel would say** a fill names a chain, and a chain that never occurs is not a moment of the whole. **Wittgenstein would say** the typo check already exists for names; the use is the same ("did my key land?"), so the check should be the same.

### N20. Merged decision rows and the picture: what is cheap to read is not always what the data says
- **Needed:** nothing; a view note. The v0.4 view merges identical decisions (`aug, betaRidge = true -> ran`) and prints the relation with its operands, which is the best reading of branching I have seen in these pictures.
- **Kernel today:** two things still read badly. A test expression such as `read eq(#4.labels, $in.state[labels])` runs to the right border of the box in 10b, and the state label `gather[centroids]<-[centroids] passthrough` touches the border in 3b; and the hash labels on the curves of 1c, 5b and 6c are drawn on the curve, so the line strikes through a digit (`68f13db5`).
- **Workaround:** none.
- **Severity:** cosmetic.
- **Evidence:** pictures 10b, 3b, 1c, 6c.
- **Hegel would say** the label belongs to the edge it names, so it should sit beside it, not in it. **Wittgenstein would say** nobody has ever misread the hash for the line; the nuisance is in the look, not the meaning.

## What fitted cleanly in round 4 (no friction)

- **`ctx.test` with `eq` on arrays:** deep equality of two label vectors needed no helper; the test is one line and the decision row prints both operands (picture 3b).
- **Named branches:** `{true: 'keep centroids', false: 'update'}` put the right words on the row, and the `not taken` reading that bothered me in round 3 is gone.
- **`startTick`:** two drives give the same final state as one, and a resumed tick is a cache hit on the whole drive's entry (the clock is not in the key of a tick that does not read it).
- **`x-` annotations:** one line per port, no validation trouble, visible in `world.contracts()`.
- **Path-qualified fill:** one key and the audit rejects (pictures 13c, 13d), the typo checks fire where tests aimed them.
- **Flipping tests:** four tests changed their meaning and kept their scenarios (names in the final report); none needed a new fixture.

## Round 5: status of N1 to N20

| # | Point | Status in round 5 | Evidence |
|---|---|---|---|
| N1 | slot names a call site | **Resolved** | tests 'v0.5 specificity', 'v0.5 path fill must land' |
| N2 | passed is not used | **Open, no change** | tests 'slots: ...', 'check: ...' |
| N3 | gather inside gather | **Partly resolved (view only), no change.** The new `at` view rule does not touch this domain (C-39) | pictures 3b, 14 |
| N4 | a hit hides how an input arrived | **Partly resolved, no change** | picture 6b |
| N5 | tick not callable from a composition | **Resolved** | picture 3b |
| N6 | a check cannot see traces | **Open, no change** | tests 'check: ...' versus 'leakage: ...' |
| N7 | random with cached children | **Still fits** | tests 'v0.3 ctx.drive', 'v0.5 inherited skip' (second half) |
| N8 | the fitted-model kind | **Resolved in practice by `x-role`, no change** | C-31 |
| N9 | helper contracts, `not taken` | **Resolved** (round 4) | pictures 3b, 12 |
| N10 | the audit's reference cannot protect itself | **Resolved.** A slot select beats a contract fill (ledger seq 46): under `{standardizer.fit: sample-sd}` the audit rejects with no pin from the caller (13a). The audit is blind only if someone fills the reference slot itself (13b). Residual: that is still possible on purpose, and `#*` does not mean what its name suggests (N25) | pictures 13a, 13b, 13e; test 'v0.5 specificity' |
| N11 | iteration count and history | **Partly resolved, no change** (the count Ref is deferred, seq 52). `node.drives` says `until` | picture 3b |
| N12 | `computed` has no sources | **Open, no change** | pictures 14, 3b |
| N13 | strings compared exactly | **Open, no change** | picture 8b |
| N14 | view notes | the cached-verdict sentence now wraps onto three lines but is still cut at its end (**open**); everything else as round 4 | picture 11b |
| N15 | `{one}` needs two calls and a typed complement | **Resolved** (typed complements 1 to 0). Residual in N21 | pictures 12, 7; test 'v0.5 branching' |
| N16 | restated guard; one choice, three decisions | **Half resolved.** The guard is written once. The record still has one decision per step (three in the plain case, two in the ridge case): ledger seq 51 declined merging. The view merges rows with one cause | pictures 12, 1b; test 'v0.5 branching' |
| N17 | `x-role` and the vacuous-true audit | **Open, no change** | tests 'v0.4 x-role: ...' |
| N18 | `collect` returns history, not count | **Open (deferred, seq 52)** | picture 3b |
| N19 | a path fill that lands nowhere | **Resolved** (`BAD_FILL: path fill reached no call in this run`). Residual: flat slot keys are not checked (N23) | test 'v0.5 path fill must land' |
| N20 | read line at the border; hash labels on curves | **Half resolved.** The read line wraps inside the box (10b, 3b); the hash labels in 1c, 5b and 6c are still struck by their curves | pictures 10b, 3b, 1c, 6c |

## New friction, round 5 (kernel v0.5)

Each point ends with "Hegel would say ... / Wittgenstein would say ...". The new concepts cost little; the points below are what I could still get wrong with them.

### N21. The `one` lint is structural: `gt` against `ge` is an overlap that still waits for the run
- **Needed:** two alternatives of `{one}` that are exclusive; the kernel should refuse ones that are not.
- **Kernel today:** the lint refuses an unconditional alternative and a condition that implies another one, but "implies" is syntactic: `{and: [A, B]}` implies `A`, identical specs imply each other. `gt($in.penalty, 0)` against `ge($in.penalty, 0)` assembles, and fails at the first input in the overlap with `AMBIGUOUS_BRANCH`.
- **Workaround:** none needed in the entry (`else` makes the question moot); the scenario is pinned in test 'v0.5 inherited skip'.
- **Proposed shape:** none. A solver for numeric overlap solves a problem the uses do not have: every overlap I wrote came from typing a second relation, and `else` removes the reason to.
- **Severity:** low.
- **Evidence:** test 'v0.5 inherited skip ...' (`y.over/and` refused, `y.over/ge` assembled and refused at run time).
- **Hegel would say** that one relation implies another is a fact about numbers, not about how the relations are spelled. **Wittgenstein would say** nobody was ever hurt by the arithmetic case; the structural rule covers every form people actually write, so the rule is the right size.

### N22. A step that ran by inheritance leaves no trace of why it was conditional
- **Needed:** to read a ridge fit and know that `betaRidge` was a conditional step.
- **Kernel today:** `betaRidge` has no `when` in the source. When it is skipped, its decision (`aug, betaRidge = false -> skipped`) names `aug`'s cause, so the picture is complete. When it ran, it has NO decision: the ridge trace shows two rows (`aug = true -> ran`, `betaPlain = false -> skipped`), and nothing says `betaRidge` ran because `aug` did. A reader of the source sees an unguarded step; a reader of the ridge trace sees an unexplained call box.
- **Workaround:** none; a comment in `index.mjs` and the test 'FRICTION v0.5 flat slot key' pin the asymmetry.
- **Proposed shape:** a node reached by inheritance carries `inheritedFrom: ['aug']`, and the view prints it under the box header (`ran because aug ran`).
- **Severity:** ergonomic (the trace is correct and one step short of self-explaining).
- **Evidence:** picture 12B (two rows, three children), picture 12A (merged row names `betaRidge`); test 'FRICTION v0.5 flat slot key' (second half).
- **Hegel would say** a dependent that was affirmed through its producer is as much a moment as one that was negated; recording only the negation is half a determination. **Wittgenstein would say** the question a reader asks of a call box is "why did this run", and the answer "because aug did" is written nowhere.

### N23. A flat slot key that no call took is standing configuration: accepted, silent, visible only in the receipt
- **Needed:** an experiment fill that breaks something, and a way to know it did.
- **Kernel today:** a path fill that lands nowhere is `BAD_FILL`; a flat key (`fitted.standardizer.fit#reference`, `fitted.standardizer.fit#*`) that no call in the run consulted is accepted. Run on `pipeline.regression` (which has no `#reference` seat) with either key, the run is unchanged (mse 6.5) and the receipt's `fillConsulted` is `[]`. The new fill line marks it `(not consulted)` in a picture, but only when the caller passes `receipt` to `traceToSvg`; without it the picture shows no fill line at all.
- **Workaround:** the tests assert `receipt.fillConsulted`; pictures 13a, 13b, 13e pass the receipt.
- **Proposed shape:** `strictFill: true` on a run (and always on in `prove`), turning an unconsulted key of any kind into `BAD_FILL`; and print the fill line whenever a run had a fill.
- **Severity:** wrong answer under a plausible slip (an experiment that did not run looks like a survivor), now detectable but not refused.
- **Evidence:** test 'FRICTION v0.5 flat slot key'; picture 13a (`(not consulted)`).
- **Hegel would say** a slot means something against all its possible places, so a run that happens not to visit one is not an error (the ledger's own reason for keeping flat keys). **Wittgenstein would say** the use of a fill in an experiment is to aim, and the question asked of an aim is "did it land", which is the same for a flat key as for a path.

### N24. `else` names a step, so its meaning moves when the step's guard changes
- **Needed:** `betaPlain` runs when the ridge branch does not.
- **Kernel today:** `else: ['aug']` is "the complement of whether `aug` ran". If someone later guards `aug` with `{and: [gt(penalty, 0), something]}`, `betaPlain` silently becomes "aug did not run for either reason", which is what `else` says and may not be what the author of `betaPlain` meant (the penalty relation alone). The picture helps: the read line prints the cause (`else(aug: gt($in.penalty=0, 0))`).
- **Workaround:** none; the expression in the picture is the check.
- **Proposed shape:** none yet; if a second use wants the complement of a relation rather than a step, `{not: <ref to the test>}` already exists.
- **Severity:** low.
- **Evidence:** pictures 12A, 12B; test 'v0.5 branching' (`decisions[2].from.steps` is `['aug']`, its argument is `aug`'s cause).
- **Hegel would say** a complement of an event is the complement of whatever made the event, so the name follows the cause. **Wittgenstein would say** the picture settles it: authors read `else(aug: gt(...))` and see the relation, so the step name is a handle and not a hazard.

### N25. `contract#*` means every slot of the contract, not every seat, and the specificity order is a six-line table
- **Needed:** one key that breaks every standardizer fit in a run, pinned seats included, for a sweep.
- **Kernel today:** `{'fitted.standardizer.fit#*': sample-sd}` on an `audit.pipeline` run broke only the `#reference` seat (the pipeline's fit has no slot) and the audit rejected the other way round; on a pipeline run alone it was not consulted at all (N23). A contract-wide fill breaks the unslotted seat and the pinned seat stays honest. Reaching everything takes two keys (`contract` and `contract#*`) and, to reach a pinned seat, a fill at its slot. KERNEL.md says both "every slot of the contract" and "reach every seat on purpose"; the first is what happens.
- **Workaround:** test 'v0.5 specificity' states the three outcomes (sweep rejected, `#*` rejected the other way, both slot and contract filled wrong: accepted).
- **Proposed shape:** document `#*` as "every slotted seat", or add a spelling for the unslotted seat so that `contract#*` plus it covers all; keep the order table in KERNEL.md next to the example from picture 13.
- **Severity:** ergonomic (I got it wrong once, and found out from the receipt).
- **Evidence:** test 'v0.5 specificity' (`star` case); `receipt.fillConsulted` in the probe.
- **Hegel would say** the unslotted seat is a seat too, the default one, so a key for all seats must include it. **Wittgenstein would say** the sweep as used says "everywhere", and every time I wanted it I wanted the pinned seat left alone, which the select now does; the name matters less than the order being written down once.

## Round 6: status of N1 to N25

| # | Point | Status in round 6 | Evidence |
|---|---|---|---|
| N1 | slot names a call site | **Resolved** | tests 'v0.5 specificity', 'v0.6 landing' |
| N2 | passed is not used | **Open, no change** | tests 'slots: ...', 'check: ...' |
| N3 | gather inside gather | **Partly resolved (view only), no change** | pictures 3b, 14 |
| N4 | a hit hides how an input arrived | **Partly resolved, no change** | picture 6b |
| N5 | tick not callable from a composition | **Resolved** | picture 3b |
| N6 | a check cannot see traces | **Open, no change** | tests 'check: ...' versus 'leakage: ...' |
| N7 | random with cached children | **Still fits** | tests 'v0.3 ctx.drive', 'v0.5 inherited skip' |
| N8 | the fitted-model kind | **Resolved in practice by `x-role`, no change** | C-31 |
| N9 | helper contracts, `not taken` | **Resolved** (round 4) | pictures 3b, 12 |
| N10 | the audit's reference cannot protect itself | **Resolved.** The pin is now visible as a pin: 13a says `by pin` on a flag row (`chosenBy.rung` is `slot select`, asserted in test 21) | pictures 13a, 13b, 13e; test 'v0.5 specificity' |
| N11 | iteration count and history | **Partly resolved, no change** (count Ref deferred, seq 52 and 59). Collected pieces name their tick (`gather[2]←@2`) | picture 3b |
| N12 | `computed` has no sources | **Open, no change** | pictures 14, 3b |
| N13 | strings compared exactly | **Open, no change** | picture 8b |
| N14 | view notes | **Half resolved.** The cached-verdict sentence is whole now (one entry per verdict; my claim of "one line" failed, C-46); gutter edges have their own lanes (C-45); verdict marks stay in headers (C-47). New: the 13c flag row overflows (N27) | pictures 11b, 3b, 1b, 13c |
| N15 | `{one}` needs two calls and a typed complement | **Resolved**, no change | pictures 12, 7; test 'v0.6 branching' |
| N16 | restated guard; one choice, three decisions | **Better, still half.** The record still has one decision per step (seq 51 declined merging), but both sides now leave the SAME three (12A and 12B), so a reader no longer meets a hole in the ridge case | pictures 12, 1b; test 'v0.6 branching' |
| N17 | `x-role` and the vacuous-true audit | **Open, no change** | tests 'v0.4 x-role: ...' |
| N18 | `collect` returns history, not count | **Open (deferred, seq 52 and 59)** | picture 3b |
| N19 | a path fill that lands nowhere | **Resolved**; `landing: 'none'` lets a sweep miss on purpose | test 'v0.6 landing' |
| N20 | read line at the border; hash labels on curves | **Half resolved, no change.** The hash labels in 1c, 5b and 6c are still struck by their curves; this is my renderer, not the kernel | pictures 1c, 5b, 6c |
| N21 | the `one` lint is structural | **Open, low, no change** | test 'v0.5 inherited skip' |
| N22 | an inherited run is unexplained | **Resolved** (seq 53). 12B shows `aug, betaRidge = true -> ran`, and its `from` equals the one on `aug` (test 15 asserts `decisions[1].from` deep-equals `decisions[0].from`). The residual: a reader of the source still sees an unguarded step, and the picture is what says it was conditional | picture 12B; test 'v0.6 branching' |
| N23 | a flat slot key no call took is silent | **Resolved when asked.** `landing: 'all'` refuses it, `fillReach` says `[]` for it; the DEFAULT is still the lenient round-5 rule, so a slip that forgets to write `'all'` stays silent (N26) | tests 'v0.6 landing', 'v0.5 specificity' |
| N24 | `else` names a step | **Partly resolved.** v0.6 prints `else(aug)` short and draws its cause as an edge (C-36). The meaning still follows `aug`'s guard; seq 54 fixed a different hazard (`else` outside its context), not this one | pictures 12A, 12B |
| N25 | `contract#*` means every slotted seat | **Resolved by documentation** (KERNEL.md: "every slotted seat"). The residual shape stands: no single key reaches the unslotted seat and the slotted seats together | KERNEL.md line 25; test 'v0.5 specificity' |

## New friction, round 6 (kernel v0.6)

Each point ends with "Hegel would say ... / Wittgenstein would say ...".

### N26. `landing` is per run, so one table cannot say "these keys must land, that one may miss"
- **Needed:** in an experiment run, a probe fill (`fitted.standardizer.fit#reference`, which must land or the experiment did nothing) next to a sweep fill (`fitted.standardizer.fit`, which is allowed to reach nothing in some runs).
- **Kernel today:** `landing: 'all'` for the run, or `'none'`, or the default `'path'` (paths must land, flat keys need not). On the audit alone, the contract key reaches no call (the reference is pinned), so `'all'` refuses the whole run even when the contract key was meant as a sweep key (test 21, the last assertion).
- **Workaround:** run twice, or pass only the keys that must land to the `'all'` run.
- **Proposed shape:** none yet; if a second entry asks for it, a per-key marker is the smaller change (`fill['k?']`), not another mode.
- **Severity:** low (the kernel's own ledger note, seq 56, says Hegel and Wittgenstein disagree here, and this is the disagreement showing up in one table).
- **Evidence:** tests 'v0.6 landing' and 'v0.5 specificity'.
- **Hegel would say** a fill table is one statement, so it lands as a whole or not at all. **Wittgenstein would say** the table holds two kinds of sentence (an aim and a sweep) and a mode that cannot tell them apart makes me write two runs for one question.

### N27. The rung has two places, and one of them overflows
- **Needed:** to read, at a call box, what chose its implementation.
- **Kernel today:** the rung is on the implementation line when it fits (`by pin ...`) and on a separate `⚑` row when it does not; in 13c the row `by path fitted.pipeline.regression/fitted.standardizer.fit` is wider than its box and runs past the right edge (C-49). The rung exists only for a non-default choice, so "no text" means "only implementation", and a reader has to know that.
- **Workaround:** the facts file prints `chosenBy` for the same calls (`pathFill`, `pin.*` entries).
- **Proposed shape:** wrap the `⚑` row inside the box like the read line (N20 was fixed that way in round 5).
- **Severity:** view only.
- **Evidence:** picture 13c, C-49; picture 13a (flag row), 12 (no text).
- **Hegel would say** the default is a rung too and should be named, so that no box is silent. **Wittgenstein would say** a label on every box is noise; the boxes worth a label are the ones where a fill or a pin intervened, which is where it is printed.

## What fitted cleanly in round 6 (no friction)

- **Flipping tests:** two red tests (15, 18) changed their meaning and kept their scenarios; the third (21) only gained assertions. No fixture changed.
- **`fillReach` and `landing: 'all'`:** what v0.5 made me prove by hand (a key reached what I thought) is now one receipt field and one option; the pictures print the same field.
- **Inherited runs:** the ridge trace has the same three steps as the plain trace, so a reader sees one shape for one choice. This was my round-5 top request and it landed as asked.
- **`chosenBy`:** the audit's pin reads as a pin in the box, not only in my comment.
- **No source change:** `index.mjs` did not need an edit for v0.6; the kernel's changes were additions or visible in the record.

## Round 6 retrospective: where the kernel's picture and the domain's picture still disagree most

The kernel sees a fitted model as a Part (a value with a hash) whose history is a set of edges between calls. My domain sees a fitted model as a function OF its training rows: "trained on train rows only" is a statement about where the model's numbers came from, and it must survive the model being copied, saved and handed to a later run. The kernel's record and its checks cannot make that statement: a check sees Parts, so two models with equal numbers from different fits are one Part (N2, N4, N6, N17), and a model passed as a plain value has no producer at all (picture 6c, run 21). The green and red of 1c and 5b is computed by `lineage.mjs` from `x-role` annotations; it is not a verdict of the kernel's. A reader of my pictures gets two things wrong because of that: a green `train only` box reads as something the kernel certified, when it only says that this run's edges lead back to the train rows; and a green audit header reads as "no leakage", when it says only that the standardizer matches the statistics of the rows it was handed (the audit is blind when the reference seat itself is filled wrong, picture 13b).

## What fitted cleanly in round 5 (no friction)

- **`else` and inherited skips:** one guard and one derived complement replaced two relations plus a duplicate; the decisions the trace records for the skipped case carry the original cause (`decisions[1].from` equals `decisions[0].from`).
- **A slot select as a pin:** the line `world.select(..., 'reference')` that round 4 had to apologise for in a comment now does what it said; no caller change, no pin in the tests.
- **Path landing:** the dead path that v0.4 accepted is now one assertion that throws, with a message that says what happened ("no call chain matched, or a longer path always won").
- **`trajectory`:** two ticks of k-means checked tick by tick inside `prove`, in six lines of example.
- **`receipt.fillConsulted` and the fill line:** the three pictures of picture 13 say, under the title, which key was used. This is what made the audit pictures legible with no extra words.
- **No call id moved:** because the same calls run, pictures 1, 1b, 5, 9, 11 kept their ids from round 4; the only edits in them are the decision rows.

## What did not fit, or was not used

- **Tick dependency (`ctx.tick()` as a cache dependency).** No implementation in this domain reads the tick number: k-means carries everything in `state`, so the new rule has no effect here. I found no friction because I did not use it; I make no claim about it. The visible consequence of the tick work in my pictures is indirect: a drive made by `ctx.drive` leaves per-tick entries that a later `world.drive` reuses (picture 10, third strip).
- **`first` with more than two alternatives, `NO_BRANCH`, nested `when`:** not needed. One two-way branch (`aug`) is the only conditional composition step; the other branch is `ctx.when`.
- **A cross-validation pipeline** (fit and predict per fold, `concat` the held-out predictions, `ctx.drive` over folds) is the natural use of `concat` plus `ctx.drive` in this domain. I did not build it this round; the evidence for `concat` here is the augment case only.

## What fitted cleanly in round 3 (no friction)

- `ctx.drive` replacing the hand loop (N5): the replacement was mechanical and shorter, and every existing k-means test passed unchanged (seed behaviour, iteration count, centroids, replay).
- Examples with `ticks` and with `fill`: the multi-tick `kmeans.step` example and the leaky-pipeline audit example were one line each and proved on the first run.
- `world.node` / `world.ref`: three call sites in `lineage.mjs` and one test each, no surprises; `world.ref` on an inner call is a feature I would not have thought to ask for, and it is the clearest way to apply "the standardizer as it was inside that pipeline".
- Cached verdicts: the second run of an audit has its verdicts, marked `cached` with `cachedFrom`, and a rejected verdict stays rejected (test 'v0.3 cached verdicts').
- `BAD_FILL` for a typo and `UNDECLARED_SLOT` for a bare call: both fired exactly where tests aimed them.

## What fitted cleanly (no friction)

- Building on contest A through `ctx.call` only; nothing copied.
- Composition `{gather}` for `linear.fit` and `constant.fit`, including a `{literal}` kind tag: lint accepted it (gather is typed `object`), the trace shows the brackets. Writing a model as a composition is now ordinary.
- `{at: ['$in.model', 'coefficients']}` and `ctx.at(model, 'means', j)`: the labels `[means.0]`, `[sds.0]` appear on the `vec.standardize` rows (picture 1, box #14).
- A check as a composition (`fitted.audit.pipeline`) that returns another check's `accepted` and `reason` ports: green and red headers (picture 8) with the verdict list in `receipt.verdicts`. Sub-checks appear in the verdict list too (`[audit.pipeline, audit.standardizer]`).
- Cross-run edges through a pipeline output (`pipe.refs.regression` into a later `linear.apply`): `resolveProducer` walks node.out provenance down to call #20 in run 1 (test 'a model applied in a later run...').
- Ticks: `drive` over `kmeans.step` with `until`, per-tick `← run k` edge, replay of one tick in a fresh world (test 'tick kind: ...').
- Slots, as a naming of call sites in a trace (`#train`, `#test`, `#model`, `#baseline` on 8 headers of picture 1b).
