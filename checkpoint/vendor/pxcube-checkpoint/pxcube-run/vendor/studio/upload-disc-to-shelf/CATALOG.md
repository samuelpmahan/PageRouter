# Seed catalog — 2026-09-13

724 source-named entries across 42 source-provided manufacturer labels. These
are editable starting facts, not 724 verified distinct molds or current stock.
Aliases, historical models and malformed upstream brand labels remain possible.
All imported entries start `unreviewed`; no Sam acceptance was inferred.

## Sources and regeneration

- Innova: 123 rows from https://www.innovadiscs.com/disc-golf-discs/disc-comparison/
- Kastaplast: 24 canonical mold collection links from https://www.kastaplast.com/en-us/collections/all-discs . Ratings come from the first product flight card on each collection, not a claim of agreement across plastics.
- Discraft's public multi-brand finder: 675 records from https://buildmybag.discraft.com/ . The data endpoint was read from its public application script; that script was not executed. Other brands' rows are finder assertions, not direct manufacturer verification.

`node mine-catalog.mjs` fetches or reuses cached source bytes. Each fetched file
in `catalog-source/` has a URL/time/SHA256 receipt. `node build-catalog.mjs`
rebuilds `catalog.ts` and `catalog-manifest.json` from the cached imports.
No live network request is needed by the shelf to use this catalog.

Matching manufacturer/mold names are normalized for case/accents and punctuation;
plus is preserved as `-plus`. Direct manufacturer data takes precedence over
finder data. All rating observations remain attached. 21 entries disagree;
Kastaplast Sten has four unknowns left null. Imported timestamp means fetch time,
not the upstream data's age. Exact-name deduplication is not alias resolution.

## Review and composition

Choose a mold in the composer to jump its review card to that seed. The card
shows source, review status and conflicting ratings. Yes advances; No enables
editing manufacturer, mold and flight numbers, then Save advances. Unknown
ratings may remain blank. Confirmation/correction creates a fresh seed Part
through `ds.px.calc.refineSeed`; the prior seed and saved discs remain unchanged.
Receipts land at `ds.px.receipt.review-N` and in the local diagnostic log.
Reviews and shelf contents are session-only: reload clears both.

Plastic guides currently cover Discraft, Innova and Kastaplast only. They are
manufacturer-level suggestions, not verified mold/plastic combinations. Other
manufacturers and custom plastic names still accept free text.

Painting now uses the existing sibling painter implementation directly. 50/50
and Halo combine two palettes when Apply colors is checked; unchecked preserves
the original palette. The existing fern label takes the nickname (13 characters).
Saved art is retained through `ds.px.calc.renderPainting`. Photos are untouched.

## Fresh evidence

Local uncommitted app against PnC HEAD
`67fc238512e8d7e9a517fc5b53785fb77e5b6db4`; kernel unchanged.
44 tests passed: 34 kernel/scaler plus 10 app/catalog checks. TypeScript no-emit
check passed for app.ts and model.ts with imported modules. Browser verification
in a disposable session exercised Halo + color painting save/readback, Yes → next,
and No → edit flight → save → next. Those automated review records are discarded,
not Sam's acceptance. Source parsing checks do not prove every catalog fact true.

{?} Add durable review export before asking Sam to invest in a long review pass.
{?} Resolve aliases and fetch dates/availability only when needed; don't silently
merge distinct molds or infer current stock from historical finder entries.
