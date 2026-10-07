# Minimal Experience review

Open the local NTC shell at http://127.0.0.1:4321/ and reload the offered build.
All three neat items are **review**, with no acceptance or promotion recorded.

1. BuildBag: select copies; move a selection up/down; name/create the bag. Clear
   a search, open a saved bag, reload, and compare its exact references in Inspect Parts.
2. CreateGraphics: choose a disc; change the Spotlight/Showcase/Lower third design,
   colors and landscape/portrait frame. Keep for ExportGraphics. A new design does
   not change the specimen or previously kept capture.
3. ExportGraphics: Import from CreateGraphics, inspect that capture and download
   PNG/SVG. The separate seeded example lets this Experience work independently.

`browser-results.json` records the actual browser flows. The test reads downloaded
bytes: SVG equals the capture; PNG IHDR dimensions and SHA-256 equal the measured
result. It deliberately fails PNG conversion and verifies retained failure on reload.
Screenshots and the exported PNG remain local (images are gitignored); the exported
SVG, logs and machine-readable results are retained here.

`regression-results.txt`: 25 local adapter tests passed, including explicit negative
packaging cases. Their red fixture builds are intentional test inputs.
`unit-results.txt`: focused semantic checks, full archive compression round-trip,
composition replay, and refusal of stale writers.
Those four focused checks were rerun after tightening capture identity: equal SVG
bytes from distinct source Parts remain separate captures. `ntc-results.txt` and
`ntc/browser-results.json` record all eight control-layer checks passing against
the working BuildBag, including frame identity and retained drafts.

The earlier quota failure is retained as a finding. Compression reduces the seeded
archive from 991,900 to 102,562 characters and preserves every decompressed byte.

Scope: DiscSpotlight first. Competition and ManageBags remain subsequent variations.
The accepted Upload and shopping Shelf surfaces are not replaced by these seeds.
