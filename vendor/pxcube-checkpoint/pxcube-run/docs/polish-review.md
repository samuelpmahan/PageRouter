# Studio demo: polish review handoff

Sam requested this snapshot for online polish work on 2026-09-15. The local
lane is connecting a newly created physical disc, once using a photo and once
using paint, from Upload through storage, Shelf, Bag, Graphics and Export.
Those end-to-end paths are not yet claimed to work. The present downstream
Experiences use their own seeded collections.

## Run and inspect

Use Node 22 or later. From a fresh clone, run `node local/run.mjs dev` and open
the printed local URL. No sibling repository is required. Experience manifests
are in `.tidy/manifest.json`; crisp builds the shared consumer and verifies the
vendored Studio sources. Build outputs and receipts remain under `.pxcube/`.

## Where to polish

- `local/studio-demo/app.mjs`, `style.css`, `index.html`: BuildBag,
  CreateGraphics and ExportGraphics presentation and interactions.
- `local/studio-demo/compositions.mjs`: nine genuinely different card layouts.
- `local/studio-demo/graphics.mjs`: shared Part-bound layout calculations.
- `local/studio-demo/competition-ui.mjs`: select 2–4 copies, author one image,
  queue it, change turn/points/size/color, then queue the next image.
- `local/studio-demo/competition.mjs`: the corresponding pure calculations.
- `local/studio-demo/model.mjs`: owner store, compositions, capture and export
  state. Coordinate functional changes here with the local end-to-end lane.

Keep Sam's choices: a large mold name without a manufacturer headline;
plastic and weight paired; four flight numbers without their word labels;
no nickname labels. The graphic is small in a corner of a transparent video-size
canvas. The newspaper photo is preview-only. Create and Export share the same
captured SVG. Each queued image is deliberately authored, not an invented match
timeline or score simulation. Check spacing both enlarged and at its actual
corner size over footage.

## What is proved and what is still a finding

Main through `c9d446c` is integrated without replacing the published local branch
history. Both the Studio consumers and Main's console/cartridge work are retained.
The new console artifact checks belong in `local/test/e2e/`, after site assembly;
they previously read an absent or stale `dist/` during the pre-build unit stage.
The BuildBag assembled-model test now targets the implemented consumer. Generic
scaffold coverage continues to generate and exercise the scaffold independently.

`node --test local/test/demo-experiences.test.mjs` packages its own fresh test
tree. It checks the shared renderer, source identity, old captures, queue order,
duplicate images, storage reload, and turn/points/size/color changes.
`evidence/competition-queue/review.json` records a real two-image browser export;
`evidence/overlay-layout-review/` records layout checks.

The queue is not yet suitable for 100 images: full SVGs, accumulated intermediate
Parts and mailbox copies still grow per save. `evidence/competition-queue/`
contains a bounded capacity measurement and the proposed compact recipe/delta
format. That proposal is not implemented. Existing PNG export generates bytes
outside localStorage. ZIP export and a CapCut import check are also outstanding.

The next functional proof must start without a seeded physical disc: create it,
preserve its exact identity and photo/paint through each Experience, reload, and
export the graphic actually previewed. Catalog mold definitions may remain;
they are not substitute owned discs. Sandbox test iterations must stay isolated.
