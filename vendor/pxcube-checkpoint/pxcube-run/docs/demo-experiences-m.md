# Three minimal Experience candidates

Sam's scope, 2026-09-14: BuildBag, CreateGraphics, ExportGraphics. Muse owns tooling.
Upload's original m and the accepted shopping Shelf remain their existing surfaces.
These are review candidates, not human acceptance or promotion.

## Visible review

- BuildBag: select exact copies from a deterministic specimen shelf, arrange the
  selection, name/create a Bag, reopen it after reload. Mold/manufacturer first;
  plastic then weight descending. Nicknames are recognition only, never searched.
- CreateGraphics: choose a specimen, Spotlight design, colors and frame; keep
  a rendered graphic. Uses Studio's existing card cascade and renderer.
- ExportGraphics: inspect a kept graphic, download its exact SVG or a PNG at its
  captured dimensions. Retain the actual byte count/hash and failures. A download
  request is not proof that the user saved the file.

Each owns mock.<experience> (interactive) or mock.<experience>.<iterator> (test).
An explicit “Keep for ExportGraphics” offers an immutable capture; ExportGraphics
imports it into its own store. No live store, test fixture, or uploaded photo is
silently shared. Starter examples are identified as seeded demo material.

## Parts and Calculations before implementation

Reuse the pinned Studio store, Part, compose, archive/restore, fn.read,
fn.shelfRows, fn.createBag and fn.addReference. Bag members retain physical ids
and exact version addresses. The UI's unfinished selection is a separate Part.

New local material lives under ds.px.studio.demo.* (public mounted px.studio.demo.*,
using the existing legacy mount adapter). Named design, selection, field projection,
card, frame, scene, graphic, capture and export-result Parts are distinct values.
Inputs retain the actual source Part links. No new kernel or executor.

The graphic composition binds disc + resolved mold + retained art, then existing
cardsEffective → cardsApply → composeCard; composeFrame + composeOverlay →
materializeOverlay produces the same SVG used by preview and export. The new
field adapter maps the pinned specimen representation into those existing bindings.
Designs contain bindings; captures retain exact rendered material.

Filesystem packaging, browser PNG conversion, hashing and download are explicit
effects. Existing pngFromSvg and sha256 implementations supply bytes/hashes.
Per-export success/failure material is retained; pure replays do not repeat downloads.

## Deliberate boundaries

- This candidate starts with DiscSpotlight; Competition is a next variation.
- The imported fn.createBag rejects an empty selection. That is today's limitation,
  not a universal rule; the older Experience contract allows an empty Bag.
- No ManageBags implementation, kernel migration, new build system or automatic promotion.
- Separate sandbox seeds do not claim to be the user's full accepted 50-disc shelf.
- Retained source code and import hashes travel in-repo; no sibling checkout is
  needed by a fresh clone to build these Experiences.

## Browser finding

The first browser run hit localStorage's quota opening a numbered test. The
existing archive held about 992 KB for eight seeded specimens; redundant query
projections grew it further. A failed open also exposed an owner/model mismatch.

The consumer now reuses an unchanged shelf projection and rendered result, swaps
the active owner only after successful opening, and gzip-encodes the **complete
existing archive** with the browser's CompressionStream. No Part is omitted.
Byte round-trip and the existing composition replay remain the tests of sameness.
This is a storage encoding adapter, not a new archive schema or core migration.
Commit is awaited before the UI claims a save; failed writes preserve stored bytes.

PNG conversion and download still use the existing browser effect functions,
outside the pure replay chain. Their measured outcomes enter named Parts and a
pure record Calculation bound to the capture. Restoring an archive verifies that
composition; it does not repeat a download or claim to replay the browser effect.

## Corner overlay correction

CreateGraphics now defaults to a transparent 1920 × 1080 canvas with a compact
620 × 244 DiscSpotlight panel, inset 60 pixels from the chosen corner. The
canvas is the video-sized export, not a box to center a portrait card in.
`fn.studio.canvasFields`, `canvasDesign`, `canvasFrame`, and `canvasScene`
compose named source fields and layout data through the existing renderer.
New exports omit nickname nodes and painted name plaques. Old captures keep
their original bytes; current editable contexts adopt the corner default as a
new context Part. See `evidence/overlay-layout-review/` for exported alpha
measurements and all-corner bounds checks.

The current `corner@3` layout adds `fn.studio.cornerTypography`: a shared
manufacturer/mold and plastic/weight header above a 108-pixel number row, with
no flight labels. CreateGraphics and ExportGraphics use the same rendering
chain; importing a newly kept graphic retains exactly its SVG bytes. Earlier
captures remain selectable snapshots of their original layouts.

The nine-card study crosses `spacingStudies` (close, balanced, open) with
`typeStudies` (bold sans, editorial serif, technical mono). Each pair becomes
a named `study` Part bound into `fn.studio.cornerStudy`. `fn.studio.cardPreview`
projects the actual composed card through the existing `cardSvg` renderer;
the chosen study is retained in the design and uses the same full-canvas
render for capture and export. No pixel or SVG rewrite makes the alternatives.

Sam rejected that first sheet as variations within one layout. `corner@4`
adds nine authored compositions in `local/studio-demo/compositions.mjs`:
broadcast rail, split ticket, paper score slip, floating orbit, caption ribbon,
upright tag, crest, edge crop, and number plate. The recipes vary overall
dimensions, silhouette, artwork placement/crop, grouping, and foreground vs
background roles. Each retains the mold and plastic/weight header and the four unlabelled flight
values in their usual order. Sam then removed the manufacturer from the card:
`fn.studio.moldHeading` gives that space to a larger mold name.

The first attempt exposed a renderer limitation: arbitrary SVG image fields
produce an “Add image” placeholder. The visual check caught it; the regression
now rejects that placeholder. `fn.studio.layeredCompositionDefinition` projects
the chosen recipe’s nodes; `fn.studio.compositionLayers` projects its panels
through the existing card renderer. `fn.studio.layeredCompositionScene` places
those native card layers behind the specimen and bound fields. Preview and
export both use the existing overlay materializer.
The earlier typography recipes and Calculations stay available for replay;
the picker now shows the nine distinct compositions, with their actual export
dimensions and the idea each one explores.

## DiscCompetition creator queue

Sam corrected the scope: work one image at a time, queue it, then change the
next state. No generated timeline, timing editor, or automatic tournament.
Choose 2–4 exact copies; set whose turn it is, enter points, adjust each card's
size and accent. The current turn starts larger; equal sizes and manual sizes
are available. Queue the visible image when ready. Export each queued image
in order through the existing exact capture → PNG/SVG path.

Parts: named selection + Disc/mold inputs → current Competition material
(entries, authored points, turn, styles) → existing battle entry projection →
shared card composition → per-card treatment → scene → graphic → capture.
`fn.studio.competitionDraft/Edit` retain creator changes; `fn.battle.entry`
reads the same authored state the controls show. Points are the creator's
numbers (mapped into the old battle score field); no scoring rule is inferred.
`fn.studio.competitionAppearance/Treatment` apply size and accent as named data.
`fn.studio.competitionScene` uses composeOverlay and the existing layer renderer.
Every queued image has its own graphic, source Parts and digest. Create and
Export share these captures; later edits do not alter a queued image.
