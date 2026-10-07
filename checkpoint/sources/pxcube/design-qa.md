# UploadDiscToShelf photo-first crop verification

final result: passed

Source visual truth:
`/var/folders/mb/6ckfqq2n1rv3jrlqqvcrj39m0000gn/T/codex-clipboard-f10d57ce-95c8-4902-89a4-9a0fc7927e78.png`
(1290 × 2796) and
`/var/folders/mb/6ckfqq2n1rv3jrlqqvcrj39m0000gn/T/codex-clipboard-9895fba1-d994-4fd3-b917-9c898d472304.jpg`
(1290 × 2796). These are browser-framed product annotations, so they define the
mobile hierarchy and photo treatment rather than a pixel-identical crop-editor
layout.

Implementation: `http://127.0.0.1:4340/`, built by crisp and captured in the
Codex in-app Browser at a 390 × 844 CSS viewport, device scale 1. The Browser
API returned the implementation screenshots inline and does not expose a local
file path for those bytes. State: MVP · Servo selected; first the crop dialog
with a landscape JPEG, then the applied Photo depiction. Both source references
and both rendered states were opened and visually compared during this pass.

Full-view comparison evidence: the requested order is now manufacturer + mold,
flight summary, `Edit flight numbers (this disc only)`, prominent `Add photo`,
then the persistent live preview. The applied photo is circular and edge-to-edge
without the former mint/orange painting backing. No page-width overflow was
visible at 390 pixels.

Focused-region evidence: the crop sheet was checked separately at 390 × 844.
Its circle, left/right, up/down, zoom, width, height, Reset, Cancel, and Use photo
controls all fit inside the viewport. Cancel returned to the painted Servo and
kept Photo unavailable; Use photo returned to the Servo preview, selected Photo,
and enabled later Painting/Photo switching. Console errors and warnings: none.

Findings and iteration:

1. P1 — the provisional implementation exposed stretch but no positioning and
   exported an unmasked square. Added bounded x/y crop placement, a circular
   canvas clip, accessible labels, reset/cancel behavior, and mobile dialog
   styling. Post-fix evidence is the crop and applied-photo browser captures
   described above. No remaining P0/P1/P2 finding.
2. P2 — photo rendering inherited the decorative painting padding/background.
   Added a photo-specific view class that removes that backing in preview,
   shelf cards, and the held-disc inspector. The applied-photo capture shows the
   corrected edge-to-edge circle.

Required surfaces:

- Typography: existing system type, weights, and hierarchy are retained; crop
  labels remain readable and do not collide at phone width.
- Spacing/layout: the modal has bounded width/height and reachable actions; the
  top upload control aligns to the form width; no horizontal overflow observed.
- Colors/tokens: existing paper, forest, muted green, focus orange, radii, and
  shadow language are reused.
- Image quality: output is cover-cropped, clipped to a true circle, capped at
  1024 px, encoded once, and rendered without the painting rim. The original
  file remains untouched.
- Copy/content: flight disclosure is `Edit flight numbers (this disc only)`;
  `Add photo`, `Fit the disc`, `Cancel`, and `Use photo` make the branch explicit.

Primary interactions tested: fuzzy mold selection and nickname autofill; photo
picker; crop position/stretch adjustment; Cancel preservation; Use photo
auto-switch; circular no-rim preview. Deterministic geometry tests cover
portrait, landscape, square, bounded movement, stretch/zoom, and invalid sizes.

---

# NTC shell verification

final result: passed

Source visual: `/Users/samuelmahan/Desktop/Screenshot 2026-09-14 at 1.23.11 PM.png`
(1102 × 1068 pixels). This is the prior launcher Sam asked to extend with an NTC
layer above its sandboxes, not a pixel-identical target. The crop's original CSS
viewport and density are unknown; no font-size equivalence is inferred from it.

Implementation captures: `evidence/ntc-console/reference-width.png` at 1102 ×
1068 CSS pixels / device scale 1; `experience.png` and `mounts.png` at 1440 × 1000;
`mobile.png` at 390 × 844. All are real headless Chrome captures. The source,
reference-width overview, active Experience, and mobile capture were opened
together in one comparison input. The corrected Experience and Mounts captures
were subsequently opened for the focused state review.

Intentional change: cards now sit inside an NTC workspace rather than being the
entire workspace. The sidebar, artifact header, and work/manifest/build strip
remain visible around an active Experience. The original Experience content,
manifest data, and retained frame behavior are reused.

Findings and iteration:

1. P2 — The first active-Experience screenshot briefly labelled its sidebar row
   “Opened · retained.” A two-second status refresh caused the mismatch. Labels
   now update synchronously when changing views. The follow-up browser assertion
   checks “in view” immediately after opening; the recaptured Experience shows
   the correct state. No remaining P0/P1/P2 finding.

Required surfaces:

- Typography: existing system-font approach retained. Hierarchy now separates
  the operator layer, resource title, and embedded Experience. Smaller metadata
  remains readable in the focused screenshots; long manifest values wrap.
- Layout: NTC controls stay outside the iframe; the runtime uses the remaining
  viewport with its own scroll. On narrow screens the sidebar becomes a top
  navigation row. No page-width overflow at 390 pixels; all control views remain
  available. The large source screenshot's two-column card layout intentionally
  becomes a denser resource view to make room for the requested control layer.
- Color: the existing dark/mint palette is retained, with distinguishable shell
  and runtime backgrounds. Build failures have explicit text as well as color.
- Images: no new decorative images or icons are needed for this control layer.
  Existing Experience imagery remains within its original frame.
- Copy: packaged, opened, in-view, retained and unavailable are distinct. The
  header labels its commit as HEAD; the artifact is separately named. No fake
  runtime CPU metrics, process controls or browser build action is presented.

Interaction evidence: `evidence/ntc-console/browser-results.json` compares
visible work/manifest/build inspectors with the actual embedded snapshot, and
compares owner inspection with the same live owning object used by the frame.
An identity witness and saved draft survive every control-view switch. Mounts
come from the owner API, test iterations are visible, Escape closes the
inspector, and a newer-build offer preserves the loaded artifact and context.
The same test also passes in the isolated fixture mode configured for CI.
Console errors: none in those runs.

No additional visual assets or region crops were needed: the full captures and
focused Experience/Mounts captures make the controls and their state readable.

Remaining scope: this is the NTC inspection and context-management surface.
Build execution is still invoked through the shared Node program. Hidden frames
are retained, not paused. These limits are documented in `docs/ntc-console.md`.
