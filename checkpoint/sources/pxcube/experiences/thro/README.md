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
provenance})` snapshots the committed raw archive into
`thro-workspace-package@1`. The required identity contains explicit `sourceId`,
`artifactId` and `nativeRendererBuild`; the caller supplies the expected build
identity, not an account assertion. Pending work, a failed draft or a conflict
returns `THRO_PACKAGE_BUSY`. The payload is uncompressed UTF-8 with exact byte
count and SHA-256; JSON-only metadata is limited to 64 KiB and raw archive data
to the existing 64 MiB cap. The envelope's `version` is `1`, and `archive` has
`encoding`, `byteLength`, `sha256` and `raw` fields.

`adoptWorkspacePackage({storage,locks,key,package,expectedIdentity,renderGraphic})`
from `workspace-package.mjs` validates in disposable memory before installing
into a held-empty `thro` namespace. It checks the closed tagged archive format,
known Calculation references, bounded media carriers, frozen graph replay,
owning shelf/bag/context/capture links and regenerated deterministic legacy
graphics. Imported or unbound captures are unsupported. Native captures retain
their saved PNG pixels without repainting on the recipient. Their exact pinned
single-image carrier, PNG header dimensions, owning source facts, prepared-photo
hash, build, preset, appearance and bounded placement metadata are checked.
This does not independently prove the saved pixels' visual placement or curator
authenticity. Node tests use a clearly labelled synthetic producer and do not
establish native browser pixels.
Raster checks cover the supported encoded carriers and basic container headers,
not a general image decoder. SVG checks deliberately reject unsupported active
or external generated material; this is not a general untrusted SVG sanitizer.
The final write uses the existing exclusive lock, empty-value comparison and
readback. Occupied namespaces are never merged or replaced, and uncertain writes
are never rolled back. Hashes and provenance do not authenticate the curator.

No package upload/download UI, auth service, account claim, remote storage or
player publication is added. The three-disc fixture loader remains unchanged.
Focused package tests live outside the Experience because their adversarial
fixtures intentionally name the legacy dependency namespace:

```sh
node --test ../../local/test/thro-workspace-curation.test.mjs ../../local/test/thro-workspace-package.test.mjs
```

For a receipt-bound isolated runtime, set `THRO_PACKAGE_RUNTIME` to that exact
compiled thro directory instead of using the standalone build's `dist`.

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
