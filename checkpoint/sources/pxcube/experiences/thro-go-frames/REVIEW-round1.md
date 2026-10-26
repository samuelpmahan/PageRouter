# Critic review, round 1 (thro-go-frames)

Scratch scripts: tools/critic-graph.mjs, critic-recompute.mjs, critic-mutate.mjs (recreates tools/critic-mutants/ copies; deleted after the run), critic-shots.mjs, critic-mobile.mjs. Screenshots: shots/critic-*.png. Builder files untouched. node --test: 58/58 pass (confirmed).

## Graph metrics (tools/critic-graph.mjs; raw data/toy-world.json; edges = every ref/refs terminal)
- 781 instances, 1,208 reference edges, 0 dangling. Average degree 3.09 (1.55 edges per node).
- **47 connected components for 47 Cases.** Largest 30 nodes, smallest 14, median 15. Components spanning more than one Case: **0**. Edges crossing a Case boundary: **0**. Entities (by id) in more than one Case: **0**.
- Sharing, all inside single Cases: discs on more than one video 3 of 53; molds on more than one video 4 of 49; manufacturers on more than one video 4 of 46; molds held by more than one creator 1 (c08 only); manufacturers with deals with more than one creator 1 (c08 only); videos showing discs of more than one brand 1; creators with more than one video 3 (max 3); creators with more than one bag 2; bags applied to more than one video 1.
- Name collisions with no identity link: 48 Creator instances share 6 names (Ines Varga x13, Beck Alvarado x9, Jory Lindqvist x9, Tavi Okonkwo x7); 51 Manufacturer instances share 7 names (Halcyon Discs x11); 56 Mold instances share 8 names (Tamarind x12).

## 1. Richness / cross-linking
1.1 **The dataset is 47 disconnected fragments, not a rich dataset.** Numbers above. This is the biggest miss against "A RICH dataset is heavily cross linked". Cause: scene.mjs `baseline()` (lines 90-114) creates a fresh creator, brand, mold and disc for every Case, and ids are prefixed `cNN.`; the generate.mjs guarantee `ids-unique-and-scoped` forbids a shared id. Enrichment is therefore only ever exercised on 14 to 30 node graphs. Fix: build one World once (see 1.4); a Case becomes a named situation (a selector over the shared world: creator, videos, sponsor, date range) plus the departure applied to that world. Replace the prefix rule with global uniqueness.
1.2 **Name collisions are a trap, not links.** 13 different "Ines Varga" creators, 12 different "Tamarind" molds, 11 different "Halcyon Discs". Any rollup keyed by display name silently merges unrelated entities, and the page shows identical names for distinct entities. Fix: one entity per name in the shared world; a test that no two Creator, Manufacturer or Mold instances share a name.
1.3 **Many terminals are single-valued defaults that no link checks.** Link.destination is the same string `https://shop.example/halcyon/comet` for all 51 links, including a Tamarind disc whose brand is not Halcyon (c32 Link2). Derive the destination from Disc -> Mold -> Manufacturer and add an expectation that it agrees; that is a cross-link check. Creator.plan ('thro' vs 'thro-go') is never read by enrich, metrics or display and 48 of 48 are 'thro-go'. Release.kind: 53 new-mold, 1 new-run, 0 reissue. CardPlacement.layout: 54 of 56 lower-third. Appearance.evidence 'card' is never generated. Link.placement: 48 description, 3 bio; pinned-comment and card never occur and placement affects no metric or sentence.
1.4 **What the single connected world should be** (one seed, built once): 2 to 3 creators (one Short-heavy, one without Studio), 4 manufacturers with 3 to 6 molds each, one mold with two runs, one release at month precision, sponsor timelines (creator 1 switches A to B mid-quarter; creator 2 stays with A all year; one deal covers only 2 molds), 12 to 20 videos across Jan to Jul 2026 including one published on a deal's last day and one on a release day, 4 to 6 Bags that evolve (a disc leaves and returns), links in all four placements, clicks spread over 60 days after each publish. Queries that then become possible and are untestable today: exposure minutes per sponsor per quarter across creators (today every row is 1 or 2 videos); a sponsor's before and after a switch; per-mold release curves (attention at days -30..+60 of a release, summed across creators; needs two or more videos per mold); clicks per 1,000 attention-seconds ranked across discs; which discs creator X carried in every Bag; pre-release attention versus first-window attention for one release; Short versus long split per sponsor. Keep per-departure Cases, but assert them as deltas on the shared world (the answer to a query before and after the departure).
1.5 Because every quarter row has one creator and one or two videos, the cross-creator sum and the quarter bucketing in `thro.go.sponsorExposure` are nearly untested (mutant quarter-wrong survived, see 4).

## 2. Minskyan framing
2.1 **Alternate-frame selection is hand-coded, not driven by the frames.** The `mismatch` strings in frames.mjs ('frame:PreReleaseAppearance', 'transform:clamp-to-video-end', ...) are labels: grep shows enrich.mjs never reads `.mismatch`. enrich.mjs re-implements each expectation as its own `if` (placements lines 83-92, deal bucket and release state, clicks lines 120-135), and the guarantee `every-violation-selects-something` then checks the two agree. The frame expectations are a test oracle; the real selection logic lives elsewhere, and a new expectation needs two edits. Selection is by expectation violation in code (not by Case label), which is right in spirit, but it is duplicated logic. Fix: loop `checkExpectations(W)`; for each violation look up the `mismatch` string in a handler table (`frame:X` instantiates X from the violating instance's terminals; `transform:Y` calls a named function); delete the parallel ifs.
2.2 **Alternate frames do not inherit or have their own expectations.** In Minsky's scheme the replacement frame inherits the failed frame's slots. Here `alt()` receives hand-built overrides; the 8 alternates have 1 to 5 terminals and no expectations (PreReleaseAppearance.daysBeforeMin <= daysBeforeMax is not asserted), cannot themselves mismatch, and combine only by being instantiated side by side (a pre-release card of an other-brand disc yields two unrelated alternates). Fix: `inherits: 'CardPlacement'` on alternates, expectations on alternates, one chained-mismatch Case.
2.3 **Few terminals have constraints.** Only 17 of 89 terminals carry any expectation; none for Disc.photo, Click.country, Link.destination, Creator.*, Manufacturer.*, SponsorDeal.moldsCovered. Types are strings parsed by `typeOk` with no ranges (views >= 0, endLevel 0..1) and no consistency (date '2026-06' with precision 'day' passes). The unitInterval expectation (retention 0..1) is wrong for Shorts, which loop above 1.0.
2.4 A frame cannot make a valid instance alone: refs default to null and are wired by imperative scene.mjs helpers. Let a frame declare its required wiring.

## 3. Case generation
3.1 **Cases are hand-listed departures.** `DEPARTURES` in departures.mjs is a hand-written table of 38 entries; generate.mjs walks FRAMES x terminals only to look each key up. A terminal with no entry produces no Case, silently. Terminals with a departure: about 38 of 89. Never varied: Creator.plan, Link.destination, Release.kind reissue, Video.orientation (long but vertical), Appearance.evidence, Manufacturer.country, CardPlacement.layout. Fix: derive departures from type and expectation (enum: every other value; date: boundary days from related terminals; int: 0, -1, duration, duration+1; ref?: null; each `expect`: one violating value); hand-written entries only add scene wiring. Add a test that every soft expectation has a generated violating value.
3.2 Pair compatibility depends on hand-typed `touches` and `reads` arrays that nothing checks.
3.3 **Missing coverage (no Case exists for any of these):**
- Deal boundary: video published on the deal's last day, first day, day after. `dealEnded` uses end = published - 10; `brandSwitch` videos are 05-10 and 05-20 against 05-15 and 05-16. Mutants deal-end-off-by-one and deal-start-off-by-one survive.
- Release day: video published on the release day (day precision) and on the first and last day of a month-precision month. Mutant release-day-is-prerelease survives.
- 30-day window edges: day 29, 30, 31. Mutants release-window-29 and -31 survive. The window is a constant (metrics.mjs `lo <= 30`) and is hard-coded in the meaning sentence; make it a Release terminal (`windowDays`, default 30).
- A disc moved between Bags, or a video in two Bags: `bagOf` (world.mjs line 262) returns the first Bag containing the video; no expectation `oneBagPerVideo`. `bagChange` swaps two different discs; the same disc never leaves and returns.
- Link placement variants: pinned-comment, card (see 1.3).
- Two sponsors on one video, or overlapping deals: `sponsorBucket` takes the first deal matching the manufacturer; two deals for one brand with different `moldsCovered` are unhandled.
- Clicks over time: 63 clicks on 6 distinct dates, 51 identical (`2026-05-12T18:04:00Z`). No day-N-after-publish curve; clicks per 1,000 attention-seconds divides lifetime clicks by lifetime attention.
- Retention realism: 47 of 49 curves are linear-decay ending 0.4 to 0.6, 2 are flat, one dip shape. Real curves drop steeply in the first 5 to 15 seconds, and Shorts loop above 1.0. A curve starting at 1.0 at second 0 overstates attention.
- Time zone and day boundary: `Click.at` is UTC, `Video.publishedAt` a bare date; `notBeforePublish` compares `at.slice(0,10)` to the date, so a click at 2026-05-10T03:00Z on a video published the evening of 05-09 Central is flagged "before publish". No Channel.timezone.
- Month-precision release meeting a deal that ends mid-month.
- Views above zero with no curve ('no-curve' state); a Short and a long video in one rollup; card at startSec 0; card ending exactly at the duration.

## 4. Correctness
### Independent recomputation (tools/critic-recompute.mjs; reads only data/toy-world.json, imports nothing from the Builder; compared to data/results.json). ALL MATCH to 1e-6 relative:
| Case | quantity | mine | builder |
|---|---|---|---|
| c24 overlapDifferentDiscs (cards Disc1 23-46, Disc2 28-51) | union attention-seconds, overlap once | 29,757 | 29,757 |
| c24 | sum if double counted | 48,886.5 | 48,886.5 |
| c24 | sponsor exposure minutes | 495.95 | 495.95 |
| c05 brandSwitch (A to 05-15, B from 05-16; videos 05-10, 05-20) | Disc1 in 05-10 as sponsor, minutes | 318.1107 | 318.1107 |
| c05 | old-brand Disc1 in 05-20 as other-brand, minutes | 378.888 | 378.888 |
| c05 | Disc2 (brand B) in 05-20 as sponsor, minutes | 636.2213 | 636.2213 |
| c08 cross-creator | Sparrowhawk total attention-seconds | 145,384.32 | 145,384.32 |
| c08 | Beck 32,280.96; Pell 113,103.36 | same | same |
| c16 preRelease | offset days | -12 | -12 |
| c02 monthBefore (release 2026-06, video 05-10) | range | -51..-22 | -51..-22 |
| c03 monthInside | range | -21..+9 | -21..+9 |
| c11 newRun | offset vs Tour Series 06-01 | -22 | -22 |
| c19 zeroViews | attention | null | null |
| c25 pastVideoEnd (card 110-140, video 120 s) | attention, seconds | 5,702.64 over 10 s | same |
No arithmetic error found. The gaps are in what is not asserted.

### Mutation test (tools/critic-mutate.mjs; 18 mutants on copies; node --test)
CAUGHT (8): no-overlap-merge-same-disc, no-union-across-discs, ignore-placement-clamp, month-last-day-off, zero-views-as-zero, mold-not-covered-ignored, dip-threshold, zero-length-kept.
**SURVIVED (10; zero test failures; output byte-identical):**
1. deal-end-off-by-one (`iso <= d.t.end` to `<`) and deal-start-off-by-one.
2. release-day-is-prerelease (`p >= r0` to `p > r0`).
3. release-window-31 and release-window-29 (`lo <= 30`).
4. click-ts-end-inclusive (`ts < a.end` to `<=`).
5. ignore-given-clamp (marked throws past video end not clamped; only CardPlacement clamping has a Case).
6. **views-first-snapshot** (`latestViews` returns the first snapshot): even the `growth` Case passes. oracle.mjs imports `latestViews`, `curveOf`, `placementsOf`, `givenAppearancesOf` from world.mjs, the module under test, so a bug there moves oracle and code together. The oracle.mjs header says "no shared code"; false. Fix: read only raw `inst.t` fields in the oracle, as my recompute script does.
7. quarter-wrong (June counted as Q3).
8. per-thousand-scale (scale 1000 to 100): no Case asserts clicks per 1,000 attention-seconds.
The Builder's one noted gap (deal boundary) is 2 of 10.
4.1 **The page's PASS is not independent.** index.html runs the same pipeline in the browser and prints "47 / 47 Cases PASS ... byte for byte" (shots/critic-desktop-landing.png). A smoke check, not verification; label it.
4.2 Attention is lifetime views x retention sum. With a curve starting at 1.0, a 19 s card at 1,500 views reads 24,890 (c00). The guarantee `bounded-by-views-times-seconds` is trivially true because retention is at most 1.
4.3 Click attribution `kind: 'video'` with several appearances sets `appearanceId: apps[0]` and `appearanceIds` for all; the guarantee says "never two at once". No Case has two appearances of one disc plus a video-level click.
4.4 **Silent zero where the rule says null.** c01 (Studio not connected): the sponsor exposure row has `minutes: 0`, `entries: 0`, `unmeasuredVideoIds: [Video1]` (metrics.mjs line 6, `sum([])` returns 0). The row and its sentence report 0 exposure minutes for a sponsor whose video simply could not be measured. Return null with reason.

## 5. Meaning
5.1 Sentences are generated from `deriveFacts(W,E,M)` over linked data, not keyed by Case id. Each Case still names a `focus` (hand-set per departure) that picks the fact kind, and each test asserts substrings chosen by the Builder per Case (`x.says('pre-release','disc','12 days before', ...)`), so wording is partly checked against itself.
5.2 **A sentence claims behavior the code lacks.** meaning.mjs line 22: "Shorts are reported apart from long videos so a 40-second vertical clip is never averaged into long-form attention." metrics.mjs has no format grouping (no `short` or `format` in metrics.mjs); byDisc, byMold and exposure add Shorts and long videos together. The `short` Case asserts the phrase "Shorts are reported apart", locking in the false claim. Implement the split or delete the claim.
5.3 "exposure minutes" (414.83 for a 19 s card, 1,500 views, c00) reads as airtime; it is viewer-minutes. A sponsor reading "Ovenbird Golf earned 2,423.07 exposure minutes" hears total airtime. Rename "viewer-minutes" and show "19 s on screen x 1,500 views".
5.4 "24,890.0 attention-seconds": one decimal implies precision on a modelled value.
5.5 "pre-release hype Halcyon Discs can see" asserts hype; data show attention before a date.
5.6 c08's sentence says the brand "sees one sponsor total", but the page has no sponsor view; only per-creator tabs.
5.7 Nothing ties facts across entities (e.g. one disc's videos around its release); fragments prevent it.

## 6. Page (1440x900 and 390x844; shots/critic-*.png; no console errors, no sideways scroll)
6.1 Mobile page height for one Case (c05) is 10,255 px, about 12 screens (shots/critic-mobile-c05-full.png). Collapse Frames, mismatch and checks sections on mobile.
6.2 Mobile sponsor exposure table (shots/critic-mobile-c05-mid.png): quarter wraps as "20 / 26-Q2"; "Halcyon Discs . not a sponsor (other-brand)" wraps over five lines; one row says "378.89 min, other brand", the next "318.11 exposure minutes". Stack as cards, one unit label, nowrap on quarter.
6.3 No sponsor view and no link or graph view. The edges exist in `E.edges` but appear only as text. Add a Links view drawing the shared world and highlighting the subgraph a Case touches. On desktop c08 (shots/critic-desktop-c08-full.png) the mold rollup "Sparrowhawk . 1 disc / 1 other creator shares this mold" is cut at the 900 px fold.
6.4 Desktop landing: 15 filter chips wrap to 5 rows and take about 200 px before the first Case; list titles such as "Disc.creatorId > crossCreator" mix code identifiers and prose; 71 text nodes at 10.5 px.
6.5 Repeated creator names across Cases (1.2) are indistinguishable on the page.
6.6 The first line a user reads is internal test language: "regenerated world = data/toy-world.json, byte for byte".
6.7 Desktop `fullPage` screenshots show only the viewport because an inner container scrolls; the page cannot be printed as one scroll.

## 7. Verified OK
- node --test 58/58; same seed gives same bytes and data/toy-world.json matches a rebuild; other seeds differ and still pass.
- 14 independently recomputed numbers across c24, c05, c08, c16, c02, c03, c11, c19, c25 match (section 4).
- Overlap handling (same disc and across discs), clamp, zero-length, zero-views-to-null, mold-not-covered and dip threshold mutants are caught.
- All 8 Calculations run through the witnessed runner with guarantees; attention goes through thro.attentionSeconds -> thro.ratio -> statistics.sum with receipts on the page.
- Every Case names the frame terminal it departs from; departures are recorded against defaults; every hard expectation holds in generated data.
- Clicks disclaimer "not people, sales or revenue" present on the panel; terms written out in full in the UI.
- 0 console errors and no horizontal scroll at both viewports.
