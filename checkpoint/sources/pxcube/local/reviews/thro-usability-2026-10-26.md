# thro usability review (shop video producer, sponsored creator)

Run on 2026-10-26 with Playwright (Chromium). Sites: iter-56 photos.html and editor.html?bag=photos, thro.pages.dev/editor.html, iter-57 bar.html, thro.pages.dev front page. Screenshots and downloaded PNGs are in this folder. Times are automated (no human reading time); a human needs roughly 2x.
Phone emulation: iPhone 13 (390x664 default viewport; also re-checked at 390x844). Console: zero errors or warnings on every page and both personas.

## Top 10 fixes, ranked by chance a shop producer adopts it this week

1. **Phone: the mold panel collapses to 0 px, so a disc that "needs a mold" is a dead end.**
   Page photos.html, element `aside` (contains "THE DISC", "Mold", `#mold` input). At 390x664 and 390x844 its height is 0 (`aside` y=594, h=0; `#mold` input at y=1073 to 1418, off screen, tap times out). After "Crop this photo" on the Mint tie-dye photo the footer reads "1 of 10 cropped · 0 in your bag · 1 need a mold" and "Make cards →" is `disabled`. The creator cannot finish. Evidence: m7 run output, m6-needsmold-844.png, m2-after-crop.png. Fix: on narrow screens render the disc panel as a normal block below the photo (or a bottom sheet) with the mold field at least 44 px tall and visible on first view after cropping.

2. **There is no way to use your own photo.**
   photos.html is a fixed set of "Ten real phone photos"; the only inputs on the page are the Mold field (no file input, no camera button). A shop cannot try its own five discs. Fix: add a primary "Add disc photos" button (multi-select, phone camera) above the thumbnails; keep the ten as "Try a sample".

3. **The editor ships with developer overlays on desktop.**
   editor.html at 1440x900 (s5-editor.png): green "s1.2 · 100%" and red "s2.6 · 0%" tags on every control and every composition thumbnail, a left panel "Phone page today / 390 × 844 · 3.1 screens · 52 controls / Show the phone page" with a mini wireframe, a floating "DTree 3 open" button that opens a drawer of "EVERY WAY THIS DISC COULD BE A CARD ... world.sum ... polynomial", and a banner "Single card → Bag lineup / Recomputed: lineup recipe, card recipes 1, 2, 3 ..." that sits on top of the preview (s7-prod-baglineup.png). The tags overlap the Side/Colour/Plate pills and the "Download PNG" button. Phone hides the tags but still shows "DTree 3 open" in the header (m4-editor-top.png). Fix: all of it behind `?debug=1`; default build shows only the card and its controls.

4. **Unknown molds silently vanish from the bag.**
   photos.html, Mold field for IMG_6576 (caption "Discmania Cloudbreaker, upside down (not in the mold catalog)") and IMG_6163 ("Custom Dojo Designs dye"): typing "Cloudbreaker", "Cloud" or "Dojo" gives zero suggestions and no free-text escape. On desktop "Make cards →" stays enabled with the footer "8 in your bag · 2 need a mold", and the editor opens with 8 discs; the 2 photos are dropped with no warning (s5-editor.png lists 8). Fix: let the producer type a name plus four flight numbers ("Use 'Cloudbreaker' as typed"), and when Make cards is pressed with unresolved discs say "2 discs will be left out: Cloudbreaker, Dojo Designs" with a "Name them" button.

5. **Five discs means five rounds of select, download, with 1920x1080 files that are 70 percent empty.**
   editor.html: "Bag lineup" caps at "2–4" discs ("Choose 2–4 exact copies"), so a 5-disc review needs 5 single cards, 2 clicks each (pick disc, "Download PNG ↓"). Every file is 1920x1080 RGBA with the card only in the bottom-left 577x399 px (alpha bbox 48,633 to 625,1032 in all five files). Fix: "Download all 5" (zip or sequential), a "Tight crop" option for CapCut users, and a note that the full-frame file is meant to sit on a track.

6. **photos.html shows the engineering, not the result.**
   "HOW THE CROP HAPPENS", "Find the rim, roughly / colour bands on 72 rays, 8 octants vote", "REGISTERED CALCULATIONS THAT RAN / thro/crop/live PASS / G1_LivePriorBounds · 1/1 in bounds", pills "found in 551 ms, in this browser" and "off Argon's own run by 0.35% of the radius", uppercase micro-captions, and a raw "IMG_6165 · 1200×1600" label. The actual unwarped cutout appears only as a 120 px circle under "THE DISC" with the words "Cropped. Which mold is it?"; the big view still shows the raw photo (s2-allcropped.png, s3-thumb0.png where an iOS crop screenshot ghosts behind the disc). Also the caption "Westside Stag, white with gold stamp (a screenshot of the iOS crop screen)" is test-fixture text a visitor sees. Fix: show the cutout large with a "Looks right / Redo rim" choice; move the diagnostics to `?debug=1`; drop the caption note.

7. **"Crop all 10" takes about 28 s with no progress bar.**
   Measured 28.3 s for 10 photos (3 s per photo), then the page loads only a footer count ("3 of 10 cropped · 1 in your bag · 2 need a mold"). The button label stays "Crop all 10" the whole time, and the panel still says "Not cropped yet." beside a stale disc. Fix: progress bar "Cropping 4 of 10" on the button itself, show each finished cutout as it lands in its thumbnail, replace "raw / in bag / needs mold" badges with a plain check and a "Name it" prompt.

8. **The default card is smaller and plainer than it should be for a video.**
   Downloaded PNGs (c-sheet.jpg): disc diameter about 280 px on a 1920 px frame (14.6 percent of width), no brand anywhere on the card (Westside, Discraft, Mint Discs, Axiom, MVP are lost; the grey line shows only plastic: "VIP", "Fission", "Neutron"), "ZONE" and "ALPHA" have an empty plastic line so the name floats above a gap, and "3.5" on DEFY fills its tile edge to edge (tiles are fixed width, the "11" and "3.5" crowd them). The disc images are muted (photos shot on a blanket) with a faint pale rim ring and no contrast lift; the Zone disc is a blank purple underside that identifies nothing. Hierarchy (name > numbers) is right and numbers are unlabelled as wanted. Fix: raise the default disc to about 360 px, put brand in the grey line ("MVP · Neutron"; the lineup layout already does this), widen tiles to fit "3.5"/"11", collapse the empty plastic row, add a "Brighten disc" toggle, warn when the photo shows the blank flight plate.

9. **Phone editor: first screen shows no card, and edit handles hide the numbers.**
   m4-editor-top.png at 390x664: header, tab row, disc picker and heading fill the screen; the card preview starts at y≈540 and is covered by the sticky "Keep version / Download PNG / SVG image" bar (y=595 to 643). The user can tap Download before ever seeing the card. When scrolled to it (m5-scroll420.png) the "Side", "# Colour", "Plate" pills and the large red squares/circles (move, size, plate-width knobs, about 26 to 46 px) sit on top of the card and hide the flight numbers ("7 5 -1 2" is behind "# Colour"). The download confirmation is good, but it covers the style grid. Fix: card preview first, directly under the disc name; show handles only after a tap on the card; move Side/Colour/Plate into a row under the preview.

10. **Front page and bar page lead nowhere, and the numbers disagree.**
   thro.pages.dev is only "Which cards would you put on screen?" with checkmark-less circles, "Select all", "Copy feedback"; it has no link to the editor or photos page, so a shop reading it cannot start. iter-57 bar.html has copy such as "Each frame is renderThroBar() over a real tee shot ... every guarantee of thro/card/bar as it ran" and gate rows "G1_ThinBar · 128 px tall ... PASS", no download, no link back. The one-row bar itself is the best-looking lower third (disc only about 44 px though). Data mismatch: MVP Servo is "7 | 5 | -1 | 2" in photos.html and the downloaded PNG, but "6.5 | 5 | -1 | 2" on the production editor lineup, the bar page and the front page cards. Fix: add "Make your own" to the front page, add a PNG download plus a "Make this for my disc" link to the bar page, and make one catalog the single source of flight numbers.

Honourable mentions (not in the ten): editor jargon "RECIPE", "DERIVED", "DEFAULT", "Disc across (× disc size) 0.10", "Disc down (× disc size) -0.14", "Pieces in one row", "Keep version", composition IDs "U03-FRONT · Disc in front"; the right-hand mold suggestion list on desktop is cut off at the window bottom (second option at y>820 hidden, s4-mold-2-Mint.png); the downloaded PNG text renders in a fallback sans (DejaVu-like) that differs from the page's UI font, worth confirming on Mac/Windows; "Crop this photo" wraps to three lines on a phone and sits on top of the disc.

## Persona 1: shop video producer, laptop 1440x900

Goal: PNG card for each of 5 discs in under 3 minutes.

| Step | What happened | Actions | Elapsed (automated) |
|---|---|---|---|
| 1 Open photos.html | Loads in 3.3 s (redirect to /photos). Left strip of thumbnails, big raw photo, right column of diagnostics. Button "Crop this photo" and "Crop all 10" sit on the photo's bottom edge. Footer "10 photos, none cropped yet." "Make cards →" is greyed. | 0 | 3 s |
| 2 "Crop all 10" | 28 s. Footer counts up; right panel keeps saying "Not cropped yet." for the selected photo until it finishes. 6 in bag, 4 "needs mold" | 1 | 31 s |
| 3 Fix molds | Four discs flagged. Zone and Alpha accepted from a guess (thumbnail, type, pick = 3 clicks each, 6 total). Cloudbreaker and Dojo Designs cannot be named (no match, no free text). | 6 | 36 s |
| 4 "Make cards →" | Opens editor.html?bag=photos; first view says "Getting your discs ready." / "Your prepared workspace is opening."; ready after about 3 more seconds. 8 discs, not 10, with no warning. | 1 (total 8) | 39 s |
| 5 First card | Disc "Westside Stag" is preselected, card already drawn. "Download PNG ↓" at y=829 is visible without scrolling. First PNG downloaded after 2 more actions. | 10 | **43 s to first PNG** |
| 6 Cards 2 to 5 | Click disc in the picker (list scrolls inside its own box, 4 of 8 visible), click Download. About 2.4 s each. | 18 | 53 s for 5 PNGs |

**Time-to-first-card:** about 39 s to see a card in the editor, 43 s to the first file (automated). **Clicks:** 8 to reach the editor, 10 to the first PNG, 18 for five PNGs. A human reading the mold list and the diagnostics column: plausibly 2 to 3 minutes; the 3-minute goal is borderline and only met because the sample photos need no upload.
**Downloads:** all five worked: `thro-westside-stag-1920x1080-21421322.png`, `thro-discraft-zone-...`, `thro-mint-discs-alpha-...`, `thro-axiom-defy-...`, `thro-mvp-servo-...`; each 1920x1080 RGBA, transparent, 150 to 190 KB (dl-producer/). No download dialog or toast was needed to find them. 

Hesitation points:
- First screen: nothing says "upload". The page title "Your photos, cropped while you watch" and the instruction "Tap one: the page finds the rim, fits it, and unwarps the disc" are about the demo, not the task.
- "Crop this photo" vs "Crop all 10": which is the main button? The first is lime, the second dark ghost; after crop-all the first button disappears.
- Mold field is below the diagnostics (y=740 to 795 on a 900 px window) and the suggestion list is cut off (y=803 and beyond).
- Jargon: "Mold" (fine for disc golfers), "Argon's own run", "octants", "G4_NearArgonWitness".
- Editor: the three modes "Single / Battle / Bag lineup" are unexplained (Battle = two discs head to head, never previewed by me; bag lineup 2 to 4).
- 11 composition thumbnails labelled "B01 · Hero rail ... U05 · Glass drawer" are tiny (about 90 px) and tagged with debug badges on the iter-56 build. The default "B01 · Hero rail" is a reasonable choice.
- "Keep version" and "Kept graphics 0 / Exact saved versions" are unclear (is it saving? is it required before download? no).
- Left rail "Phone page today ... 52 controls" and "DTree 3 open" read as someone else's workspace.

## Persona 2: sponsored creator, iPhone 13

Goal: one good card for today's disc, save it.

| Step | What happened | Taps | Elapsed |
|---|---|---|---|
| 1 Open photos.html | 3.1 s. Title, paragraph, thumbnail strip (4 visible, swipe), big photo with the two crop buttons over the disc, sticky footer with "Make cards →". Disc panel not reachable. | 0 | 3 s |
| 2 "Crop this photo" (button text wraps to 3 lines) | Servo photo preselected; 6 s to finish. Footer: "1 of 10 cropped · 1 in your bag" (mold auto-matched to MVP Servo). Result drawn full-width; the pills "found in 486 ms, in this browser" and "off Argon's own run by 0.51% of the radius" wrap over the disc. | 1 | 9 s |
| 3 "Make cards →" | Editor in 8 s; no overlays on phone but "DTree 3 open" in the header. | 2 | 17 s |
| 4 Download | Sticky bar shows "Download PNG ↓" on the very first screen (y=595, 48 px high). Tap gives a green toast "Downloaded PNG · 1920 × 1080 / thro-mvp-servo-1920x1080-cd9a1f79.png Drop it on the track above your footage; the checkerboard areas stay see-through." | 3 | **17 s to PNG** |

**Time-to-first-card:** about 17 s to a downloaded file with the preselected Servo (automated); 3 taps. That path hides every problem: it uses the one disc whose mold auto-matched and the user never saw the card. With a disc that needs a mold (tested on IMG_6162, tie-dye) the creator is stuck: 0 taps can reach the mold field, and "Make cards" is disabled (fix 1).
**Download:** worked; file `dl-phone/thro-mvp-servo-1920x1080-cd9a1f79.png`, 1920x1080 RGBA. On a real iPhone a PNG download lands in Files, not Photos, which then needs another step to reach CapCut; the toast does not say where the file went.

Hesitation points:
- No upload; creator wants their own disc.
- After cropping, the creator sees mostly a raw photo with a ring, not the finished cutout.
- On the editor's first screen: no card visible (fix 9); the sticky bar overlaps the lower preview and the style grid, and the horizontal 26 px stepper "−/+" buttons (y=950 to 1249) are below the 44 px touch size (Apple guideline).
- Editing handles (red knob 46 px tall at x=305, pills "Side", "Colour", "Plate" cut off at the left edge: "Plate" pill x=9) hide numbers.
- Page is about 2862 px tall (3.1 screens, 52 controls); the style controls (composition grid at y=1614, accent colours at y=2354) are far down.

## Card design review (picky designer)

- Hierarchy: disc image (about 280 px circle) is not clearly the first thing; the bold white name ("STAG" about 104 px) wins. Order disc, name, numbers is not honoured; name beats disc on the default B01 Hero rail.
- Distortion: unwarped discs are round, no stretching seen; edges have a light ring (about 6 px) that reads as a sticker outline, fine. Source quality limits it: Zone is a featureless underside, Servo is dim, Defy has a dark ring leaking at the lower edge.
- Flight numbers: four unlabelled lime digits in dark tiles, as intended. Good.
- 2023 SaaS slop on the tool (not the card): nested bordered boxes in the picker and recipe rows, uppercase micro-captions with wide tracking ("STEP 1 · PICK", "ON THE CARD", "RECIPE", "THE DISC"), lime "in bag"/"needs mold" pills, "DEFAULT"/"DERIVED" tags, dev badges, marketing sentences ("Your discs. Your next video.", "One disc. Ready for its moment."), a "good to go" eyebrow.
- Lineup (production editor, Bag lineup): looks best of anything seen: bigger discs, brand and plastic line ("MVP · Neutron"), accent-tinted tiles. The default single card should borrow it.

## Works well, keep

- The rim fit and unwarp is fast (about 450 to 560 ms per photo) and round on all ten photos; no distortion.
- Auto-matching molds on 6 of 10 photos from the picture (Westside Stag, Axiom Defy, MVP Servo, Anchor, Buzzz SS, Luna).
- Desktop editor: "Download PNG ↓" is above the fold at 1440x900 (y=829) and downloads in about 1 s with a sane filename and a transparent canvas.
- Phone download toast copy ("Drop it on the track above your footage; the checkerboard areas stay see-through") is exactly what a video editor needs.
- Flight numbers unlabelled, name big, a fast "Disc right/left" and accent colour options ("Match disc") are right for the audience.
- Bag lineup (2 to 4 discs in one frame) and the one-row bar (SERVO 6.5 5 -1 2 on a tee-shot) are strong, shop-ready layouts.
- Zero console errors, no horizontal scroll on phone (scrollWidth 390), first load about 3 s.
- Photos-page footer counts ("6 in your bag · 4 need a mold") are a good idea once the wording and the fix path exist.

## Files

Screenshots: s0-photos.png, s1-cropall.png, s2-allcropped.png, s3-thumb0..9.png, s4-mold-*.png, s5-editor.png, s6-disc0..4.png, s6-dtree-open.png, s7-prod-*.png, s8-bar-*.png, s8-front-*.png, m1 to m7 (phone). Downloads: dl-producer/ (5 PNG), dl-phone/ (1 PNG). Composites for review: c-sheet.jpg, c-card-0..4.jpg, c-phone-servo.jpg.
