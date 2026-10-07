# DiscStudio workbench · UploadDiscToShelf and ExploreShelf

This is the runnable Studio slice in PnC. Start with the repository's
[development guide](../../DEVELOPMENT.md). The
[selected Boone/Muse import](../../.neat/ds/imports/boone-uds/integration/RETURN.md)
retains paint recipes and photos independently, supports live/fixed labels, and
adds explicit shelf queries and persistent Bags on the existing Part store.

New: [PxC DevTools](DEVTOOLS.md) tab over this live store; shelf cards open their
exact saved Part. Browse, search, inspect composition links and try scratch material.

Latest: [scalar fields, shared operations and inspectable Ticks](REFINEMENT.md).
Earlier: [catalog, review and live-painting update](CATALOG.md): 724 sourced
entries, editable review, 50/50 and Halo palettes. The initial implementation
notes below are historical where superseded by that update.

Run from this directory with Node 24: `node server.mjs`.
Open http://127.0.0.1:4317. No installation, YAML, build watcher, remote upload,
or modifications to the existing DiscStudio app are required.

Choose a seeded mold, add nickname/plastic/weight and two colors, keep or change
the random painting (or upload/take a photo), then save. A disc can keep both
sources and switch which one is displayed. Painting labels follow the bound
manufacturer/mold when live; a fixed label keeps the supplied text. The regular
app persists its composition graph in browser localStorage and replays it on
reload. The explicitly labelled sandbox Experiences start with disposable data.

Select a saved physical disc to inspect it, switch its depiction, or add it to a
named Bag. Existing Bags resolve later edits by physical ID while retaining the
exact version addresses selected at creation. A failed save does not advance the
current collection pointer. [Persistence details](PERSISTENCE.md).

The accepted shopping shelf is preserved in `accepted-shelf.html`, available
from the Experiences launcher. It is still a separate prototype; its shopping
layout has not yet been connected to the live Part-backed shelf.

## Parts and Calculations

- `ds.px.seed.<id>`: Mold with manufacturer/name strings and speed/glide/turn/fade fields.
- `ds.px.paintings`: three generated images from the existing DiscStudio painter.
- `fn.selectPainting`: catalog + recorded random index → selected image.
- `ds.px.draft.<save>`: mold reference, nickname, weight, plastic, Color1, Color2, optional own flight fields.
- `ds.px.depiction.<save>`: supplied photo or selected painting.
- New Disc references point to independent recipe, photo, choice and art Parts.
- `fn.paintRecipe` and `fn.renderDepiction`: validated recipe + retained sources
  + choice + bound mold → reproducible selected art. `paint-recipe.ts` defines
  the fields and null-live/string-fixed label contract.
- `oc.create`: draft + depiction + identity → `ds.px.disc.<save>`.
- `fn.read`: retained mold + own disc → `ds.px.resolved.<save>`.
- `oc.update`: own material + field patch/removals → fresh candidate or reviewed mold.
- `fn.addToShelf`: prior shelf + disc + its address → `ds.px.shelf.<save>`.
- `ds.px.tick.<save>.<specialize|depict|retain>`: actual outputs at an inspection boundary.
- `ds.px.receipt.<save>`: checked disc/shelf addresses and save result.
- `fn.shelfRows` and `fn.shelfQuery`: actual Disc/Mold/art bindings + explicit
  request → filtered rows and manufacturer/mold groups. Plastic then descending
  weight orders physical copies; nicknames are excluded from querying.
- `fn.createBag` and `fn.addReference`: checked physical-disc selection → Bag
  and a new Bag collection. `model.ts` exposes `queryShelf`, `createBag`,
  `updateDepiction`, and `keepDisc`.

The existing Part-first kernel is imported unchanged. Its actual composition
receipts retain input Parts; `window.discStudio.pxc.receipts()` exposes them.
The view's current shelf-address pointer selects the latest produced Shelf;
there is no competing collection of saved discs in UI state. A shared view
helper renders draft and saved discs. UI rendering is not yet a kernel Calculation.

To inspect saves: expand the receipt panel, inspect the console, or run
`node server.mjs | tee /tmp/discstudio-save.log`, then
`grep '"event":"disc.save.completed"' /tmp/discstudio-save.log`.
The terminal receives diagnostic copies; authoritative session receipts live in PxC.
Photo bytes are not included in receipt logs. Tests: `node --test model.test.ts`.

// {?} Replace/extend the painting catalog with Sam's incoming painted assets.
// {?} Keep manufacturer as a string until an experience needs metadata.

The three initial paintings and all six painter modules now live here; both
`generate-art.mjs` and live rendering use `vendor/painter`. No sibling checkout
is required to run the app. [Asset origins and exact hashes](IMPORTED-ASSETS.md).
The old `fn.renderPainting` remains available for replaying earlier archives.

Run the local app checks with `node --test --test-concurrency=1 *.test.ts devtools.test.mjs`.
The Part-first kernel remains experimental. This working checkpoint is not
promotion or acceptance of new product behavior.
