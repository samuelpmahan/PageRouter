# Experience consumer handoff for Muse

The existing local-pages branch now has three minimal candidates: BuildBag,
CreateGraphics, ExportGraphics. Sam has not reviewed or promoted them.

- Tidy definitions live in `.tidy/manifest.json`; each Experience root is a
  tidy pointer plus its build entry. They use the existing discovery/package path.
- `local/studio-demo/` is their shared consumer, not new neat/tidy/crisp machinery.
- `local/build-studio.mjs` accepts an optional resolved config, so a consumer can
  use tidy's supplied manifest. Its original callers and default behavior remain.
- Studio's existing Part/store, Bag operations, shelf query, archive and replay
  are reused unchanged. `vendor/studio/SOURCE.json` and its pinned bytes are untouched.
- `vendor/studio-renderer/SOURCE.json` retains 14 unchanged renderer dependencies
  from DiscStudio commit 455f66db91fc34ac0d8d32b66aa6ccbef224b774. Build verifies hashes.
- `archive-storage.mjs` gzip-encodes the complete existing archive with native
  browser streams. It does not define a new replay format or omit large values.
  This was required after a real storage-quota failure; exact byte round-trip is tested.
- Cross-Experience handoff is an explicit captured-graphic offer, never a shared
  mutable store. Numbered tests cannot publish offers into the interactive mailbox.
- SVG preview and export share actual bytes. PNG/download are browser effects;
  measured outcomes enter Parts and a pure record Calculation bound to the capture.
- `local/test/demo-experiences.test.mjs` packages a fresh temporary tree itself;
  it works in the existing unit-test glob before any local build exists.
- `local/test/demo-experiences-browser.mjs` expects a running built site, as configured
  with PXCUBE_BASE_URL; PLAYWRIGHT_MODULE and CHROME_BIN work like the other tests.
  It has been run locally; no new workflow logic was added on the tooling side.

Original BuildBag scaffold bytes are retained in `experiences/build-bag/scaffold-origin/`.
Review contract and evidence: `docs/demo-experiences-m.md`, `evidence/demo-experiences-m/`.
