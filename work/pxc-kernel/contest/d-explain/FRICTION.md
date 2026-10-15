# Contest D friction report (round 1, with round 2 to round 6 status under each heading, then new round-2 friction, then new round-3 friction, then new round-4 friction, then new round-5 friction, then new round-6 friction at the end)

## The key question: is a check just another contract?

Mostly yes, and that is evidence for the kernel as it stands. Every check here is `{ in: the Parts being judged, out: { accepted, reason, residual, judged } }`, implemented, composed, cached, replayed, proven by examples (each check has an accepting and a rejecting example, derived by hand) and traced with no new noun. What the kernel could not express is not the shape of a check but five things around it, each below: (1) the kernel does not know a verdict is a verdict, (2) a verdict can name what it judged only by value hash, (3) a check cannot be attached to an earlier run exactly, (4) there are two incompatible failure channels, (5) the cache can let a wrong implementation answer for a right one. Items 2, 3 and 5 are the ones that matter for trust.

Answers to the four recorded questions:
- **Can a result point at the exact Parts it judged?** By value only. `judged` carries `{hash, path?}` built from `Ref.hash`. Equal values share a hash (the 106 is produced by four different calls), so the pointer is to a Part, not to an occurrence. See F-2.
- **Can it be attached to a run after the fact?** Mechanically yes (pass values); exactly no. See F-3 and `d5-attach.png`.
- **Throw or return?** Return, for a judgement that is data. A throwing implementation of the same contract fails its own rejecting example under `prove`, loses the trace, and leaves no receipt. See F-4.
- **What does the trace look like?** An ordinary box with `accepted = false` as a purple output row (`d4` box #15, `d1` box #10). Nothing marks it as a check or as failed; the claim hash is the only handle.

## F-1 The kernel does not know what a verdict is

**Round 6 status:** Resolved (unchanged). d4 #1 #3 #16 red; d6b #3 red under the hatch (the audit's fix keeps the mark).

**Round 5 status: Resolved** (unchanged). d4 #1 #3 #16 red `check ✕`, d12 #1 green.

**Round 4 status: Resolved** (unchanged). `test: checks are first-class…` still lists `checkClaim, checkEffectClaim, checkAgreement`; d4 #1 #3 #16 red `check ✕`; d6a #3 and #4 keep their green under the cache hatch.

**Round 3 status: Resolved** (unchanged). Evidence: `test: checks are first-class…` now lists `checkClaim, checkEffectClaim, checkAgreement` for an effect claim; d4 #1 #3 #16 red `check ✕`.

**Round 2 status: Resolved.** `kind:'check'` is enforced (`test: declaring a check without accepted:boolean and reason:string is refused`), trace nodes carry `kind` and `receipt.verdicts` lists every check (`test: checks are first-class…`). `traceToSvg` draws green `check ✓` and red `check ✕` headers (d1 #10, d4 #1 and #15, d2d #1 and #6, d6b #3 and #7). The `checkNodes` workaround is now `receipt.verdicts`. New related friction: F-10, F-11.

- **Needed:** to find the checks in a run, see which failed, and colour or aggregate them without knowing my port names.
- **Kernel today:** `contract.kind` accepts `'check'` (I set it) but it is inert. Trace nodes do not carry `kind` (`test: checks are findable in a trace only through their contract kind`: `trace.calls[1].kind === undefined`). `traceToSvg` draws a rejected check exactly like a `lin.dot`.
- **Workaround:** `checkNodes(world, trace)` in `contest/d-explain/index.mjs` looks the contract kind up in `world.contracts()` and reads `accepted` from `world.part(hash)`.
- **Proposed shape:** for `kind: 'check'`, require `out.accepted: boolean` and `out.reason: string`; add `node.verdict = { accepted, reason }` to the trace node; `traceToSvg` colours it. `world.runs()` entries gain `verdicts: [{call, accepted}]`.
- **Severity:** distorts the trace.
- **Evidence:** `d1-explain-trace.png` box #10 and `d4` box #15 (a rejection looks like any call); the test above.

## F-2 A verdict can only point at a Part by value hash

**Round 6 status:** Partly resolved (unchanged: trace side Resolved, Part side Open by design).

**Round 5 status: Partly resolved (unchanged: trace side Resolved, Part side Open by design).** d5c is the same lineage table.

**Round 4 status: Partly resolved (unchanged: trace side Resolved, Part side Open by design).** d5c is still the lineage table; `judged` is still a hash map. d5b now tags the call: `← run 3 #3` (F-20).

**Round 3 status: Partly resolved (trace side Resolved, Part side Open by design).** `world.node` and `world.ref` now name the exact call: `test: judgedCalls for a claim checked after the fact…` (prediction came from `lin.dot` #8 of run 3), `d5c-lineage.png` (the four chains), `d5b-inner-call-attach.png`. The verdict Part still points only by hash (`judged`, `resolvePointer`), kept because a verdict read alone has no trace. New: the `← run k` tag does not name the call (F-20).

**Round 2 status: Partly resolved.** The trace now records the exact occurrence a check read (run, call, port: d5, d4 root input tags `← run 1/2/3`, and `[1]` path labels on `ctx.at` pieces), so a reader of the trace no longer needs the hash. The verdict Part itself still cannot name what it judged except by `{hash, path}`, and `judged` is kept for that reason: a verdict read alone (an output hash in a receipt, a cached verdict) has no trace attached. No `ctx.cite` was added. Evidence: `test: a check result points at the Parts it judged` still passes; `d5-attach.png`. Remaining part: see F-14.

- **Needed:** "this verdict judged this occurrence of 27.5 (the second element of that contributions vector, produced by call #2 port `contributions`)".
- **Kernel today:** an implementation can read `ref.hash` and `ref.from`. Hash identifies a value (`producers()` finds four producers of 106). `ref.from` holds call ids, which are run-local; putting it in an output Part is wrong under the cache because the key ignores `from` (`test: embedding Ref.from in a Part would be wrong under the cache`: a cached call replays call id 1 inside a run where the call is #2).
- **Workaround:** `judged: { port: {hash, path?} }`, built with `point(ref, path)` (`index.mjs`, top). It survives caching, but is a value pointer.
- **Proposed shape:** `ctx.cite(ref): { hash: string, path?: (string|number)[] }` as a Part-safe pointer, plus trace-side `node.cites: [{port, call, port}]` filled by the kernel from the Ref's real provenance at the time of the call (outside the cached Part). Then the exact occurrence is in the trace and the Part stays stable.
- **Severity:** distorts the trace (the trace shows what was bound; the verdict Part cannot say it).
- **Evidence:** `test: a check result points at the Parts it judged`; `d5-attach.png`, rows `prediction` and `contributions` list several producers.

## F-3 A check cannot be attached to an earlier run by exact binding

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved** (unchanged). d5b `actual = 93 ← run 3 #3`.

**Round 4 status: Resolved** (unchanged). `test: world.ref attaches a check to an INNER call…`; d5b.

**Round 3 status: Resolved.** A check attaches to an inner call that was never a root output: `test: world.ref attaches a check to an INNER call of an earlier run…` (`predict#baseline`, call #3 of run 3, `actual = 93 ← run 3` in d5b). `judgedCalls` is 20 lines on top of `world.node`; the `producers()` scan stays deleted.

**Round 2 status: Partly resolved.** Cross-run Refs work: `test: a check attaches to an earlier run EXACTLY…`, `d5-attach.png` and `d4` tags. The `producers()` hash scan is deleted. What is still missing: `world.run` returns `refs` only for the ROOT outputs of a run. A claim about an inner Part of run #3 (the `value` of `explain.predict#baseline`, call #3) cannot be attached to that call; it can only be attached because `explain.explain` happens to re-export `baselinePrediction`. Proposed: `result.callRefs(callId, port): Ref` or `world.ref({run, call, port})`. Severity: ergonomic now (re-export works), blocks for a check on a Part that was never an output.

- **Needed:** run a check after the fact on "contributions as produced by call #2 of run 3" and have the check's trace say so.
- **Kernel today:** `world.run` takes values. Passing a Ref from another run is accepted (`mint` returns Refs unchanged) but the root input keeps the old `from`, `{kind:'call', call:1, port:'model'}`, with no run id; in the new run call 1 is the checker itself (`test: passing a Ref from an earlier run … stale from`). Passing plain values records `{kind:'input', call:0}` (`d5` column "recorded from").
- **Workaround:** `producers(trace, hash)` finds earlier calls with an equal output hash. Ambiguous (see F-2) and absent for Parts that were never produced in that run (`claim`, `input`, `tolerance`; `model` and `baseline` came from other runs).
- **Proposed shape:** `from: {kind:'call', run: number, call: number, port: string}` everywhere, and `world.run(contract, inputs, {after: receipt})` so root inputs given as `{ref: {run, call, port}}` are minted with that provenance and the viewer draws a cross-run edge.
- **Severity:** blocks exact attachment; the stale `from` also makes `traceToSvg` draw a bogus bracket from the root box to itself (checked: one extra `e-call` path `M14,161.9 H4 V76.9 H14`, because it keys boxes by call id alone). Not rendered to a PNG.
- **Evidence:** the two tests above; `d5-attach.png`.

## F-4 Two channels for "no", and the throwing one is lossy

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved** (unchanged). The `UNKNOWN_FEATURE` guard is the `lt(#2.index=0, 0)` row of d7.

**Round 4 status: Resolved** (unchanged). `ctx.fault` codes are used by the guards (`UNKNOWN_FEATURE`) whose decision is now a test (d7).

**Round 3 status: Resolved.** A failed receipt has `verdicts` (see F-10). Throws can be named: `ctx.fault(message, code)` replaced every `throw new Error` in the entry; `test: failure policy…` asserts `code 'CHECK_REJECTED'` where round 2 saw `IMPL_ERROR`; `test: ctx.fault names the failures…` (`UNKNOWN_FEATURE`, `FIT_SHAPE`). Two channels remain by design (a verdict returns, a malformed input throws) and `prove` still fails the throwing implementation's rejecting example.

**Round 2 status: Resolved for the trace, Partly for the receipt.** A throw now leaves a trace with `node.error`, `error.trace`, `error.receipt` and a `status:'failed'` receipt in `runs()` (`test: failure policy…`, `test: a malformed claim is still an exception…`). Two channels remain by design (a verdict returns, malformed input throws) and my contract still returns. New gap: a failed receipt has no `verdicts` field (F-10).

- **Needed:** reject a fabricated claim with a reason, whatever the claim looks like.
- **Kernel today:** a rejection is a returned value (fine, run recorded). But (a) an `Error` thrown by an implementation gets no `error.trace` (`run()` only attaches it to `KernelError`) and no receipt (`test: failure policy`); (b) a structurally malformed claim fails `INPUT_SCHEMA` before the root node exists: exception, no trace, not a rejection (`test: a malformed claim is a schema failure`); (c) `prove` treats the throwing implementation of the same contract as failing the rejecting example (`explain.checkReconstruction/throwing#1`), so throw-versus-return is part of the contract, not of the implementation.
- **Workaround:** the contract returns verdicts; the schema for claims is the union of three exact shapes, and anything outside it is an exception by design. `checkClaim` rejects semantic problems (unknown feature, vacuous claim).
- **Proposed shape:** `run(..., {onFail: 'return'})` returning `{error, trace, receipt}` instead of throwing, with failed runs recorded in `world.runs()`; implementation-thrown errors wrapped as `KernelError('IMPL_THROW', {cause})` carrying the trace.
- **Severity:** distorts the trace (a failed run is invisible).
- **Evidence:** `test: failure policy`, `test: a malformed claim`; `prove` output for `throwing#1`.

## F-5 BUG: the cache key ignores nested fills, and `cache:false` still writes the cache

**Round 6 status:** Resolved (unchanged). `chosenBy` now names the rung of every choice: d2d #5 `by contract explain.contributions`.

**Round 5 status: Resolved** (unchanged). Specificity-first did not change any run here: no seat of mine is pinned by `select`, so no contract fill ever collided with a pin (count below).

**Round 4 status: Resolved** (unchanged). d2d reuses #3 and #4 under the mutant; d11 and d10b show fills keyed by path and by contract serving later runs correctly. Cache entries are path-aware in v0.4 (ledger seq 38).

**Round 3 status: Resolved** (unchanged; `test: a run filled with another implementation no longer poisons later default runs`). Used again in d2d (#3, #4 reused under the mutant fill, correct) and d10b (capped fill, `withIntercept` and `lin.dot` served from run 3 because they are not filled).

**Round 2 status: Resolved.** `test: a run filled with another implementation no longer poisons later default runs` (same scenario, flipped). The mutant now runs in the same world as the claims: `verify/render-d-explain.mjs`, `mutant`, before the 12 claim runs. Picture check: d4 box #3 `contributionBefore = -14.5` (round 1 showed `-24`) and box #5 `contributions = [27.5,-14.5,2.32156e-15]`. The separate-world workaround is removed.

- **Needed:** to mutate an implementation (a deliberately wrong `explain.contributions`) and see a check catch it, without disturbing correct runs.
- **Kernel today:** `invoke` writes `cache.set(key, …)` whenever `impl.pure`, even when `state.cacheOn` is false. The key is `impl@version|port=hash…` of the *called* implementation only. A composition's key does not mention that a nested contract was filled differently. Result: `explain.attribute` run with the wrong fill, then a default `explain.attribute`, returns the wrong `[8, -15]` instead of `[6, -9]`, marked `cached` from run 1 (`test: KERNEL BUG (documented)`). It corrupted my first d4 render (box #5 showed the mutant's contributions; see EXPLAIN D-18).
- **Workaround:** run mutants in a separate world (`wm` in `verify/render-d-explain.mjs`).
- **Proposed shape:** only write the cache when `cacheOn`; and add the resolved fill of every contract in `impl.uses` (transitively) to the key: `key = impl@version|fills|inputs`, where `fills` is the sorted list of `contract=impl` actually chosen below.
- **Severity:** blocks (a check's verdict can be answered from another implementation's cached result, which defeats ablation and mutation testing of checks).
- **Evidence:** `test: KERNEL BUG (documented)`; `d4-rejected-effect-trace.png` (second render is clean, first was not, history in EXPLAIN D-18).

## F-6 No inverse of `ctx.at`: objects built from Refs are "computed"

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved** (unchanged).

**Round 4 status: Resolved, and used again.** `collect` gives the sweep's predictions with pieces pointing at each tick's own output (test `sweep: ticks are numbered from 1…`). The picture of that gather is hard to read (F-12, F-27).

**Round 3 status: Resolved, and now used further.** `ctx.gather` and `ctx.concat` build `model`, the design matrix (`gather` of `concat`, 8 rows), `withIntercept`, `baselineMeans` (each baseline element points at its `stat.mean` call), the nudged input (only the moved element is `computed`) and the sweep state. Test: `concat and gather keep provenance…`; picture: d1 #4 and #7, d1b #2, d4 #7. Strings I build (`subject`, `reason`) are still `computed`, correctly.

**Round 2 status: Resolved.** `explain.fit` returns `ctx.gather({features, coefficients: ls.coefficients})` (`index.mjs`, `explain.fit/least-squares`); `test: the model gathered in fit records where each half came from`; `d1b-fit-trace.png` box #1 row `model` labelled `gather[features]` and `gather[coefficients]`. Still `computed` where I build strings (`subject`, `reason`): that is correct, they are text, not Refs. New friction with gather itself: F-12.

- **Needed:** build the model `{features, coefficients}` from `lin.leastSquares`'s output Ref, and `judged` / the nudged input from Refs, keeping provenance.
- **Kernel today:** `ctx.at` splits; nothing joins. Returning a plain object records `{kind:'computed'}` for the output and for any plain argument (`d4` box #15, input `subject = "…" computed`, red tag).
- **Workaround:** none; the model Part in `explain.fit` is a fresh object (`index.mjs`, `explain.fit/least-squares`). The trace says `leastSquares → coefficients` (bound) and then `model` (computed); the link is by reading.
- **Proposed shape:** `ctx.make(template: object, refs: {[path]: Ref}) : Ref`, recording `{kind:'make', parts: {path: from}}`.
- **Severity:** distorts the trace (same limitation as contest A's matrix-vector rows, from the other side).
- **Evidence:** `d4` box #15 `computed` tag; `explain.fit` and `explain.baselineMeans` outputs.

## F-7 Dispatch on data, and no way to combine verdicts

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved** (unchanged). `checkClaim/routed` is now four `else`/`and` guards (see F-26); the imperative twin still agrees on all 12 claims.

**Round 4 status: Resolved.** Both halves. The cost F-15 named is gone: `explain.routeClaim` is deleted and `checkClaim/routed` branches on tests with `one`. The imperative twin is still the differential oracle (`test: the routed checkClaim equals the round-2 imperative one…`).

**Round 3 status: Resolved, with a cost (F-15).** (a) `explain.checkClaim/routed` is a composition with `when` and `first`; the imperative version stays as a differential oracle (`test: the routed checkClaim equals the round-2 imperative one on all 12 claims`). Pictures: d4 root decision rows, d5, d4b. (b) unchanged from round 2.

**Round 2 status: (a) Resolved as noise, still Open as structure; (b) Resolved.** (a) the `unusedDependency` note is gone (`test: dispatching on claim.kind no longer produces an unusedDependency note`) but compositions still cannot branch, so `explain.checkClaim` stays imperative: `{ when }` steps are still missing. (b) Combining verdicts IS expressible now: `explain.allAccepted` (kind check) takes `verdicts` built with a gather of gathers, composed in `explain.checkedClaim/both`. `test: F-7 second half…`, `d6-checked-claim.png` (d6a all green, d6b #3 red, #4 green, #7 red). It is expressible but with a cost, see F-14.

- **Needed:** (a) `checkClaim` calls a different checker per `claim.kind`; (b) a final "claim accepted AND the attribution it was judged against reconstructs" verdict.
- **Kernel today:** (a) compositions have no branching, so `explain.checkClaim` is imperative with `uses` of all callees; runs that skip `explain.effect` get `notes: [{kind:'unusedDependency', …}]` which is noise for an intended branch (`test: dispatching on claim.kind`). (b) a composition cannot compute or combine booleans; `explain.explain` returns the reconstruction verdict only, the claim verdict is a separate run, and nothing says one is meaningful only when the other is accepted.
- **Workaround:** (a) accept the note. (b) none; the two verdicts are separate runs.
- **Proposed shape:** `{ when: 'step.port', call, bind }` steps (skipped steps recorded `skipped: true` rather than unused), and a `kind:'check'` combinator `check.allOf({verdicts: [verdict]}) → verdict` that records the verdicts it combined.
- **Severity:** ergonomic only (a), distorts (b).
- **Evidence:** `test: dispatching on claim.kind`; `explain.explain` returning only `rec.*`.

## F-8 Union-typed port lint: a oneOf cannot be forwarded into an identical oneOf

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved** (unchanged).

**Round 4 status: Resolved** (unchanged).

**Round 3 status: Resolved** (unchanged).

**Round 2 status: Resolved.** `test: assembly lint: a oneOf output can now be forwarded into an identical oneOf port`. The workaround is removed: one `verdict` shape (residual is `oneOf [number, null]`) serves every check, and `explain.checkedClaim` forwards `checkClaim.residual` as `claimResidual` (`test: the forwarded oneOf is used for real`).

- **Needed:** `checkClaim.residual` may be a number or null (unknown feature has no residual); `claim` is a three-way union input.
- **Kernel today:** the `oneOf` input (`claim`) worked: exactly-one matching with `kind` enums and `additionalProperties:false`. But composition lint rejects forwarding `oneOf [number,null]` into the same `oneOf` (`compatible()`: `target.oneOf` then `source.oneOf.every(s => compatible(s, t))` per branch; `null` against `number` fails). `test: assembly lint: a oneOf output cannot be forwarded into an identical oneOf port`.
- **Workaround:** only `explain.checkClaim` (imperative) has the optional residual (`verdictOptionalResidual`); every composed check uses plain `number`.
- **Proposed shape:** in `compatible`, compare `source.oneOf` to `target.oneOf` structurally first (`canonical(source) === canonical(target)` → compatible), else every source branch must fit some target branch.
- **Severity:** ergonomic only.
- **Evidence:** the test; `index.mjs` comment above `verdictOptionalResidual`.

## F-9 Smaller points

**Round 6 status:** Open (all four ergonomic, unchanged).

**Round 5 status: Open (all four ergonomic, unchanged).** The `judged` row is still cut in d1 and d4; `explain.effect` is still imperative with a test guard.

**Round 4 status: Open (all four ergonomic, unchanged).** The effect guard is now a test (`lt(index, 0)`, d7 amber edge), which was the sharpening round 3 named; `explain.effect` itself stays imperative; `judged` still cut in d1 and d4 (default `valueChars`).

**Round 3 status: Open (all four ergonomic), one of them sharper.** Static `ctx.at` paths in compositions: still unchanged; `explain.effect` stays imperative, and its guard is now an untraced-provenance decision (F-16). Two tolerances: unchanged. Examples cannot omit a port: unchanged (`judged`). `valueChars`: unchanged, the `judged` row is still cut at 44 in d1, d4, d5 (a render option I did not use).

**Round 2 status: Open (all four ergonomic).** Static `ctx.at` paths in compositions: unchanged. Two tolerances: unchanged. `valueChars` is now a view option, so the `judged` truncation in d1 and d4 is fixable per render; I left the default. Example-ports problem: unchanged (`judged` is still omitted from examples).

- `ctx.at` takes static paths; a feature index known only at run time cannot be a composition step, so `explain.effect` is imperative (`{ at: [spec, {from: 'step.port'}] }` would fix it). Ergonomic.
- Contract `tolerance` is relative (`close()`: `tol * max(1, |a|, |b|)`), my checks use an absolute tolerance given as an input port; two notions of tolerance. The float noise (`age` contribution 2.3e-15, `b_age = 3.6e-16`) is why the claim checker needs one at all. Ergonomic.
- Examples compare every port written in `out`, so hash-valued `judged` has no hand-derivable expected value; I left it out of examples (only `accepted`, `residual`, sometimes `reason`). A contract cannot say "this port is not part of the example". Ergonomic.
- `traceToSvg` cuts values at 42 characters, so a `judged` pointer is unreadable in the trace picture (`d1` box #10). Ergonomic.

## What fitted cleanly (no friction)

- Reusing contest A: `lin.leastSquares` (through `explain.fit`), `lin.dot` (through `explain.predict`), `lin.transpose` and `stat.mean` (through `explain.baselineMeans`), all through `ctx.call` with Refs and declared `uses`; the fit trace shows A's whole normal-equations composition nested inside (`test: fit recovers … through lin.leastSquares`).
- Exact bindings between judged and judging: in `d1`, the reconstruction check's inputs are recorded as calls #2 outputs (blue brackets), asserted in `test: attribution`.
- Compositions as data for `explain.attribute`, `explain.perturbAndCheck`, `explain.explain`; assembly lint caught my one real wiring slip (F-8).
- `oneOf` for the three-kind claim input, with exactly-one validation.
- Examples plus `prove`: found the deliberately wrong `no-baseline` implementation and the throwing check (only where expected, `test: every example proves …`).
- Fill as ablation: `no-baseline` is caught by the reconstruction check and is **not** caught by the perturbation check (the baseline cancels in a difference), `test: mutation`, `d2` panel D2c.
- Cache: repeated sub-calls in the effect check hit the cache (`d4` #2, #4, #5, #8); replay of the explain-and-check run is exact.

## Round 2: new friction, found by migrating to v0.2

### F-10 A failed receipt carries no verdicts

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved** (unchanged).

**Round 4 status: Resolved** (unchanged).

**Round 3 status: Resolved.** Flipped tests 56 and 57 (names below). `test: F-10 flipped, the case that matters…`: a combiner that faults after `checkReconstruction`, `checkClaim`, `checkContributionClaim`, `checkAgreement` finished keeps those four on `caught.receipt.verdicts` and in `runs()`, the first one marked cached.

- **Needed:** after a throw inside a composition of checks (for example `explain.checkedClaim` where the second inner check throws on malformed input), still list the verdicts of the checks that DID finish.
- **Kernel today:** the failed receipt is `{...head, status:'failed', error, calls, trace}` (`src/kernel.mjs`, run()); no `verdicts` key. `test: failure policy…` asserts `runs().at(-1).verdicts === undefined`.
- **Workaround:** none needed in this entry (my checks return); a reader must walk `receipt.trace` for `kind:'check'` nodes without `error`.
- **Proposed shape:** `verdicts: collectVerdicts(root.calls[0])` on failed receipts too (skipping nodes with `error`).
- **Severity:** ergonomic only.
- **Evidence:** the test above.

### F-11 `kind` is per contract, but one contract can both produce and judge

**Round 6 status:** Open (unchanged).

**Round 5 status: Open (unchanged).**

**Round 4 status: Open (unchanged).** d1 #1 and d2d #1 are red or green because `explain.explain` is a check that also returns an attribution.

**Round 3 status: Open (a naming decision, unchanged).** `explain.explain` is still a `check` that also returns an attribution; d1 #1 and d2d #1 are red/green because of it.

- **Needed:** `explain.explain` returns an attribution and a verdict about it. Is it a calculation or a check?
- **Kernel today:** a contract has one `kind`. If `check`, the root of the trace is red/green and `receipt.verdicts` lists it, but `explain.explain` is not purely a judgement (it also returns three numbers). If `calculation`, the verdict is only visible on the nested `checkReconstruction` box (d2d: #6 red, root grey).
- **Workaround:** declared `kind:'check'` (`index.mjs`, `explain.explain`), because a red root is what a reader wants. `test: checks are first-class…` pins the choice.
- **Proposed shape:** none needed for the kernel; the question is whether `check` should require "no other outputs the verdict is not about". My view: leave it; the enforced pair `accepted`, `reason` is a floor, not a purity rule.
- **Severity:** ergonomic only (a naming decision).
- **Evidence:** `d1-explain-trace.png` root #1 header, `d2d-mutant-trace.png` root #1 red.

### F-12 Gather labels do not scale to nested gathers

**Round 6 status:** Partly resolved. Predictions pieces now name their tick (F-27). The design matrix is still the group label `gather ×8 pieces ×24 passthrough` (d1b #2).

**Round 5 status: Partly resolved (better).** The `predictions` row reads per piece (`gather[0] [0]gather[1] [1]gather[2] [2]gather[3]`, d9a #2 and d10b #2), not `pieces ×4 pieces ×4 pieces ×4`. The design matrix is still the group label `gather ×8 pieces ×24 passthrough` (d1b #2, whole gather, nothing selected).

**Round 4 status: Partly resolved.** The `trail` chain label is gone because `collect` replaced it. Nested labels still concatenate and repeat: d10b #2 `predictions` reads `gather[0] pieces ×4 pieces ×4 pieces ×4`; d6a #5 `gather[0][accepted] gather[0][reason]`. See F-27.

**Round 3 status: Partly resolved.** Grouping works (`gather ×8 pieces ×24 passthrough`, d1b #2; `pieces ×3` on sweep state, d9). Nested labels still concatenate: `gather[trail]gather[0]←[0]←[trail]` (d9a #5 state rows), `gather[0]gather[accepted]` (d6a #5, d6b #10). Evidence is in those pictures, the pieces themselves are right in the data (test `F-7 second half…`).

- **Needed:** to read what a gathered value is made of.
- **Kernel today:** `traceToSvg` prints each piece's label after the value on the same row (`d1b` box #1: `gather[features] passthrough gather[coefficients]`; `d6b` #7: `gather[0]gather[accepted] gather[0]gather[…` cut at the box edge). The gather of gathers in `explain.checkedClaim/both` is the case where it cuts off. The pieces ARE in the trace (`test: F-7 second half…` reads them back); only the picture loses them.
- **Workaround:** none; I read pieces from the trace data in the test.
- **Proposed shape:** one line per piece under a gathered input row (`  [0].accepted ← #3 accepted`), or an expand-on-demand view option `gatherRows: true`.
- **Severity:** ergonomic only (picture), distorts the trace picture for nested gathers.
- **Evidence:** `d6-checked-claim.png` box #7 row `verdicts` in D6b.

### F-13 A slot fill needs a `select` for every other slot

**Round 6 status:** Resolved by convention (unchanged).

**Round 5 status: Resolved by convention** (unchanged). `explain.predict#*` with one exact slot fill now says 'every seat but the start': `test: specificity (v0.5)…`.

**Round 4 status: Resolved by convention** (unchanged). Path slots do not change it: d11 needed one `select` only (the default, registered once) plus the path key.

**Round 3 status: Resolved by convention.** `register()` now selects `explain.predict/dot` once, so adding `explain.predict/capped` or `/zero` never makes a slot ambiguous: `test: slot fill: the baseline prediction alone can be filled…` no longer calls `select`. Kernel unchanged. With declared slots the remaining requirement (a default must exist) is at least stated in one place.

- **Needed:** fill only `explain.predict#baseline` with a second implementation and leave `explain.predict#input` alone.
- **Kernel today:** registering a second implementation of `explain.predict` makes the unfilled slot `AMBIGUOUS` ("explain.predict#input has 2 implementations and none selected") until `world.select` is called (`test: slot fill…`). Correct per the no-silent-default rule, and the error names the slot.
- **Workaround:** `world.select('explain.predict', 'explain.predict/dot')` in the test.
- **Proposed shape:** none; record that a slot fill is an override on top of a selected default, never a way to choose without one.
- **Severity:** ergonomic only.
- **Evidence:** `test: slot fill: the baseline prediction alone can be filled…`.

### F-14 A verdict is four ports, not one Part, so combining checks copies fragments

**Round 6 status:** Open (unchanged).

**Round 5 status: Open (unchanged).**

**Round 4 status: Open (unchanged).** d6a #5 and d6b #9 still gather four verdict ports.

**Round 3 status: Open.** Combining is unchanged: gather of gathers into `allAccepted` (d6a #5, d6b #10) and a hand-written `vd` schema. Cached verdicts (F-17) make the cost visible: the combiner reads `{accepted, reason}` fragments while the receipt lists whole verdicts.

- **Needed:** `explain.allAccepted` should take "these two verdicts" and return one, keeping each member's `judged`.
- **Kernel today:** a check's result is a set of out ports. To combine, I gather `{accepted, reason}` from each (`explain.checkedClaim/both`, step `all`): `judged` and `residual` are dropped, and the combined verdict names the members only through the trace's gather pieces (`d6b` box #7). A check cannot take another check's verdict as one typed value, and cannot declare "my input is a verdict" (the `vd` schema in `index.mjs` re-declares the shape by hand).
- **Workaround:** gather of gathers plus a hand-written `vd` schema.
- **Proposed shape:** `kind:'check'` contracts get a derived port `verdict: { accepted, reason }` (a Part, assembled by the kernel), so `{ gather: ['rec.verdict', 'clm.verdict'] }` works and `allAccepted` takes `verdicts: [verdict]` without a local schema; or a named shared schema `verdict` (the kernel notes it as deferred, this is a second entry-level use of one).
- **Severity:** ergonomic only; it works today.
- **Evidence:** `test: F-7 second half…`; `d6-checked-claim.png` #5 and #7.

### Observed and fine (no friction)

- A cached check run keeps its own provenance: claim 3 judged against run 4's prediction, served from the entry made for run 3, records `in.prediction.from = {kind:'run', run:4, …}` (probe, not a test), so the verdict is about a Part by value and the node says which occurrence it was asked about.
- `explain.explain` as `kind:'check'` and `explain.checkReconstruction` nested in it both appear in `receipt.verdicts` in call order (`test: checks are first-class…`).
- Slots made the trace readable with no code beyond `{ slot }` (d1 `#baseline`, `#input`; d7 `#before`, `#after`).
- Gather of gathers worked at the composition level with no lint change (`explain.checkedClaim/both`).


## Round 3: new friction, found by migrating to v0.3

Each point ends with one line: what a concept that contains its own other would want (Hegel), against what the actual use here shows (Wittgenstein).

### F-15 `when` needs booleans, and a router has to manufacture them

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved** (round 4), and cheaper now: every guard is written once (F-26).

**Round 4 status: Resolved.** `explain.routeClaim` and its five booleans are deleted: contracts 29 to 28, and the branch is a test on the claim kind (`eq($in.claim[kind], literal 'effect')`) with `one` over the five alternatives; `test: overlapping when conditions…` is flipped (`first` still runs both, `one` is `AMBIGUOUS_BRANCH`, no live branch is `NO_BRANCH`). New costs: F-24, F-26.

- **Needed:** `explain.checkClaim` picks one of five branches by `claim.kind`, plus "feature exists" and "delta is zero".
- **Kernel today:** a step's `when` must read a boolean. So `explain.routeClaim` exists only to turn `claim.kind` into five booleans, exactly one true (`prediction`, `unknownFeature`, `contribution`, `vacuousEffect`, `effect`), and the five branches each became a contract (`checkPredictionClaim`, `rejectUnknownFeature`, `checkContributionClaim`, `rejectVacuousClaim`, `checkEffectClaim`). The imperative version was one function of 25 lines. Exclusivity is nobody's job: `test: FRICTION (documented): overlapping when conditions run BOTH branches` shows two true booleans run two branches and `first` takes the earlier without a word. d4's root shows five decision rows to say one thing, "this was an effect claim".
- **Workaround:** the router's examples (5, one per branch) prove exclusivity by hand; nothing enforces it.
- **Proposed shape:** `when` on an equality, `when: { ref: 'route.kind', equals: 'effect' }`, and an exclusive `first` (`{ one: [...] }`) that fails with `AMBIGUOUS_BRANCH` when two alternatives ran, the counterpart of `NO_BRANCH`.
- **Severity:** distorts the trace (five rows for one decision) and costs six contracts.
- **Evidence:** d4 root, d5 root; `explain.routeClaim` in `index.mjs`; the overlap test.
- Hegel would say the branches are moments of one concept, so the router should return one tagged value and the composition should branch on which moment it is. Wittgenstein would say the use is the naming of a kind, 'effect', in a sentence a reader recognises; five booleans are a surrogate the grammar forces and none of them reads as a kind in the picture.

### F-16 A decision made by a comparison inside an implementation has no provenance

**Round 6 status:** Resolved for the decisions that mattered (unchanged); `diagnoseContributions` stays (F-25).

**Round 5 status: Resolved for the decisions that mattered** (unchanged); d7 and d10b now print the operand value (`lt(#2.index=0, 0)`).

**Round 4 status: Resolved for the decisions that mattered, Partly for the helper.** `ctx.test` and `ctx.when(test, …)` give provenance with operands: d7 `lt(#2.index, 0)` with an amber edge to #2 (round 3: `computed`, no edge); d4b `eq` and `ge` over `featureCount`, `contributionCount`, `owner`. `explain.diagnoseContributions` stays, because it searches (F-25).

- **Needed:** the decision "the model has no such feature" (`idx < 0`) and "contributions have one value per feature" shown with what decided them.
- **Kernel today:** `ctx.when(plainBoolean)` is accepted, but records `from: {kind:'computed'}`: d7 #1 bottom row reads `◇ the model has no such feature = false → not taken / read computed`, grey, no amber edge. Only a boolean that is a call's output gets the amber edge (d4b `#5.aligned`, `#5.belongs`). That is why `explain.diagnoseContributions` is a contract whose job is to produce `aligned`, `belongs`, `owner`.
- **Workaround:** a contract per comparison that matters (`diagnoseContributions`, `routeClaim`); for the two fault guards I kept the computed row.
- **Proposed shape:** `ctx.compare(a, op, b): Ref<boolean>` recording `{kind:'compare', op, left, right}`, so the decision row can say `read #3.index < 0`.
- **Severity:** ergonomic (cost: one contract per comparison), distorts the trace where I did not pay it.
- **Evidence:** `test: guards that fault are decisions now…`; d7 box #1; d4 box #4 bottom.
- Hegel would say a comparison is a relation between two Parts and the relation is part of what the decision means. Wittgenstein would say the picture only helps when the reader can follow the amber edge to a number; a row ending in `computed` is a label with no referent.

### F-17 A cached verdict's `call` is a number from another run

**Round 6 status:** Partly resolved. The audit's view fix stops a cached decision drawing an edge to the current run's same-numbered box (d6a #4: no edge to `explain.attribute` #2). The label still reads `lt(#2.index, 0)` with the original's `#2` (F-37), and the receipt's cached `call` is still the original run's id.

**Round 5 status: Partly resolved (unchanged).** The receipt's cached `call` is still the original run's id; d6a cached decisions name `#2` of the original run, which is not drawn (F-31).

**Round 4 status: Partly resolved.** The picture now names the origin (`cached from run 7 #2` on headers, `← run r #c` on tags). The receipt's cached `verdicts[].call` is still the original run's call id: d-facts `round3.d6.honest` lists `#1 explain.checkedClaim`, `#10 … (cached)`, `#1 explain.checkClaim (cached)`, `#3 …`, `#5 …`, `#5 explain.allAccepted` (the file key is still `round3`, the data is round 4). Not usable as a key.

- **Needed:** find, in this run, which node a verdict in `receipt.verdicts` belongs to.
- **Kernel today:** for cache hits the entry's `call` is the original run's call id. d-facts `round3.d6.honest` lists `#1 explain.checkedClaim`, `#10 explain.checkReconstruction (cached)`, `#1 explain.checkClaim (cached)`, `#3 …`, `#6 …`: two different calls are both `#1`, and the order is not call order. Only `cachedFrom` tells them apart.
- **Workaround:** none; my tests read `contract`, `accepted`, `cached`, `cachedFrom` and never `call` for cached entries.
- **Proposed shape:** `{ call: <this run's hit node id>, original: { run, call } }`.
- **Severity:** ergonomic, but it makes the field unusable as a key.
- **Evidence:** `test: cached verdicts…`; d-facts `round3.d6`; d6a #4 (the inner three are not drawn at all).
- Hegel would say the verdict is one thing with two places, here and its origin, and both belong in it. Wittgenstein would say the ids are only ever used to find a box in a picture, and for a cached verdict there is no box in this run's picture to find.

### F-18 Cached-verdict rows show reasons, not which check

**Round 6 status:** Resolved (the view). d6a and d8: one cached verdict per line, check name first.

**Round 5 status: Resolved in the view** (unchanged), with a new defect: the three rows run together (F-31).

**Round 4 status: Resolved (in the view).** d8 root and d6a #3 #4: `3 cached verdicts` rows are `✓ explain.checkClaim: …`, `✓ explain.checkContributi…`, `✓ explain.checkAgreement: …`; the check name leads each row (the longest names are cut with `…`).

- **Kernel today:** d8 root: `✓ 3 cached verdicts:` followed by three lines that all begin `"effect on prediction of changing si…;"` (the reasons of `checkClaim`, `checkEffectClaim`, `checkAgreement` share their text). d6a #4 the same.
- **Proposed shape:** `contract` first on each line: `checkEffectClaim ✓ "effect on …"`.
- **Severity:** ergonomic (picture only).
- **Evidence:** d8-cached-ghosts.png, d6-checked-claim.png.
- Hegel would say a verdict means the thing it judged. Wittgenstein would say the three lines are not three uses, they are one string repeated, because I wrote a composition of checks that all explain themselves with the same sentence.

### F-19 Header text and decision labels do not wrap

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved.** d4 root, d6a #4, d6b, d8 root, d11: every decision `read …` wraps inside the box (round 4: `contrib`, `vacuous`, `effect` lines left the box). The wrapped text is long, F-30.

**Round 4 status: Partly resolved.** Headers and the `cached from …` flag now stay inside the box (d4 #2 `explain.featureInd… · cached from run 7 #2`). Decision rows still overflow, and longer: d4 root `contrib`, `vacuous`, `effect` lines (`and(ne(...), eq(...), ge(#2.index, 0), ne(... delta ...))`), d6a #4, d6b #4 and #6, d4b #3 labels cross the right edge. Tests made the lines longer than the booleans they replaced. See F-24.

- **Kernel today:** rows wrap since v0.3, but the second header line (`impl · cached from run 3 #2`) and decision labels do not: d4 #5 and #6, d6a #2 and #3 and d8 #5, #6 and #16 headers run past the box edge or are clipped; the two `ctx.when` labels in d4b #3 and d6b #6, and the d7 `not taken` suffix, cross the purple brackets and the box edge.
- **Proposed shape:** wrap or truncate with `…` inside the box width, as rows do.
- **Severity:** ergonomic (picture only).
- **Evidence:** the pictures named.
- Hegel: a label belongs inside its box. Wittgenstein: I gave the labels sentence length because a decision row is a sentence; the view assumed identifiers.

### F-20 The cross-run tag names the run, not the call

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved** (unchanged).

**Round 4 status: Resolved (in the view).** d5b `actual = 93 ← run 3 #3` (round 3: `← run 3`); d1 box #1 `← run 1 #1`.

- **Kernel today:** `← run 3` (d5b `actual`) is the same tag for the root output `prediction` and for the inner call `predict#baseline` #3. The exact call is in `from.from` only.
- **Workaround:** `judgedCalls` plus the d5c lineage table.
- **Proposed shape:** `← run 3 #3.value`.
- **Severity:** ergonomic.
- **Evidence:** d5b next to its test; d5c shows what the tag could say.
- Hegel would say the Ref is the occurrence and the tag should name the whole occurrence. Wittgenstein would say the reader of d5b asks 'which 93?', and the tag answers 'the one from run 3', which was already known.

### F-21 `ctx.drive`: tick index is 0-based, the claim is 1-based, and collecting costs a state field

**Round 6 status:** Resolved (unchanged).

**Round 5 status: Resolved** (unchanged). `predictions` per piece, F-12. `startTick` still only numbers (F-29).

**Round 4 status: Resolved.** `startTick: 1` makes `@k` equal step k (d9 `@1 @2 @3`, d10b title and picture agree: tick @2 first predicts 130), `collect: ['prediction']` removed the `trail` state field and the three-hop chain (`test: sweep: ticks are numbered from 1…` asserts one hop through the collected gather). Costs left: F-27 and the fact that `startTick` is cosmetic here, F-29.

- **Needed:** a sweep that reports the prediction after each of `steps` increments, with each prediction pointing at its own `predict` call.
- **Kernel today:** works (`test: sweep: every tick is a child node…`, d9, replay exact, outer call cacheable, longer sweep reuses the first ticks). Costs: (1) `@k` is 0-based while the check says `step 2`; I mis-titled d10b (`tick @2`, picture shows `@1`) and now write `step k = tick @k−1`. (2) To collect predictions the tick must carry them in its state (`trail`, extended with `ctx.concat`), so the state is a gather of a concat chain; each old prediction's provenance goes through every earlier state (`at of at of input`). The label becomes `gather[trail]gather[0]←[0]←[trail]` (d9a #5). (3) `explain.sweepStep` never reads `ctx.tick()`: the tick dependency is not needed here; reuse across sweep lengths happens by content (d9b `@0 @1 @2` hatched).
- **Workaround:** the `trail` state; the title convention.
- **Proposed shape:** `ctx.drive(..., { collect: ['value'] })` returning the per-tick outputs as one concat Ref whose pieces point directly at each tick's output.
- **Severity:** ergonomic.
- **Evidence:** d9, d10b; `test: sweep: every tick…` asserts the three-hop `at` chain.
- Hegel would say a tick's state contains its whole history, which is what `trail` does by hand. Wittgenstein would say a reader asks 'which call made prediction 2', and the three-hop chain answers by making them walk through states they do not care about.

### F-22 Slot declaration is checked world-wide, not per run

**Round 6 status:** Resolved, with one kernel gap. Path keys must land (round 5). Flat keys: `landing: 'all'` makes the d12 key a BAD_FILL (`test: landing (v0.6)…`), `landing: 'none'` lets a sweep miss, and `fillReach` says what each key chose (`[]` for d12). Gap: under `landing: 'none'` a typo in a path SEGMENT is accepted (F-35).

**Round 5 status: Resolved for path keys, Partly for flat keys.** A path fill that no call used is `BAD_FILL` (`test: a path fill must land…`: the d11 key on a prediction claim fails with `reached no call`). A flat key stays standing configuration, the documented test still passes; but the receipt now lists `fillConsulted` and d12 prints the key `(not consulted)`.

**Round 4 status: Partly resolved.** Path keys check every segment (`test: path slots…`, ledger seq 38). A flat key that is declared somewhere but cannot apply to this run is still accepted silently: `test: FRICTION (documented): a slot fill that is declared somewhere but cannot apply…` still passes unchanged.

- **Kernel today:** a fill key is valid if ANY implementation declares the slot. `test: FRICTION (documented): a slot fill that is declared somewhere but cannot apply in this run…`: `explain.baselineMeans` run with `fill: {'explain.predict#baseline': …}` passes silently, nothing in that run can reach the slot. The typo `#baselin` fails, as intended. Positive side: `impl.slots` is a readable interface (`test: slots are declared…`), and a call to an undeclared slot is `UNDECLARED_SLOT`.
- **Proposed shape:** none; maybe a note on the receipt (`fill used: []`) so an inert fill is visible.
- **Severity:** ergonomic.
- **Evidence:** the test.
- Hegel would say a fill means something only against the whole world of declared slots, which is what the kernel checks. Wittgenstein would say a fill that cannot apply in this run is still a mistake in use, and no one is told.

### F-23 Cache sharing crosses contracts

**Round 6 status:** Observed and fine (unchanged).

**Round 5 status: Observed and fine (unchanged).**

**Round 4 status: Observed and fine (unchanged).** d9a: the first sweep's ticks are hatched from run 9 (the effect check made the same calls); d9b `@1..@3` from run 23.

- **Kernel today:** d9a `@0`'s `nudge` and `predict#sweep` are hatched `cached from run 9 #7 / #10`: the effect check made the same calls. Correct, and not friction for the kernel; for explanations it means a trace may point at a run that was about something else. The ghost view makes this readable.
- **Evidence:** d9-sweep-trace.png panel a.
- Hegel would say a call is defined by its inputs, not its caller. Wittgenstein would say the reader of an explanation still wants to know whose call it was, which `cachedFrom` provides.

### Observed and fine in round 3

- `ctx.fault` with names (`CHECK_REJECTED`, `UNKNOWN_FEATURE`, `FIT_SHAPE`) is what I would have written in round 1.
- `ctx.concat` and `gather` over rows: no friction beyond F-12.
- Check steps exempt from the unused-output lint: `checkedClaim`, `checkSweep` and the `routed` composition rely on it.
- Replay: exact for the routed checker's runs, the sweep (drive) and the cache-hit runs (`test: sweep: replay is exact…`).
- Differential testing of a composition against its imperative twin works with fills (`test: the routed checkClaim equals…`).

## Round 4: new friction, found by migrating to v0.4

Each point ends with one line: what a concept that contains its own other would want (Hegel), against what the actual use here shows (Wittgenstein).

What v0.4 removed from this entry (the question the coordinator asked): helper contracts 29 to 28 (`explain.routeClaim` contract and implementation, about 17 lines, deleted); boolean-only helper contracts 1 to 0 (`routeClaim`); `diagnoseContributions` changed from emitting booleans (`aligned`, `belongs`) and a number to emitting three numbers (`featureCount`, `contributionCount`, `owner`) whose comparisons are now recorded tests; `index.mjs` 578 to 568 lines (net, after adding the new test expressions, the path-slot render and the `collect` call); the `trail` state field and its `concat` bookkeeping in the sweep tick are gone; the router's five-boolean step reads became six test expressions on the composition steps.

### F-24 Test expressions print too long, and a literal prints without its value

**Round 6 status:** Resolved. Path operands print values (`$in.claim[kind]="effect"`), literals print values, lines stay inside the box.

**Round 5 status: Partly resolved.** Literals print their values (d4 `"prediction"`, `"effect"`, `0`), call operands print theirs (`#2.index=1`), lines wrap inside the box. A path operand prints no value (`$in.claim[kind]`, F-30).

- **Needed:** the root of a claim check should say in one line why this branch ran.
- **Kernel today:** d4 root rows read `read and(ne($in.claim[kind], literal), eq($in.claim[kind], literal), ge(#2.index, 0), ne($in.claim[delta], literal))`: the line runs past the box edge (D-40), and `literal` is printed with no value, so `eq(kind, literal)` does not say which kind. Merged rows help (d4b `vacuous, effect` share one row) but the longest rows are the ones that matter.
- **Workaround:** none in the entry; the claim table (EXPLAIN D-40) records the failure.
- **Proposed shape:** print literals as `'effect'` and `0`; wrap or truncate the expression at the box width, as rows do.
- **Severity:** ergonomic (picture only).
- **Evidence:** d4 root, d6a #4, d6b #4 and #6.
- Hegel would say a relation is its relata, and a literal is a relatum with a value: drop it and the relation is gone. Wittgenstein would say `eq(kind, literal)` is no sentence anyone can use; `kind is effect` is.

### F-25 A test compares scalars; shape equality and search still need a contract

**Round 6 status:** Open, declined for one use (ledger seq 52, 59 deferred).

**Round 5 status: Open, declined for one use** (ledger seq 52: len/shape tests deferred). `diagnoseContributions` is unchanged.

- **Needed:** "contributions have one value per model feature", and "which feature's contribution equals the claimed value".
- **Kernel today:** a test operand is a number, string or boolean Ref. Neither the length equality nor the search is a relation over Refs, so `explain.diagnoseContributions` stays a contract: it emits `featureCount`, `contributionCount` and `owner`, and the decisions are tests naming them (`eq(featureCount, contributionCount)`, `ge(owner, 0)`; d4b). Before v0.4 it emitted `aligned` and `belongs` booleans.
- **Workaround:** the helper kept, now numeric (this is why one helper stays).
- **Proposed shape:** none. The search is a calculation, rightly a contract. The length equality is one use; I would not add `len` for one use.
- **Severity:** none that I would fix.
- **Evidence:** d4b #4 outputs; `test: ctx.when with a test inside the contribution check…`.
- Hegel would say a shape comparison is as much a relation as `eq` and the operator is missing. Wittgenstein would say the use here is a lookup that returns an owner; a calculation is its right place, and the comparison only reads its result.

### F-26 Exclusivity is written twice: in the guards and again in `one`, once per output port

**Round 6 status:** Partly resolved (unchanged): guards once, the `one` lint at assembly, the four `one` lists (4 lists of 5 names) still written by hand.

**Round 5 status: Partly resolved.** Guards are written once (inherited skips: `unknown`, `contrib`, `vacuous`, `effect` no longer repeat `ne(kind, prediction)`; complements are `else`), and the `one` lint (`test: the one lint…`) refuses an unguarded or provably overlapping branch at assembly. The four `one` lists of five names each are still written by hand (4 lists, 20 names, before and after).

- **Needed:** `checkClaim/routed` returns the verdict of whichever of five branches ran.
- **Kernel today:** `one` works and refuses at run time (`AMBIGUOUS_BRANCH`, `NO_BRANCH`: `test: overlapping when conditions…`). But it is spelled per output port: `accepted`, `reason`, `residual` and `judged` each repeat `{ one: ['pred.p','unknown.p','contrib.p','vacuous.p','effect.p'] }`, and the exclusivity of the five `when`s is also written by hand in the guards (`hasFeature`, `isKind(...)`, `ge(idx.index, 0)`, `ne(delta, 0)`). A new branch has to be added in two places (guard and four ports). Nothing says the guards and the ports agree except a failing run.
- **Workaround:** a `names.map((st) => …)` helper over the five step names builds the four `one` lists; the differential oracle checks all 12 claims.
- **Proposed shape:** a step-level `{ one: [steps] }` returning the whole output record, or `returns: { from: { one: [...] } }`.
- **Severity:** ergonomic.
- **Evidence:** `explain.checkClaim/routed` `returns` in `index.mjs`; d4 root.
- Hegel would say the five branches are moments of one verdict and `one` should name the verdict once. Wittgenstein would say the repetition is harmless as grammar and harmful as maintenance: a sixth claim kind is a five-line change in two places.

### F-27 The collected gather is exact in the data and unreadable in the picture

**Round 6 status:** Resolved. `gather[1]←@1 … [3]gather[4]←@4` (d9a, d10b): each piece names its tick.

**Round 5 status: Partly resolved.** No `pieces ×N` repetition (D-54). The row is per piece and exact, and still does not name the ticks.

- **Needed:** see which call made prediction 2 of the sweep.
- **Kernel today:** `collect` gives exactly that (one hop through the collected gather, asserted in the test). The picture, d10b #2 `predictions`, reads `gather[0] pieces ×4 pieces ×4 pieces ×4`: nested gathers are flattened and the counts repeat, and nothing names the tick.
- **Workaround:** the test; d10 (the plot) shows the numbers and marks step 2.
- **Proposed shape:** for a gather over drive output, label the pieces `@1 @2 @3 @4` (their tick tags) instead of counts.
- **Severity:** ergonomic (picture only).
- **Evidence:** d10b #2; `test: sweep: ticks are numbered from 1…`.
- Hegel would say a collected output is one thing whose parts are the ticks, and the label should say so. Wittgenstein would say the reader asks 'which tick', and `pieces ×4` is a count, not an answer.

### F-28 A fill is not drawn on the root of the run it changed

**Round 6 status:** Resolved (unchanged); now with reach, F-34.

**Round 5 status: Resolved.** `traceToSvg(..., { receipt })` prints the fill under the title (d11 `fill: explain.attribute#after/explain.predict#input → explain.predict/capped`, d2d, d10b) and marks unconsulted keys (d12). It does not mark which boxes a key reached.

- **Needed:** know at a glance that d11's run was filled, and where.
- **Kernel today:** d11 root #1 `explain.checkClaim/routed` shows nothing about the path fill. The only trace is the `explain.predict/capped` impl line on #19 `predict#input`, one box among 25, 4267 px down the page. The receipt carries `fill`; the picture does not.
- **Workaround:** the d11 title names the key.
- **Proposed shape:** list the run's fill keys under the root header, each linking to the box(es) it reached.
- **Severity:** ergonomic (picture only), growing with path keys, which reach few boxes among many.
- **Evidence:** d11 root and #19.
- Hegel would say the fill is part of the run's identity, as much as its inputs. Wittgenstein would say the reader of d11 asks 'what was swapped?' and has to hunt for the one box whose impl line says so.

### F-29 `startTick` renames a label and changes nothing else

**Round 6 status:** Observed (unchanged).

**Round 5 status: Observed (unchanged).**

- **Needed:** step k should be tick `@k`.
- **Kernel today:** `startTick: 1` does that (d9, d10b). `explain.sweepStep` never reads `ctx.tick()`, so the clock changes no result and no cache key: the cache hits across sweep lengths (d9b `@1..@3`) come from content, not from tick numbers. The option works as a name for steps.
- **Workaround:** none needed.
- **Proposed shape:** none; flagging that the clock is used here only to number.
- **Severity:** none.
- **Evidence:** d9, d10b; `test: sweep: zero steps…` (ticks 1–3 cached when the 5-tick sweep runs).
- Hegel would say a tick is a moment of the process, and numbering moments is part of the process. Wittgenstein would say my use is a count, `step 2`, and a count did not need a clock; it needed an index, which the kernel happens to call a tick.

### Observed and fine in round 4

- Tests inside compositions replaced the router with no new noun and no loss of the amber edges (d4 root); a step guarded by `and:[A, …]` can read the step that A guards (`ge(idx.index, 0)` under `hasFeature`).
- A cache hit keeps its decisions (d8: six rows on a hit).
- `AMBIGUOUS_BRANCH` and `NO_BRANCH` are exactly the two refusals the router's examples used to prove by hand.
- Path slots do what the one-line key says (d11): only the nudged prediction was capped.

## Round 5: new friction, found by migrating to v0.5

Each point ends with one line: what a concept that contains its own other would want (Hegel), against what the actual use here shows (Wittgenstein).

What v0.5 removed from this entry (counts from `contest/d-explain/index.mjs`, the routed `checkClaim`; round 4 from the saved copy, round 5 from the file):

| | Round 4 | Round 5 |
|---|---|---|
| test leaves in the six `when` specs | 15 | 10 |
| restated guards (a guard conjunct repeated in a later step) | 7 (`ne(kind, prediction)` 4 times, `ge(idx.index, 0)` twice, `eq(kind, effect)` once) | 1 (`eq(kind, effect)` in `vacuous` and `effect`) |
| typed complements | 3 distinct, 9 occurrences (`ne(kind, prediction)` ×5, `ge(idx.index, 0)` ×3, `ne(delta, 0)` ×1) | 0 (four `else` clauses) |
| duplicated `one` lists | 4 lists of 5 names | 4 lists of 5 names (not removed) |
| pins or fills that existed only to dodge precedence | 0 | 0 (none existed) |
| hand-kept trajectories outside `prove` | 0 | 0; one trajectory example added (`explain.sweepStep`), which catches a mutant `prove` could not before |
| operators used in the routed decisions | `ne eq ge lt and` | `eq lt and else` |
| `index.mjs` lines | 568 | 582 (+14: mutant `sweepStep/saturating` 8, trajectory example 4, guard comment; the routed block itself got shorter) |
| entry tests | 47 | 52 |

### F-30 `else` prints the nested causes, and a path operand prints no value

**Round 6 status:** Resolved. `else(pred)`, `else(unknown, vacuous)` print their steps only; the causes are edges (and the edges are F-36). Path operands print values.

- **Needed:** the root of a claim check should say which branch ran and why, in a line a reader can take in.
- **Kernel today:** d4 root `effect` row prints `and(eq($in.claim[kind], "effect"), else(unknown: lt(#2.index=1, 0); vacuous: and(eq($in.claim[kind], "effect"), else(unknown: lt(#2.index=1, 0)), eq($in.claim[delta], 0))))`: six wrapped lines, because `else` prints the whole cause of every step it names, including the nested one. And `$in.claim[kind]` has no value while `#2.index=1` has, so the picture still does not say what the kind was.
- **Workaround:** none.
- **Proposed shape:** print `else(unknown, vacuous)` with each named step's own state (`unknown skipped, vacuous skipped`) and give path operands their value (`$in.claim[kind]="effect"`).
- **Severity:** ergonomic (picture only).
- **Evidence:** d4 root, d8 root, d11 root; EXPLAIN D-49.
- Hegel would say a derived complement carries the reasons of what it complements, and the reasons are right to be there. Wittgenstein would say the reader asks 'which kind?' and is shown a derivation tree where one word was wanted.

### F-31 Cached-verdict rows run together, and cached decisions lose operand values

**Round 6 status:** Partly resolved. One verdict per line (d6a, d8). The second half, cached decisions losing values, became F-37: operand values print only when the original is expanded, and the label `#2` is the original's number.

- **Kernel today:** d8 root and d6a #4 `3 cached verdicts`: the three rows share lines (`siz…; ✓ explain.checkEffectClaim:`), so the check names are mid-line. d6a #4 cached decisions read `lt(#2.index, 0)` without the value, because #2 is a node of the original run, not drawn; d8 (with `expand`) prints `=0`.
- **Proposed shape:** one verdict per line; print a cached decision's operand values from the receipt, not from a drawn node.
- **Severity:** ergonomic (picture only).
- **Evidence:** d8, d6a.
- Hegel would say a verdict is its own line. Wittgenstein would say the three rows were meant as three, and a reader who skims takes them for one sentence.

### F-32 `else` names earlier steps, so adding a branch still edits the others

**Round 6 status:** **Still bites, not addressed.** `checkClaim/routed` still has four `returns` `one` lists of five step names (20 names) and `else` clauses naming earlier steps. A sixth claim kind is still edits at five places (the step plus four lists); evidence: `explain.checkClaim/routed` `returns` in `index.mjs`.

- **Needed:** a sixth claim kind (a feature kind with its own check) with the least edits.
- **Kernel today:** guards are exclusive by their own equality (`eq(kind, k)`), so existing steps do not change. The places to edit are: the new step, `idx`'s `else: ['pred']` if the kind has no feature, `effect`'s `else` list if the new branch can overlap it, and the four `one` lists. That is the same count as round 4 for the lists (4) and one fewer typed guard (no `ne` to extend). `else` is positional: it may name only earlier steps, so branch order is part of the composition.
- **Workaround:** a `names.map` over the five step names builds the four `one` lists.
- **Proposed shape:** a step-level `{ one: [steps] }` returning the whole record (F-26 round 4 proposal, still open); the lint then has one list to check.
- **Severity:** ergonomic.
- **Evidence:** `explain.checkClaim/routed` in `index.mjs`; `test: the one lint…` shows what is refused at assembly.
- Hegel would say a branch and its other are one concept and the `one` should name it once. Wittgenstein would say adding a kind is still a change at five places, and the lint, not the grammar, is what keeps the five in step.

### F-33 A trajectory example is checked under the default fill, so a mutant below the tick escapes

**Round 6 status:** **Still bites, not addressed.** `test: the capped predictor passes every example (prove) …` is unchanged and green: examples carry names and a failing tick prints its inputs now (`test: a trajectory example (v0.5)…`), but an example cannot carry a fill, so the capped predictor beneath the tick is seen only by the sweep check (d10).

- **Needed:** prove that the sweep is constant-step under the capped predictor.
- **Kernel today:** `trajectory` makes `prove` check every tick of `explain.sweepStep` (`test: a trajectory example (v0.5)…`: the saturating mutant at tick 2 is caught, and the old `ticks: 2` example missed it). But the capped predictor lives one level down, in the `sweep` slot, and `prove` runs examples under the default fill, so `test: the capped predictor passes every example (prove)…` still holds: only the sweep check sees it.
- **Workaround:** the sweep check (`checkSweep`) with a fill, in the render and in the test.
- **Proposed shape:** an example may carry a `fill`: `{ in, each, trajectory, fill: { 'explain.predict#sweep': 'explain.predict/capped' }, rejects: true }`. One use, so only noting it.
- **Severity:** ergonomic.
- **Evidence:** d10 (the plot shows what the examples cannot).
- Hegel would say a tick's identity includes what fills its slots. Wittgenstein would say one use is not yet a form.

### F-34 A path fill that lands cannot be seen landing

**Round 6 status:** Resolved. The fill line carries reach, `… → explain.predict/capped @ #19` (d11), `@ #4 #9 #14 #19 #24` (d10b), and #19 carries `⚑ by path explain.attribute#after/explain.predict#input`.

- **Kernel today:** d11 prints the key and the receipt line; the key's box, `#19 explain.predict#input`, shows `explain.predict/capped` in its impl line, 4455 px down the page. A key that lands on two call sites would have two such boxes and no line between them and the key.
- **Proposed shape:** the receipt line links each consulted key to the node ids that used it (`→ #19`).
- **Severity:** ergonomic (picture only).
- **Evidence:** d11.
- Hegel would say the fill and its landing are one fact. Wittgenstein would say the reader asks 'where?', and the title names the key, not the place.

### Observed and fine in round 5

- Inherited skips: `unknown` is skipped by `idx` without a restated guard, and its recorded cause equals `idx`'s (`test: dispatching on claim.kind (v0.5)…`, `deepEqual` of the two `from`).
- `else` derives the complements: the 12 claims use only `eq`, `lt`, `and`, `else`.
- Path landing turned a silent no-op into `BAD_FILL: reached no call`, the exact failure round 4 could not see.
- Specificity: `explain.predict#*` plus one exact slot behaves as written (exact slot beats `#*`), and `receipt.fillConsulted` lists both keys.

## Round 6: new friction, found by migrating to v0.6

Each point ends with one line: what a concept that contains its own other would want (Hegel), against what the actual use here shows (Wittgenstein).

What v0.6 removed from this entry (counts from the entry's files; round 5 from the round 5 files, round 6 from the files now):

| | Round 5 | Round 6 |
|---|---|---|
| trace scans computing what `fillReach` now answers | 4 helpers (`impl`, `impls`, `flatImpls`, `implOf`), 7 `findCall` scans | 0 helpers, 0 scans (`fillReach` plus `world.node(run, id)`) |
| guards kept only because of the `one` or `else` gaps | 0 | 0 (none existed: every step of mine has its own `when`) |
| `allowUnusedFill` where `landing: 'none'` says it | 0 | 0 (none used; `landing` now used once, in a test, for `'all'` and `'none'`) |
| inherited runs recorded in my compositions | n/a | 0 new rows (no step of mine runs by inheritance; `checkedClaim/both` and `checkSweep` have no conditional steps) |
| examples with names | 0 | 2 (the two `explain.sweepStep` examples, the only temporal ones; prove reports the names, a failing tick ends with its inputs) |
| duplicated `one` lists | 4 lists of 5 names | 4 lists of 5 names (F-32, not addressed) |
| `index.mjs` lines | 582 | 582 (the example names fit on existing lines) |
| entry tests | 52 | 54 (+ `landing`, + the documented kernel gap; the two scan-based tests were rewritten, not removed) |

My flat-key removal vote (retrospective, ledger seq 58, declined): I withdraw it as a removal and keep it as a default. The case for removal was that a flat key can silently do nothing. v0.6 answers that hazard without removing the key: `landing: 'all'` refuses it (d12's key becomes `BAD_FILL: fill reached no call`), and `fillReach` prints `[]` for it. What remains of my objection is the default: a single-run author who writes a flat key and forgets `landing: 'all'` still gets the d12 outcome (accepted, `(not consulted)` in the picture, nothing refused). I would rather the picture were the only place that default shows; it is.

### F-35 Under `landing: 'none'` a typo in a path segment is accepted (kernel)

- **Needed:** a sweep that reuses one fill table may miss, but a misspelt key should still fail (ledger seq 56: "typos still fail in every mode").
- **Kernel today:** `test: FRICTION (documented, kernel): under landing none a typo in a path SEGMENT is accepted…`. `'explain.attribute#aftr/explain.predict#input'` is `BAD_FILL` by default and with `'all'`, and passes with `'none'` (prediction claim and effect claim alike). A flat typo (`'explain.predict#inpt'`) fails in every mode, as seq 56 says; `kernel-v06` test 122 covers only the flat typo.
- **Workaround:** none; I do not use `'none'` for real runs.
- **Proposed shape:** validate each path segment's slot against declared or consulted slots in every mode, as for flat keys.
- **Severity:** distorts (silent wrong experiment, in exactly the mode that is meant to be lax).
- **Evidence:** the test; the matrix run in the session (4 modes by 2 claims: only `'none'` does not throw).
- Hegel would say a misspelling is not a miss: it names nothing, in any game. Wittgenstein would say the sweep author wants 'may not land', never 'may not exist', and the kernel's `'none'` heard both.

### F-36 The amber operand edges become an untraceable field

- **Needed:** follow a decision row back to the Parts it read.
- **Kernel today:** every decision row draws amber edges to each operand. At the root of `checkClaim`, five rows read the claim's `kind` path, so five dotted verticals leave the claim row, each in its own lane, plus the `else` causes: about a dozen lanes in 40 px (d4, d8, d11, d12). On a 3 times zoom each lane is unique and none can be followed to its row. The purple output brackets, in the same picture, are legible.
- **Workaround:** none; the row text carries the operand and its value, so the reading survives without the edge.
- **Proposed shape:** one edge per distinct operand, fanning out to the rows that read it, or no edge for an operand that is an input of the same node.
- **Severity:** ergonomic (picture only).
- **Evidence:** d4 root gutter (zoom), EXPLAIN D-68.
- Hegel would say each reading of the claim's kind is its own relation, and each deserves its line. Wittgenstein would say five lines from one place to five rows is one fact, 'they all read the kind', drawn five times.

### F-37 A cached decision names the original's `#2`

- **Needed:** read d6a #4's `unknown` row, `lt(#2.index, 0)`.
- **Kernel today:** the edge to the current run's `#2` is gone (the audit's fix). The label still prints `#2`, and in d6a the current `#2` is `explain.attribute`; the call that decided was the original run's `featureIndex`. Values print only when the original is drawn (d8 with `expand`: `=0`).
- **Workaround:** the cached header says `cached from run 6 #1`, which names the run; a reader has to apply it to the `#2`.
- **Proposed shape:** print `run 6 #2.index=0` for a hit's decision operands.
- **Severity:** ergonomic (picture only).
- **Evidence:** d6a #4 next to d8 #1.
- Hegel would say a Ref is its occurrence, with its run. Wittgenstein would say a bare `#2` is read as 'the box named #2 in this picture', and for a cached decision that is never true.

### Observed and fine in round 6

- `chosenBy` and `fillReach` replaced every trace scan: the reach is the answer, the node is `w.node(run, id)` (`test: path slots (v0.4)…`).
- The `⚑ by …` row marks exactly the two boxes that were not chosen by default (d2d #5, d11 #19).
- `landing: 'all'` is the right word for a single aimed run; d12's key fails under it with `reached no call`.
- Inherited runs and the context rules for `else` changed none of my rows or results (the 12 claims, all 4 oracles, are identical); a composition where every step has its own `when` is untouched by them.
