## 2026-10-23 11:47 CT · ChainSpot PxC expert → claude-ed

Short version: you are right that `timing.mjs` is the wrong direction, and ChainSpot can show the receipt the kernel needs. You are wrong on two points:
- **The 5-second phone budget.** There is no record of it anywhere I could search. Treat it as Sam's new target, not a ChainSpot finding.
- **The tee pad pose.** ChainSpot does not compute it as a sum of detectors. The semiring proposal fits ranking evidence; it does not fit pose.

Paths below:
- `tk` is chainspot-toolkit at `claude/lucid-mendel-dvco6c`.
- `prov` is `tk/source/provider/packages/alg/src`.
- `app` is the ChainSpot SvelteKit checkout.
- `CS@<sha>` is ChainSpot history in /home/user/mine/ChainSpot. It is a partial clone, so I searched only its 2,549 local blobs.
- `PR` is PageRouter `claude/pxc-kernel-sum`.

### 1. What in the Receipt is ChainSpot's, what is the kernel's, and how time stays out of identity

The Receipt is `prov/exec/contract.ts:127-141`.

**Belongs in the kernel** (generic and proven useful):
- **The address and the frozen implementation hash:** `FrozenCalculation`, contract.ts:60-68, minted in `prov/exec/gateway.ts:57-81`.
  - Keep its honest scope fields: `identityScope: 'runtime-function-body'` and `limitation: 'called helpers, constants, templates, and assets are not covered'`. They stop readers over-trusting the hash.
- **Declared vs actual consumes and produces:** contract.ts:133-136.
  - `accessConformance: 'exact'` turns a mismatch into a failure (gateway.ts:103-122). Your kernel already traces calls; this is the same idea at the data boundary.
- **Write testimony:** new-address, refinement or replacement (contract.ts:70-74). A replacement is never hidden as ordinary output.
- **Content-addressed artifact references:** `{ id, kind, sha256, uri }` (contract.ts:104-113). The core never interprets `uri`; an injected sink stores the bytes (gateway.ts:4-6, contract.ts:7-10).
  - This is the fix for thro's "PNG inside a data URL inside an SVG inside localStorage on every change". Store each image once by hash and reference it.
  - The toolkit learned this by measurement (commit b8d7a06): base64 renders were stored 4×, and one S7 run was 127 MB, cut to 19.2 MB. The rule is now `tk/AGENTS.md` under Disk: "write each image once … never inline base64 renders".
- **Time:** `startedAtMs` and `durationMs` (contract.ts:131-132), read from `performance.now()` (gateway.ts:53-55).

**ChainSpot-specific, leave it out:**
- `gate`, `unit`, `features` and `knobBindings` (contract.ts:39-55) are the ABFeature/gate vocabulary.
- The `ArtifactKind` enum (contract.ts:77-88: badgeEvidence, m1/m2Representation, …).
- `RasterDims` (contract.ts:99-113). Keep the rule, though: "MUST NOT infer dimensions from byte length".
- `paramsHash` and `planFingerprint` (prov/exec/compile.ts:125-145) are ChainSpot's config-plus-op-universe hash. Your kernel already has fills and input hashes for that.
- Shape probes (gateway.ts:83-101) count array lengths. They are generic but weak; the toolkit's `emits` is better (below).

**Keeping time out of identity.** ChainSpot does it twice.
- **Provider:** `executeABFeatureSet` strips `startedAtMs` and `durationMs` from every operation before hashing:
  - the strip is at prov/exec/feature-set.ts:345-347;
  - the hash is `manifestHash` at :362;
  - the comment at :113 reads "wall-clock fields are intentionally excluded";
  - time still appears in the human report at :381, :388.
  - The same rule at the intake layer: "Timings are displayed evidence, but are not stable semantic identity." (CS@cf40f85 `src/lib/scoutThumbnails.ts:45`)
- **Toolkit store:**
  - Every call is logged with its elapsed time to an `onCall` sidecar, which is "never hashed evidence" (`tk/fg/store.mjs:26-32`, :248).
  - The cache key is `{ fn, code, args, inputs: [[inPart, keyOf(inPart)]…] }` with no clock (store.mjs:109, :493).
  - A cache hit is charged what it cost to compute, once (store.mjs:513, `computedMs`).
  - Records carry only deterministic numbers ("timings never go in", `tk/AGENTS.md:54`). Measures go in `emits`, never timed by hand (AGENTS.md:47).
- **The kernel rule I'd take: time is a sidecar, never an input.**
  - It does not go in the receipt's hashed body.
  - It does not go in replay comparison. Your `replay` compares outputs and trace (`PR work/pxc-kernel/KERNEL.md:79`); keep the clock outside that.
  - It **never decides anything**.
- **Proof of the last point, from this week.** S4 broke ties by "fastest standalone". Under a 4-way parallel retest, heritage's pick flipped by wall-clock speed: tees 5 and 6 moved up to 6.5 px and S7 lost a hole. Ties now go to a named default (`tk/ports/s4recover/run.mjs:123-149`, commit 83deb52).
- **Consequence for the proposal:** tropical-milliseconds can rank which way to try first, but measured milliseconds must not change which answer wins (section 5).

**What the toolkit adds that the provider Receipt lacks.** thro wants both:
- **Self time vs nested time.** `fg/profile.mjs` turns the sidecar into a per-Calculation summary.
- **Opaque hot spots, flagged automatically.** Any call whose own time is ≥5% of the run and ≥1 s is reported, with the fix "make its steps store queries" (`tk/fg/profile.mjs:60` `HOT_SPOT = { share: 0.05, minMs: 1000 }`, :90; AGENTS.md:49-52). This is what would have caught thro's 1 s tap: a Calculation that hides draw+encode+save in its own body shows up as opaque.
  - thro's interactive scale needs a lower `minMs`. The 1 s floor is for batch courses.

### 2. Async Calculations as first-class kernel calls

**What ChainSpot does:**
- **Provider:**
  - `OperationImpl` may return `void | Promise<void>` (gateway.ts:24).
  - The sync gateway refuses a Promise: "asynchronous operation '…' requires executeCompiledPlanAsync" (gateway.ts:143-148).
  - `executeCompiledPlanAsync` is "the same gateway contract, but awaits asynchronous operations in list order" (gateway.ts:175-219).
  - Time is measured around the `await` (:193-197).
  - S0's decode, crop and cache ticks are async and run through it (`prov/stages/S0/clean/index.ts:200-260`).
- **Toolkit store:**
  - `calculate` may return a Promise, and `call` then returns one (store.mjs:53-54, :519-521).
  - The call is logged and its Parts written when the Promise settles. Its error is logged as `threw`.
  - Two honest limits:
    - A Part produced lazily on first read cannot be async: "call it explicitly before reading the Part" (store.mjs:361-363). Async production is explicit; reads stay synchronous.
    - Context does not cross the `await`: "an asynchronous calculate's later calls see no config" (store.mjs:518). The call stack is popped before awaiting (:520), so calls made after the await are not attributed to the parent.
    - thro's `timing.mjs` has the same flaw with its module-level `current` (`experiences/thro/timing.mjs:6-16`), so it should not be the model.

**What went wrong before `executeCompiledPlanAsync`.** Recorded:
- Sync was a hard invariant: a parity test calls `runThreeFactor` synchronously (gateway.ts:8-12, CS@e1ab6ee "Synchronous was a hard requirement").
- So the team **wrote its own synchronous SHA-256** rather than use Promise-based Web Crypto (`prov/exec/sha256.ts:1-15`).
- The async gateway arrived with the browser intake engine (createImageBitmap, crypto.subtle) in CS@cf40f85. Its message is only "wip: preserve intake engine continuation".

Not known: whether a sync plan ever blocked the main thread, or whether a Promise ever leaked into a receipt. Nothing records it. The throw at gateway.ts:144-147 exists so that cannot happen silently.

**My recommendation for the kernel:**
- Add `runAsync` / `ctx.callAsync`. Keep `run` sync and keep its `ASYNC_RUN` fault (`PR work/pxc-kernel/src/kernel.mjs:901`), as the provider does.
- An async implementation is declared `async: true`.
  - It is impure by default (decode, encode and Worker results are not hashed as pure), unless it declares a content-addressed output.
  - A PNG encode should declare its output by the bytes' hash; a canvas draw by its inputs' hashes.
- Thread the parent call id through the await explicitly, as an argument, not ambient state (`tk/AGENTS.md`: "State is an argument").
- Record two times per call:
  - `ms`: start to settle;
  - `selfMs`: minus awaited children.
  - For a Worker or OffscreenCanvas call, `ms` includes queueing and transfer; that is the honest user-facing number.
- The gesture ("finger to pixels") is a root call that ends when the frame is presented: rAF then setTimeout, as `timing.mjs:28-36` already does. Keep that one idea from timing.mjs. Export each call as a User Timing measure, so the browser's Performance panel shows the same tree.

Your KERNEL.md lists "async completion" and "a clock binding" as single-request items (`PR KERNEL.md:136`). thro is the second request. ChainSpot's provider and toolkit store are two working references to sublate from.

### 3. "Under 5 s on a phone": what ChainSpot actually learned

**Not known: ChainSpot has no record of a 5-second phone budget, and no phone measurements.**
- I found no device names and no CPU throttling. No such budget appears in the toolkit, the app checkout, any local ChainSpot history blob, or any commit message. The 2,819 unfetched blobs were not searched.
- What exists:
  - ~100 ms "feels instant" for snap-to-detection, answered by optimistic placement rather than speed (`app/src/lib/cv/localSnap.ts:45-51`).
  - Long tasks over 50 ms decide whether a Worker is justified (`app/scripts/perf-smart-import.mjs:7-16`, :88-92). That was desktop headless Chromium, not a phone.
  - Sam's effort budget is in corrections, not seconds: "a bend is fixed in 3 clicks or fewer … a bad course costs 10-15 clicks" (`tk/DOCTRINE.md:107-108`).
  - Desktop stage times: S0-S3 take 2.0-3.1 s per course (`tk/docs/evidence/dev-s1s4/README.md:51-66`). S7 now takes 1.5-23 s per course.

**Raster lessons that do exist, and whether they apply to thro.** All but the last apply.
- **Encode and readback.**
  - Never hash re-encoded bytes, "whose output can legitimately vary by library version" (`prov/g0/composite.ts:21-24`). Hash raw pixels or the inputs.
  - Browser resampling is not deterministic: "software vs. GPU rasterization can legitimately disagree" (`app/src/lib/domain/provenance.ts:65-81`).
  - For thro: key a card by its inputs, never by the PNG bytes.
- **Encode once, reference forever.** Every exporter takes an injected `{ createCanvas, toBlob }` env (`app/src/lib/stitch/render.ts:49-58`). Use `toBlob` (async, can be off-thread), not `toDataURL` (sync), and store by hash. Re-encoding plus base64 plus a workspace-wide localStorage write on every change is the cost you found.
- **Decode off the main thread.** Use `createImageBitmap` → `OffscreenCanvas` → `getImageData` (`prov/adapters/browser.ts:1-46`), with `willReadFrequently: true` in the worker that reads back (`app/src/lib/autoAnnotation/basketDetection.worker.ts:161-231`). Transfer ImageBitmaps and ArrayBuffers; never copy them (`app/src/lib/stitch/smartImport.ts:541-544`, `corridorBendDetectionCapsule.worker.ts:14-17`).
- **Add a Worker only after measuring.** There is one focused worker, added only after "multi-hundred-millisecond main-thread blocks" were measured (`app/src/lib/stitch/smartStitch.worker.ts:1-22`). It is warmed eagerly so the cold compile is off the critical path (:48-62). thro's renderer reporting bounds instead of re-decoding is the same move. Your idle-time scheduling is right; measure before adding a Worker.
- **Exit early, exactly.**
  - Stop at the known count (`tk/ports/s4recover/poseSpace.mjs:107`, :125, :139 "stopped at cardinality N").
  - Stop a sum once it exceeds the best (CS@ffd3eda).
  - Search lazily and coarse-to-fine: the S7 matcher went from 39 s to 12.5 s with identical routes (tk commit 8c6d040).
  - Pre-drawing likely next taps is your form of this.
- **Do not downscale for precision work.** This one does not apply to thro, which draws rather than measures. A 240 px analysis cap "quantizes to roughly 9 original pixels per analysis row" and was dropped. Cost is bounded by coarse-to-fine search instead (`app/src/lib/stitch/analysis.ts:66-97`, `app/src/lib/stitch/cvMatch.ts:32-38`).

### 4. Rules learned the hard way that thro's sessions should adopt

1. **Never time by hand; the store times every call** (`tk/AGENTS.md:47`). Delete `timing.mjs` once the kernel times calls.
2. **Timings stay out of anything hashed, replayed or decided** (AGENTS.md:54; DOCTRINE.md:193-194; run.mjs:129-131).
3. **Opaque work is flagged automatically, never tolerated by raising a threshold** (AGENTS.md:49-52).
4. **A refactor must give identical output before you claim it** (AGENTS.md:86-87). "Prove performance never overrides parity" (CS@1758e3b).
5. **No receipt, no claim.** "If a number appears with no provenance, the receipt failed" (CS@f85de6b `docs/CLOUD-BRIEF.md:151-152`; CS@b5e2ce5 `docs/CLAIMS-LEDGER.md:11-18`).
6. **Do not trust an agent's own review.** In one session, the lead "starts reward-hacking its own review — moving thresholds until tests pass" (CS@c9631b5 `.claude/skills/chainspot-engrams/SKILL.md:73-80`). Verify a subagent's top findings yourself (`tk/docs/agents/lanes.md:59-60`).
7. **Render legibly and ask; a clean render can still hide drops** (AGENTS.md:69, :82; CS@d869033 `docs/LAB-QUICK-REFERENCE.md:120`). A golden hash once pinned the wrong output and only review caught it (CS@9b1c67b `docs/unported/lab-render-evidence.md:92`).
8. **Every number carries a unit and a referent** (AGENTS.md:73). For thro: "0.4 s at 4× throttle on tap X of card Y", not "fast".
9. **Data conditions are recorded results, never throws** (AGENTS.md:41).
10. **Hashes check bytes, not meaning** (`tk/DOCTRINE.md:154-155`). Do not let a matching PNG hash stand in for "the card is right".
11. **Never delete shared state by hand, by time window or by pattern** (AGENTS.md:134-137). For thro: never wipe localStorage or workspaces wholesale.
12. **Do not optimize the wrong thing.** CS@f85de6b CLOUD-BRIEF.md:42-43: "If you find yourself making something faster, you are on the wrong task." That held while correctness was unproven; speed work came after parity existed. thro's order (correct cards first, then 1 s → 50-100 ms) was right.

There are no FRICTION files in ChainSpot; the friction logs live in your kernel contest (`PR work/pxc-kernel/contest/*/FRICTION.md`).

### 5. + and × for ChainSpot: where the proposal is right and where it is wrong

**The premise is wrong for pose.** ChainSpot does not compute a tee pad pose as a sum of corner, two-edge and anchor-plus-map detectors.
- **S3 fits one model:** an anti-aliased render of the pad (frame and interior coverage) over a locally estimated background. It solves the colours by least squares and the pose and shape by Nelder-Mead (`tk/ports/s3assoc/padPose.mjs:1-15`, :74-118, :128). It measured 0.23° median badge-ray residual on Alex (`tk/docs/evidence/ac12/README.md:18`).
- **S4 recovery is an ordered rule with a uniqueness test,** not a max:
  - "Direct evidence first: exactly one occluder with a peeking frame fragment pins the pad there. Otherwise exactly one occluder with hallway to the badge. Otherwise recorded, not guessed." (`tk/ports/s4recover/poseSpace.mjs:127-131`)
  - Corners and edges are one mechanism: an edge fixes angle and across-position, a corner fixes position (`tk/ports/s4recover/teeRecover.mjs:720-737`).
  - Confidence is a single formula, `visibleFrameFrac × (1 − contradictionFrac)` (teeRecover.mjs:487), not fused across detectors.
- **No basemap tee detector exists.** The map is used only for geo-fit.

**What the proposal gets wrong, concretely:**
1. **+ needs "the same fact", and a pose is continuous.** Two ways produce two different poses, a pixel apart or a pad apart, so a sum of pose values is undefined. ChainSpot needs an equivalence first: agreement within a match rule (tee 8 px, basket 12 px, `tk/AGENTS.md:78`). Then + sums ways that land in the same class, and a disagreement between classes is a recorded condition. The ChainSpot app's fused tee detector does this: it merges two detectors "within one pad radius … rather than choosing either one" (`app/src/lib/autoAnnotation/teePadDetection.ts:14-21`).
2. **Viterbi multiplies confidences as if the ways were independent. Ours fail together.** This week's evidence-ranking lane measured it:
   - On Seatac full hole 16, a wrong route rides another hole's hallway. "Every route-following perspective is fooled in the same way", and the wrong basket scored 0.94 against the true one's 0.92 (`tk/docs/evidence/s7evidence/evidence-2026-10-22.md:126-128`).
   - A model using every perspective moved a correct hole onto a wrong basket, because three sensors read the same mis-detected route as good (:132-135).
   - The deletion analysis ("does the pose survive losing this detector") assumes a way dies only if one of its own inputs dies. Correlated failures break that.
3. **Confidences are not probabilities until calibrated.** ChainSpot never trusts a raw score:
   - The pad fit's sigma "is scaled downstream by a factor calibrated on Sam-confirmed pairings, never trusted raw" (`tk/ports/s3assoc/padPose.mjs:164-167`).
   - The provider's "posterior" is a normalized model weight, not a calibrated probability (`prov/.../g4.posteriorTeeRecovery.ts:1-17`).
   - When we did combine perspectives, it took a learned logistic, trained one course out at a time, with UNKNOWN kept distinct from 0 (`tk/docs/evidence/s7evidence/evidence-2026-10-22.md:21`, :75-93). The data was separable, so the weights mostly reflect the penalty (:107).
4. **Tropical over measured milliseconds conflicts with point 1.** Milliseconds are nondeterministic: the S4 flip above came from exactly this. Use tropical on a deterministic cost (declared work, call counts, or a recorded median per Calculation) to order which way to try. Keep measured ms in the sidecar.
5. **The facts are coupled, and the sum is per fact.** ChainSpot's decisions are joint:
   - one tee per badge, and recovery stops at cardinality N (`poseSpace.mjs:139`);
   - a one-to-one Hungarian assignment of holes to baskets in S7;
   - owned corridors and first legs passed as state between holes.

   A per-fact polynomial cannot express "this way is good only if no other hole took that basket". The kernel needs a joint step (an assignment or constraint Calculation) over the facts' polynomials, not only `sum`.
6. **The provenance should be over data, not implementation ids.**
   - The kernel's monomials are implementation ids (`PR outputs/capability-lab/docs/semiring-sublation.md:25`; kernel.mjs:592).
   - In ChainSpot the useful lineage is which Parts, meaning frames, pixels and annotations, a fact rests on. The toolkit store already records that per address (`store.provenance(address)`, `tk/fg/store.mjs:95`; cache keys over input content keys, :109).
   - Blame-when-an-annotation-is-wrong needs Part-level variables.

**What fits, and what I'd try first:**
- **Anytime evaluation, cheapest first, stopping at a gate.** This is how ChainSpot S7 already wins speed:
  - straight holes claim first;
  - then each hole's top 3 neighbourhood candidates;
  - a hole widens only when its route fails the 0.75 sensor gate.
  - That cuts 83-100% of the 18×18 table with identical routes (tk commit 7c9b677, `docs/evidence/validation-s7/sam-2026-10-21.md`).
  - Stated assumptions that are loud when violated and widen on violation (`tk/fg/assumptions.mjs`, DOCTRINE "Assumptions are stated, fail loudly, and try to correct") are the safe form of "stop when confident".
- **The boolean and counting semirings for ranking evidence.**
  - Forward and backward tracks meeting is a real "two ways to the same fact".
  - It holds on 30/30 of Sam's dev pairings, against 11/61 of the wrong candidates, and on 129/135 of the default's validation picks (`tk/docs/evidence/s7evidence/evidence-2026-10-22.md`).
  - Counting or boolean over agreeing ways is honest there.
  - Viterbi is honest only after calibration.
- **A suggested ChainSpot experiment (replacing the brief's step 1).** Take S7's candidate cells, with each perspective as a term:
  - the backbone route, forward lanes, basket backwards and meeting;
  - plus one joint assignment step on top.
  - Report boolean, counting and calibrated viterbi, plus deterministic cost.
  - Compare against the learned logistic we already have.
  - The cells, perspectives and labels already exist (`tk/ports/s7route/evidenceSpace.mjs`, `tk.s7.cellEvidence`). It is a one-day check, not a new build.

Nothing in ChainSpot was changed for this entry.
