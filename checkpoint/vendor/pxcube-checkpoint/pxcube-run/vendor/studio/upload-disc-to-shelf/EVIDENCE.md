# First-slice verification

Latest verification: [catalog update](CATALOG.md#fresh-evidence), 44 passing
checks plus browser save/review exercises. Below preserves the earlier run;
its original hashes do not attest the subsequently changed files.

Local PnC checkout: `67fc238512e8d7e9a517fc5b53785fb77e5b6db4`, with
pre-existing unrelated changes preserved. This entire experiment is new,
uncommitted source; the commit is context, not an attestation of these new files.

Node 24.19.0: 40/40 tests passed (6 new experience tests + 34 existing
Part-first/scaler tests). TypeScript 5.9.3 no-emit check of app.ts and model.ts
passed, with the existing JS kernel imported through allowJs. No install.

Actual browser checks:

- Filled nickname Minty, plastic ESP, weight 177 and Color1 #34aa99.
- Saved; ShelfPage displayed Minty with those facts and its original painting,
  while the composer selected a new painting for the next disc.
- Reload confirmed the disclosed session-local boundary (empty shelf).
- Uploaded an existing generated PNG test image through the real file chooser;
  browser prepared it locally, then saved/displayed Photo test on the shelf.
- Photo save receipt appeared in both PxC-facing UI and the server terminal,
  with paintingRef local-photo and no image bytes. No browser errors/warnings
  were reported by the captured browser log check.

Observed terminal receipt for photo save:

```json
{"event":"disc.save.completed","operationId":"save-2","calculation":"ds.px.calc.addToShelf","discAddress":"ds.px.disc.save-2","shelfAddress":"ds.px.shelf.save-2","seedAddress":"ds.px.seed.buzzz","paintingRef":"local-photo","readbackMatched":true,"shelfContainsDisc":true,"storage":"session-memory"}
```

Limitations: no reload persistence, no real-device camera test, no full responsive
audit, no YAML. The preview renderer is a shared TypeScript UI helper, not yet a
PxC Calculation. Art is a generated snapshot of three existing DiscStudio
painters, not newly generated bitmap artwork or a live feed of Sam's art work.
No existing kernel/app files changed. Nothing committed, pushed, or promoted.
