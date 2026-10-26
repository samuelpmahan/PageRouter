# thro-go creator insight, Builder notes (round 1)

## Files
- `index.html` renders the page (tabs J-Milly / Bodanza, `#jmilly` / `#bodanza`). Loads `insights.mjs` and `data/prepared.json`.
- `insights.mjs` builds one Capability Lab registry (`statistics.*` plus two registered composed capabilities `thro.ratio`, `thro.positionHistogram`) and calls `registry.execute` for every number. Each call stores a receipt (capability id, label, input, result, result hash, call count). Hover, focus or tap on any underlined number shows it in the bottom "how" bar.
- `build-data.mjs` is data preparation only (classification, mold-name normalisation, release matching). No statistics.
- `data/`: `appearances.json` (given), `videos.json`, `releases.json`, `description_links.json` (fetched by SELECT from D1, saved by `tools/save-fetched.mjs` and `tools/save-links.mjs`), `prepared.json` (build output).
- `tools/check.mjs` (prints the model in node), `tools/shoot.mjs` (Playwright checks and screenshots), `shots/round1-desktop.png`, `shots/round1-phone.png` (J-Milly), plus `-full` variants for both creators.

## Data notes
- videos: 10 (5 per creator), views snapshot 2026-10-21. releases: 75 rows returned with `kind != 'test'` (the query read 76 rows; one was the test row). description_links: 122 rows, saved reduced to video_id, position, destination_host, kind, thro_code (text is a truncated URL; manufacturer, mold, thro_code were null in all 122).
- No row in `appearances.json` has `end_seconds`. On-screen seconds therefore cannot be measured and the page does not show any. Exposure is shown as appearance counts, on-camera counts and a view ceiling.

## What is counted, what is excluded (of 205 rows)
Counted = timestamped (mode talked, thrown or shown), manufacturer known, manufacturer not guessed: 101 (J-Milly 28, Bodanza 73).
Excluded: 67 `candidate` rows (video-level notes, start 0, no timestamp, duplicates of timestamped rows or unverified); 19 timestamped rows with "guessed (manufacturer)" (shown hollow on the timeline, not in any brand total; my choice was exclude-and-show); 17 with manufacturer "unknown"; 1 row naming two brands ("Dynamic Discsand Innova", typo in source). Mold names are cut at the first comma/semicolon ("Convict, 2019 HP Pierce Team Series run" becomes "Convict"); "Unreleased, name withheld" is relabelled.

## Metrics (capability id, definition)
- Appearances per brand / disc: `statistics.sum` over 0/1 indicators of counted rows.
- On camera: `statistics.sum` of indicators, mode thrown or shown. "Mentioned aloud" = talked.
- Videos containing a brand: `statistics.sum` of per-video 0/1 flags.
- Reach ceiling (brand, creator, release window): `statistics.sum` of views of the videos where the brand appears. Upper bound only (all views of those videos, not viewers who saw the disc). Overlaps between brands, labelled "do not add".
- Share of counted appearances: `thro.ratio` (calls `statistics.sum` twice), scale 100.
- Rank: `statistics.rank` on negated counts, method min.
- Appearances per 10 minutes, per video: `thro.ratio`, counted / duration_seconds, scale 600.
- Position in runtime: `thro.positionHistogram` (calls `statistics.histogram`), 10 equal bins of start/duration.
- Row, video, link counts: `statistics.count`; exclusion and evidence-class counts: `statistics.sum`.
- Mean views and mean rate with 95% interval: `statistics.bootstrapMeanCI`, 1000 resamples (the capability's cap), seed 20261025. Median: `statistics.robustSummary`.
- Linked vs unlinked brands (Bodanza only): per-video rate of Infinite Discs + Trash Panda (hosts present in that creator's description links) minus rate of other brands; `statistics.mean` and `statistics.bootstrapPairedDifferenceCI`. J-Milly shows "not testable" (no counted brand has its own description link).
- Creator vs creator: `statistics.welchMeanDifference` on per-video rates, 5 vs 5. t = 0.90, df 7.6, so no detectable difference; the page says so.
- Release support: manufacturer + mold name match against exact-date releases; offset in days = `statistics.pairedDifferences` (publish day minus release day). Window: 14 days before to 90 days after. Only counted appearances qualify.
- Description links: total `statistics.count`; to retailer, affiliate, sponsor or manufacturer `statistics.sum`; carrying a thro code `statistics.sum` (0 everywhere).

## Findings on the page
J-Milly: 28 counted, Dynamic Discs 20 (71%), Discmania 7, Innova 1; ceiling 147,081 views; one release-window hit (Discmania PD, +50 days, one aloud mention at 13:30 in "I Brought Back a Retired Disc", edition not verified). Bodanza: 73 counted, Infinite Discs 39, Trash Panda 26, Kastaplast 6, Discmania 2; ceiling 107,473 (every video); no counted release hits; release table has no rows for Infinite Discs, Trash Panda or Kastaplast. Guessed-manufacturer lead shown, not counted: Discraft Buzz, +24 days from the 2026-09-25 release.

## Pitch panel
The "connect YouTube Studio" table shows measured appearances and ceilings next to three empty columns (attention-seconds, quarterly exposure minutes, link clicks) marked "after connect". No placeholder numbers. The sentence "not people, sales or revenue" is on the page.

## Rules check
Banner at top on every view; "viewer-hours" absent (checked in rendered text); guessed rows excluded from totals and shown hollow; terms written out.

## Known weaknesses
- 5 videos per creator: every interval is wide; the Welch comparison and linked-brand difference are descriptive.
- Rows are research-annotator output (confidence 0.4 to 0.9, all rows by one annotator run); "said aloud" dominates, so appearances are largely mentions, not verified on-screen time.
- Release matching is by mold name only; edition (plastic/run) is not verified. Coarse-date releases (year or month only, 3 matches) are skipped. Mold-name aliasing: only Buzz to Buzzz.
- "Linked brand" is inferred from description link hosts for two brands only; it says nothing about a sponsorship.
- Reach is a ceiling dominated by the fact that nearly every video features some counted brand (Bodanza ceiling equals all views).
- Page is dark-only; pitch table scrolls sideways inside its own box on a phone (page itself does not scroll sideways).
- The "how" bar input preview is truncated for long arrays; the full input is in the capability receipt, not shown.

---
# Round 2

Files added or changed: `build-data.mjs` (classification rewritten, no regex), `insights.mjs` (rewritten), `thro-capabilities/index.mjs` and `thro-capabilities/catalog.json` (new), `index.html` (layout and copy rewritten), `tools/export-catalog.mjs`, `tools/check.mjs`, `tools/shoot.mjs`. Screenshots: `shots/round2-desktop.png`, `shots/round2-phone.png` (J-Milly), `shots/round2-{desktop,phone}-{jmilly,bodanza}-full.png`, `shots/round2-desktop-receipt.png`.

## Changed counts
Rows are now classified once each, in this precedence: notes without a timestamp (candidate), set aside (unreleased disc), quoted from a friend, manufacturer unknown, manufacturer guessed, then counted; a counted row that repeats the same brand and mold in the same video within 30 seconds of an earlier counted row is "same moment" and not counted.
J-Milly 28 to 17 counted (6 unreleased set aside, 5 repeats, 1 quoted row; Convict is 7 now, Dynamic Discs 15). Bodanza 73 to 69 (4 repeats). Of J-Milly's 17, 16 are in "I Brought Back a Retired Disc".

## Unreleased discs (priority 2)
The 6 timestamped rows whose mold is "Unreleased, name withheld" (ids 74 to 79, Discmania, J-Milly "Hardest Course" video) are excluded: not in any brand total, not in the Discs list, not drawn on the timeline, no link to the moment. The page shows only a generic "6 set aside" in the rows bar. The one candidate row (id 1) is already excluded as a note. For Sam to decide: if a creator should never see even that count, drop the "set aside" segment in `index.html` (`fateLabel.withheld`).

## Finding by finding
| # | Result | What I did |
|---|---|---|
| 1 | fixed | One exclusive classification drives both the bar and the sentence; the bar shows what happened to every row (counted, no timestamp, guessed, unknown, repeat, quoted, set aside) and the evidence classes are counted over counted rows only. Guessed shows 6 and 13 in both places. |
| 2 | fixed | The footnote is derived from data (counted rows only, years from `release_date`); guessed rows no longer appear in release text at all. Bodanza shows "2 counted mentions of Discmania MD5 ... released in 2018". |
| 3 | fixed | A match is headline-eligible only if no earlier `new mold` release row exists for that manufacturer and mold (`moldOld`). PD has a 2008 row, so it is a small lead line saying "mold name only; the mold itself is older, so this does not count as release support". No 22px headline remains for it. |
| 4 | fixed | Regex removed. Id 111 is excluded by its evidence ("quote from a friend") and counted under "quoted from a friend". |
| 5 | fixed | Same brand, mold and video within 30 seconds collapse to one counted moment (9 rows, includes ids 106 and 107). Labels say "mentions and sightings". |
| 6 | fixed | `thro.ratio` and `thro.positionHistogram` now live in `thro-capabilities/index.mjs` with the Capability Lab descriptor shape, are registered in the same registry, have `thro-capabilities/catalog.json` with examples (all pass through `registry.execute`), and call `statistics.sum` and `statistics.histogram` through `ctx.call`. The receipt still names `thro.*` for those numbers; the page footer says they are defined in that catalog. Declined: adding files under `vendor/` (vendored, pinned). |
| 7 | fixed | Each receipt lists the rows that went in ("#90 Dynamic Discs Convict at 11:22 (thrown)", "Discmania PD: video 2026-09-01 minus release 2026-07-13"); raw input is kept under it. |
| 8 | fixed | No "vs", "Q4" or "calc" in rendered text (checked by regex on both tabs and both widths); "versus", "fourth quarter" replaced by "per quarter", "t statistic". |
| 9 | fixed | "Clicks count taps, not people, sales or revenue" sits inside the Link clicks item of the offer. The word never appears in a count context elsewhere. |
| 10 | fixed | Second stat tile: "94% in one video, 'I Brought Back a Retired Disc': the brand moment" (computed with `statistics.extrema` and `thro.ratio`; says "the busiest video" below 50%). |
| 11 | fixed | See Unreleased discs above. |
| 12 | fixed | Reach ceiling removed from the hero; it stays in the ledger column with one ceiling note. |
| 13 | reframed | Linked-brand paired interval moved to the Method disclosure; the offer says "N of your M description links go to retailers, affiliates, sponsors or manufacturers; 0 are measurable per-disc links". |
| 14 | fixed | Bodanza's release panel opens with the calendar sentence (covers 10 manufacturers; Infinite Discs, Trash Panda Disc Golf and Kastaplast are not in it yet). The guessed Discraft Buzz lead is dropped. |
| 15 | fixed | Welch row and "How sure are we" moved into a collapsed "Method and small sample" disclosure; "small sample" is said there once. |
| 16 | fixed | First tile: "mentions and sightings counted, N of them on camera". |
| 17 | fixed | Hero rate is pooled (counted rows over total runtime, per 10 minutes: 1.2 and 3.9). The Method disclosure shows the average of the per-video rates and says which is which. |
| 18 | fixed | Offer is the top of the right column (y = 177 at 1440x900): three one-sentence benefits, a "today" line using real numbers, a "Connect YouTube Studio" button that opens a four-step "How it works" (no fake success, no invented address; price and start date say "reply to the message that brought you here"). Assumption for Sam to confirm: the "read-only access to this channel's YouTube analytics" wording. |
| 19 | fixed | One ceiling note, no repeated caveats; the clicks sentence and banner kept. |
| 20 | fixed | The internal-data admission is gone; the offer says what thro-go does. |
| 21 | partly | The line under the creator name now names the most-counted disc ("Dynamic Discs Convict, 7 in 2 videos"). Not done: stamp and run descriptions (Robert stamp, 2019 run); the data supports it, it is a possible round 3. |
| D1 | fixed | The "how" bar is one idle line (it grows only when a number is hovered or tapped). At 1440x900 the right column ends above it (rows panel bottom 829 and 859 against bar top 868). |
| D2 | partly | Offer, ledger, timeline, release and rows all sit in the first screen; page height is 939 (J-Milly) and 969 (Bodanza) because the collapsed Method disclosure is below. |
| D3 | fixed | Columns are within about 30 px of each other. |
| D4 | fixed | Title column 330 px, wraps to two lines; rows with guessed ticks say "N guessed". |
| D5 | fixed | One hollow style, one legend entry. |
| D6 | fixed | Amber is used only for thro (banner, active tab, offer). Brand colours are cyan, coral, lime, violet, pink. |
| D7 | fixed | The offer is a list, not a table, so nothing is clipped at 390 px; the pitch table is gone. |
| D8 | partly | Phone banner and header tightened, stat tiles in 2x2 at 23 px; first brand row at about y = 430. |
| D9 | no action | Review said OK. |
| D10 | fixed | Dotted underline is faint until hover or focus. |

## Checks (Playwright, 1440x900 and 390x844, both tabs)
Zero console or page errors and no failed requests; no horizontal scroll (scrollWidth 1440 and 390); banner present; "viewer-hours" absent; no "vs", "Q1" to "Q4", "Unreleased" or "name withheld" in the rendered text; "not people, sales or revenue" present.
