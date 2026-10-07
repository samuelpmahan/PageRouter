# Two imported Studio sandboxes

Source: PnC `6f7937bc1eebd22bf3135f50c9edf714b122902a`, pinned per file in
`vendor/studio/SOURCE.json`. Destination: PxCube `codex/local-pages`.

`packaging.json` records the actual tested build, app/output hashes and shared
dependency hashes. All four apps packaged. Each imported app also ships
`studio-import.json`, with the pinned source hashes, compiler/patch description,
and explicit legacy namespace scan. Source PnC was not edited or switched.

`browser-results.json` contains 15 groups of assertions over the final artifact:
both real local serving and a plain static `/PxCube/` project prefix, plus a
runtime request audit. No page errors. No remote service, original Studio server,
or event POST was needed. The existing launcher regression is recorded separately.

The new mount/storage tests and prior mount-owner tests passed (7 tests). The
existing crisp/pipeline checks passed (9, including fixture subtests). The pinned
Experience, persistence, and Case tests passed (12). These are execution checks,
not a human usability verdict or tidy promotion.

The first browser probe exposed a genuine integration error: HTML form submission
was disabled by the iframe sandbox. Both parent and child Experience frames now
explicitly allow forms, so the existing submit handlers run. The test harness also
initially used an incorrect search selector (`fs-filter` rather than `fs-query`);
the retained failure report records that harness mistake, not a Shelf search bug.

The shopping prototype stays a plain-object model. Its inspectable bridge reads
the actual closure values. The live Part surfaces keep their original store,
Calculations, Part identity and composition links. Studio's internal `ds.px.*`
archive remains unchanged; the public mount handle translates at the boundary.
This does not claim full adoption of MockPxC's persistence convention.

Interactive domain saves survive full reload. Numbered tests preserve observations
for read-only review after reload rather than pretending to resume their cursor.
Unsaved interactive forms/previews retain the original application's lifetime.
Source hashes and local browser evidence are not a GitHub Actions deployment.
