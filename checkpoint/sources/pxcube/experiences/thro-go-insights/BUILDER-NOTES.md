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
