# thro Experience

This additive PageRouter Experience prepares a fixture shelf for making video
graphics. Its effective manifest is registered as `pxcube-thro` in
`../../.tidy/manifest.json`. PageRouter assembles the freshly compiled package
as the independent `thro` project, with `#/thro/run` and
`compiled/thro/index.html` entry points.

Run `node build.mjs` from this directory when all runtime and fixture files are
present. The adapter first requires the authored entry point, workspace modules,
`prepared-fixture.json`, and a nonempty `assets/discs` image directory. It then
runs the existing `local/studio-demo/build.mjs` builder unchanged, retaining its
complete Studio, renderer, and shared dependency copy set. Finally it overlays
the thro runtime and prepared fixture files into this Experience's ignored
`dist/` directory. Tests are not copied into that runtime overlay.

The shelf is fixture-only and persistence is browser-local. Hosted auth,
accounts, shared storage, player-page publication, and live click tracking are
not implemented by this mount. A working local fixture does not establish
novice usability, human acceptance, or production readiness.

The owning workspace now exposes `saveDisc(draft, depiction, sources)` for a
future curator view. Inputs are copied before queueing; the existing Disc save
runs on a disposable candidate, and the owning model advances only after the
locked archive flush succeeds. Calling `workspace.model.experience.save()`
directly bypasses this boundary. No curator controls are added by this change.

After `await workspace.settled()`, `workspace.exportPackage({identity,
provenance})` exports `thro-workspace-package@2`. `identity` records the producer's
`sourceId`, `artifactId` and `nativeRendererBuild`; those app hashes are provenance,
not recipient compatibility gates or account assertions. The envelope separates
`compatibility: {dataSchema,editProfile,requiredCapabilities}`, `origin`, optional
JSON `extensions`, and the existing uncompressed UTF-8 `archive` containing raw,
byteLength and SHA-256. The `integrity` SHA-256 additionally covers canonical
sorted-object-key JSON of schema/version/compatibility/origin/extensions and
archive encoding/byteLength/sha256, excluding archive.raw and integrity itself.
This detects metadata alteration but is not a signature. The current contracts are `thro-workspace-state@1` and
`thro-prepared-workspace@1`. Requirements are derived from the retained content;
omitting one fails validation. Actual native design build/preset pairs are derived editing requirements; the
producer's rendererBuild provenance alone does not select editing support.
Unknown required capabilities, profiles or
Calculation ABIs refuse editable adoption. No future migration is implied.

`inspectWorkspacePackage({package,legacyProfile})` from `workspace-package.mjs`
performs read-only static inspection. Its separate `archive-inspection.mjs`
implementation imports no model, restore function, renderer or DOM. It verifies
bytes and the bounded tagged graph, and exposes declared kept SVG/native PNG
carriers only after their hashes and archived source bindings agree. This is
archived consistency, not curator authentication. The report's `editable` field means static eligibility only; full replay and
semantic validation occur at adoption. Supported frozen assets remain
inspectable when an edit profile is unknown. Unknown data schemas are reported
unsupported without trying to interpret their payload. Retain the original
package for unsupported formats; no partial editable graph is installed.

The delivered `thro-workspace-package@1` has an explicit reader policy:
`legacyProfile: 'thro-delivered-workspace-v1@1'`. It maps the known v1 data/recipe
profile for the verified delivered sourceId `efb93ae994ed5316e946302a6cdba1bb64669223ed3a953cbb468226f9da8911`
and artifactId `865250c1941bc52319e42c03a59501b9ad892c74545de5f4ed84a158be53eef2`,
not the recipient's app SHA. Other v1 producers stay inspectable but are not
automatically assigned editable compatibility. The original v1 input is not relabelled.
After adoption a new v2 export records the original identity/provenance. Legacy
captures contain saved SVG; original PNG export bytes were not stored. A later
PNG conversion cannot be claimed as the original exported PNG. Native captures
contain their saved PNG within the exact supported single-image SVG carrier;
inspection and adoption preserve those pixels without repainting.

`adoptWorkspacePackage({storage,locks,key,package,legacyProfile,renderGraphic})`
repeats inspection on an immutable input snapshot, then validates the complete
known editable world in disposable memory: known Calculations, bounded media,
frozen graph replay, shelf/bag/context links and deterministic legacy rendering.
Native request/provenance checks do not repaint retained saved PNGs. Imported or
unbound captures remain unsupported. There is no generic untrusted SVG sanitizer
or full image decoder; the closed carriers, hashes and basic image headers are
checked. JSON metadata is limited to 64 KiB and raw graph to 64 MiB.

Installation still uses the exclusive lock, held-empty comparison and readback.
Occupied namespaces are never merged or replaced; uncertain writes are never
rolled back. A per-workspace codec stores retained `origin` and unknown optional
`extensions` atomically with the graph in one `thro-workspace-cell@2` storage
value. Edits/reload/re-export preserve them. Existing unwrapped storage remains
readable. An older runtime does not understand a v2 cell and fails without
rewriting it. New exports from a transferred workspace preserve the imported
origin rather than claiming a new origin from supplied app identity options.

No package upload/download UI, auth service, account claim, remote storage or
player publication is added. The three-disc fixture loader remains unchanged.
Focused package tests live outside the Experience because their adversarial
fixtures intentionally name the legacy dependency namespace:

```sh
node --test ../../local/test/thro-workspace-curation.test.mjs ../../local/test/thro-workspace-package.test.mjs ../../local/test/thro-transfer-contracts.test.mjs
```

For a receipt-bound isolated runtime, set `THRO_PACKAGE_RUNTIME` to that exact
compiled thro directory instead of using the standalone build's `dist`.
The transfer test generates a self-contained historical-format fixture by default;
`THRO_V1_EXAMPLE` optionally points to an actual previously delivered v1 file.

The canonical PageRouter build remains `bash ci/bazel/run.sh` from `checkpoint/`
on Linux x86_64 with Node 24.19.0, Python 3, npm, and Bazel 7.4.1. At this
implementation checkpoint, those exact tools are installed user-locally in
Ubuntu. The canonical invocation prepares the integrity-pinned lockfile
dependencies with lifecycle scripts disabled. A standalone Experience build
does not replace canonical verification.

Focused checks after `node build.mjs`:

```
node --test locked-storage.test.mjs archive-codec.test.mjs workspace.test.mjs
node --test ../../local/test/thro-native-cards.test.mjs ../../local/studio-demo/native-dispatch.test.mjs
```

From the PxCube source root, `node --test local/test/affected-targets.test.mjs`
checks typed registration and complete shared dependency invalidation. The
aggregate test list also includes `scripts/thro-built.test.mjs`, which requires
fresh assembled output and verifies the independent catalog mount, exact
snapshot/package bytes, local module closure, fixture photos and build identity.

The new storage namespace uses an exclusive browser Web Lock. A scratch owning
model is promoted only after its archive is confirmed saved. A stale or failed
save retains pending intent separately; explicit reload returns that recovery
without merging it. Initial opening fails safely when Web Locks are unavailable.
The archive codec interns repeated exact string tokens outside the vendor format
and reconstructs the original raw archive bytes. It preserves every Part; local
storage remains finite and a 64 MiB raw-data limit applies.

Runtime build identity is in `dist/BUILD_INFO.json`. It identifies the generated
Experience artifact, not a verified canonical PageRouter deployment. Fixture
photo hashes and preparation geometry are in `prepared-fixture.json`; visual
acceptance remains pending. The historical standalone 6.6.0 source is unchanged.

A failed image conversion retains its capture and displays a retry notice after
reload. Retry uses that exact capture even if the current preview has changed.
Implicit downloads reuse the latest capture with the same physical disc or
lineup origin, design, and SVG bytes. Explicit Keep creates another version.
Browser download cancellation cannot be observed by this page; export receipts
record prepared bytes, and the UI says only that a download was requested.

Single also offers the pinned DiscStudio 6.6.1 native card layouts. The native
browser renderer is imported only for a `discstudio:<preset>` study. Its exact
prepared-photo pixels travel in a self-contained PNG-backed SVG, with physical
disc/version, requested-design, resolved-fact and renderer-build provenance.
The prepared-photo hash identifies decoded file bytes, matching fixture assets.
The PNG Blob remains transient; captured material contains only plain data.
The SVG download is labeled as an image because its card content is raster.

Native layout selection sets the correct portrait or landscape canvas. Native
size changes retain the renderer's authored anchor. Battle and Bag continue
through the existing lineup renderer; mode changes keep separate Single and
legacy designs and restore the Single choice when returning. Native rendering
is checked in the candidate model before a changed native design, disc choice
or mode can commit, so a failed render cannot replace the last valid archive.
Changing native layout uses that layout's own side/highlight defaults while
keeping size and accent intent. Editing controls within one layout retains
the explicitly selected side and highlight.
