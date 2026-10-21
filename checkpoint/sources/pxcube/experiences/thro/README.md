# thro Experience

This additive PageRouter Experience prepares a fixture shelf for making video
graphics. Its manifest is initially self-contained; shared tidy registration and
PageRouter catalog wiring are separate integration work.

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

The canonical PageRouter build remains `bash ci/bazel/run.sh` from `checkpoint/`
on Linux x86_64 with Node 24.19.0, Python 3, npm, and Bazel 7.4.1. At this
implementation checkpoint, the available Ubuntu environment lacks the required
Node 24.19.0 and Bazel 7.4.1 toolchain, so aggregate canonical verification is
blocked. A standalone Experience build does not replace that verification.

Focused checks after `node build.mjs`:

```
node --test locked-storage.test.mjs archive-codec.test.mjs workspace.test.mjs
```

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
