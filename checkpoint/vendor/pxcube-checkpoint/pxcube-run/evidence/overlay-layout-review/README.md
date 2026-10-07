# Corner overlay correction

Sam: “It’s also supposed to be small and in the corner of the video.”

1. Before — wrong composition. The supplied screenshot (`01-before.png`)
   shows a centered portrait card on a filled landscape canvas. Its name plaque
   and nickname placeholder also belong to an earlier retained capture.
2. After — compact corner overlay. `corner-overlay.svg` is the real composed
   1920 × 1080 output. Card bounds: 60, 776, 620, 244; 7.30% of the canvas.
   The background outside the panel is transparent. Maker/mold lead; the disc
   has no name plaque. Corner choice is a design Part consumed by canvasScene.
3. Export — verified. `corner-overlay.png` was downloaded using ExportGraphics,
   then read back: 1920 × 1080; 1,925,936 / 2,073,600 pixels fully transparent.
   See `png-check.json` for the byte hash and occupied alpha bounds.

`layout-checks.json`: all four corners in both orientations, 60 px insets,
no layout warnings, and identical captured-value replay after archive restore.
The existing four packaged demo tests pass. Saved old captures stay unchanged;
new example/import actions select the new capture, and old layouts are labeled.

The new preset remains data passed through cardsEffective, cardsApply,
composeCard, composeFrame, composeOverlay and materializeOverlay. Prior named
Calculations remain available for archive replay. Static flight labels are
bound fields too: anonymous static nodes produced undefined field material,
which the archive correctly refused. No record-writer bypass was introduced.

Visibility limits: the labels and panel were inspected at the exported size;
legibility over actual moving footage still needs Sam’s review. This is not a
claim of full accessibility conformance or a live video compositing feature.
