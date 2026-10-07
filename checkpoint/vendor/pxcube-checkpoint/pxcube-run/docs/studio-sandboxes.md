# Studio Experience import

Claim: import UploadDiscToShelf and ExploreShelf from the committed PnC snapshot
6f7937bc into PxCube, on codex/local-pages. The source checkout stays untouched.
This is an Exp integration candidate, not human acceptance or promotion.

## Contract

- UploadDiscToShelf opens the existing paint/photo composer. Painting needs no photo.
- ExploreShelf opens Sam's accepted 50-disc shopping prototype. The existing
  three-disc live Part edit loop is a separately labelled surface in that sandbox.
- Interactive mounts are `mock.upload-disc-to-shelf` and `mock.explore-shelf`.
  Numbered mounts are fresh tests. Opening another run never resets an older one.
- Each live surface owns its original model in a separate iframe. Inspection reads
  that exact model. A mounted Part handle returns the original Part, including its
  composition links; it does not manufacture a JSON substitute.
- Internal Studio names remain `ds.px.*`, `fn.*`, and `oc.*`. The handle translates
  mounted `px.*` to internal `ds.px.*`. This compatibility boundary is explicit;
  these sources are not claimed to satisfy the new unprefixed persistence contract.
- Interactive domain saves use the existing composition archive and replay check,
  in storage scoped by mount and surface. Shopping retains its actual UI model.
  Numbered runs retain observations for read-only review after a page reload;
  their action cursor is not reconstructed. Start another iterator to execute again.
- Same-origin trusted frames isolate context and storage by convention and checks;
  they are not an adversarial code security boundary.

## P&C before implementation

The imported model owns Disc, mold, recipe, depiction, shelf, and Bag Parts and the
existing Calculations that produce them. This adapter introduces no domain
Calculations. The mount registry owns identity, kind, iterator, seed identity and
surface selection as JSON metadata. The host owns allocation, persistence,
inspection, and retained observations. The accepted shopping prototype's plain
objects remain plain objects, explicitly identified in inspection.

`vendor/studio/SOURCE.json` pins every imported byte. Builds verify those hashes,
strip TypeScript, and record the small entry/lifecycle patches and compatibility
scan in `studio-import.json`. Muse's crisp still packages the host. The additional
vendor scan reports legacy namespace uses and persistence findings separately;
a successful package does not assert that the legacy model is fully MockPxC.

## Running and inspecting

Run `node local/run.mjs dev` with Node 24, then open the launcher on port 4321.
Choose either Experience. Surface selects the shopping or live Part view on
ExploreShelf; Session returns to an existing mount. New test run allocates a fresh
iterator from the selected surface's fixture. The live Part surfaces expose the
imported visible Cases only in numbered runs. The shopping surface can be operated
manually in a numbered run; browser verification also drives its actual controls.

Inspect this sandbox reads the visible frame's model. The mounted address lookup
returns original Part objects for live views, and original objects for shopping.
The imported PxC DevTools remain connected to that same live store. Interactive
paint selection uses the existing picker; numbered Cases use the fixed picker.
Painting recipes retain the selected family and seed. No photo is required.

Examples: `mock.upload-disc-to-shelf.px.shelf.0` resolves to the owning store's
initial shelf Part. Shopping exposes `mock.explore-shelf.px.shelf`, `.px.ui`,
`.px.settings`, and `.px.bags`. The inspection lists current live Part addresses.
The two Shelf surfaces are separate models, not automatically synchronized.

The launcher retains frames on Back. Full reload restores interactive domain
saves using Studio's original archive/replay implementation. Unsaved forms,
previews and transient DevTools edits have the source application's existing
lifetime; they are not claimed to survive a full reload. Numbered test observations
remain read-only after reload, preserving their original iterator and source.

Forms, downloads and modal dialogs are explicitly enabled for these trusted
frames. Data storage is scoped to each mount and surface; the original Studio
storage key is never written. Failed archive writes and stale writers report an
error and preserve the earlier stored bytes. There is no automatic pruning.

## Verification

`node --test local/test/*.test.mjs` checks the local adapter and crisp fixtures.
The pinned source also includes its existing Experience, persistence and Case
tests. `node local/test/studio-browser.mjs` needs Playwright and Chromium (optional
`PLAYWRIGHT_MODULE` and `CHROME_BIN` select an installed runtime). It checks actual
controls, Part identity, separate seeds, search and grouping, bag creation, Back,
reload, retained observations, untouched original storage, local-only requests,
and the same static artifact under a `/PxCube/` prefix. This is local evidence,
not a GitHub Actions run. Evidence lives in `evidence/studio-sandboxes/`.
