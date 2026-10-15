# Independent visual audit of the kernel's own pictures (v02 to v05)

Scope: `verify/out/v02-*` to `verify/out/v05-*` (pictures and facts files) and the records `verify/V03.md`, `verify/V04.md`, `verify/V05.md`. Nothing outside `verify/AUDIT.md` was changed.

## How the checks were made

1. For each claim I wrote down what the picture must show if the claim is true and what would refute it, then opened the picture and checked it element by element (box ids, contract and implementation names, values, edge colours and both endpoints, labels, tags, text inside boxes). Small regions were cropped and enlarged into a scratch directory.
2. Edge endpoints were also checked mechanically: a browser script read every box, every text line (with its measured width) and every edge path out of each committed page and mapped each edge's start and end point to the box row it touches. This found no text running past a box edge, no text over text, and no edge ending on a wrong row in any v02 to v05 page. Every edge-level verdict below agrees with that listing.
3. Staleness: every committed page was re-photographed with `verify/shoot.py` into scratch at the width the pictures were taken at (1100, and 1400 for v03-2) and compared pixel by pixel with the committed picture. Fourteen of sixteen are identical. **Two pictures are stale** (older than the page they claim to show):
   - `v02-2-gather-crossrun.png`: the picture's cross-run tag reads `← run 2`; the page now reads `← run 2 #1`.
   - `v03-4-concat.png`: in the picture, v03-4b's `all` row is on one line; on the page `◂ all =` sits alone and the value wraps onto a second line.
   Verdicts below are about the committed pictures, because that is what a reader sees.
4. The render scripts, re-run into scratch with today's `src/`, produce facts files byte-identical to the committed ones. Their pages differ for every v02 to v04 picture, because those pictures were drawn by the v0.4 view. With today's view, v04-1 would read `lt($in.x=-4, 0)`, and v02-4 would show `division by zero` without quotes. No claim depends on this.

Verdict words: CONFIRMED, REFUTED, UNCHECKABLE. "Misleading" marks a claim that is true about the drawing but that a reader would likely misread.

---

## v02 (no claims were written)

`v02-facts.json` has no `claims` array, and no record covers v02-2 or v02-3. I checked the titles as implied claims. They are not counted in the totals.

| Picture | Implied claim (title) | What I saw | Verdict |
|---|---|---|---|
| v02-1 | `duel(x=3)`: `leaf#A` = double, `leaf#B` = square in one run; check; gather | #2 leaf#A reads leaf/double, y = 6. #3 leaf#B reads leaf/square, y = 9. #4 atLeast has a red header with the mark `check ✗`; value = 6 and floor = 9 come in as blue edges from #2 y and #3 y; reason "6 < 9". On #1: a ← #2 y, b ← #3 y, pair = [6,9] with two purple brackets (#2 y and #3 y), aWins ← #4 accepted. Green edges run from #1 x to #2 x and #3 x. | CONFIRMED |
| v02-2 | V2a: swap returns gather[s.b, s.a]. V2b: the input arrives as a cross-run Ref | V2a: #1 v = [20,10], with two purple brackets from #2 split's b and a. V2b: #1 v = [20,10] tagged `← run 2` and an output of [10,20]. **The picture is stale**: the page now prints `← run 2 #1`. | CONFIRMED (picture stale) |
| v02-3 | drive(count mod 16) from state 13 for 6 ticks | Six cells, states 14, 15, 0, 1, 2, 3, runs 4 to 9, each linked `← run k-1`. Matches `driveStates` and `driveRuns`. | CONFIRMED |
| v02-4 | `ratio(1, 0)`: the throw leaves a trace | #1 ratio and #2 divide both have red headers. #1 shows `✗ IMPL_ERROR (from #2):` and then `"division by zero"` on a second line inside the box; #2 shows `✗ IMPL_ERROR: "division by zero"`. Green edges from #1 a and b. | CONFIRMED |

## v03-1 branch

| # | Claim | Expected if true / what would refute it | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | A: #1 abs has children #2 isNeg, #3 not, #4 neg; no id box | Three child boxes with exactly these ids and contracts. Refuted by an id box or a fourth child. | #2 isNeg, #3 not, #4 neg; no id box | CONFIRMED | agrees |
| 2 | A: amber "◇ flip = true → ran read #2.yes", grey "◇ keep = false → skipped read #3.b" | Two decision rows on #1, the first amber and the second grey, with that text | `◇ flip = true → ran  read #2.yes` in amber, `◇ keep = false → skipped  read #3.b` in grey | CONFIRMED | agrees |
| 3 | A: dotted amber edges from #2 yes and #3 b to the two decision rows | Two amber dotted edges, each starting at the named output row | Both edges exist with the right endpoints. **They share one vertical lane** (x ≈ 682), overlapping between y ≈ 137 and 225, so the lines alone do not show which output feeds which row (see unclaimed defect 2). | CONFIRMED (misleading) | agrees |
| 4 | A: purple bracket from #4 y to #1 y = 4 | One purple edge from #4 y to #1 y | Present | CONFIRMED | agrees |
| 5 | B: children #2 isNeg, #3 not, #4 id; flip skipped (grey), keep ran; y = 5 from #4 y; #4 x green from #1 x | As stated | All present; #4 y = 5 is tagged `passthrough`, and a purple bracket runs from #4 y to #1 y | CONFIRMED | agrees |

## v03-2 cache

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | B: #2 quarter header hatched; implementation line "cached from run 1 #1" | Hatched header and that text | `quarter/1 · cached from run 1 #1`, hatched | CONFIRMED | agrees |
| 2 | B: #2 has a green row "✓ 2 cached verdicts: 8 > 0; 4 > 0" inside the box | A green row with that text, inside #2 | A green row inside the box, but the text is `✓ 2 cached verdicts: ✓ pos: 8 > 0; ✓ pos:`, and the next line holds `4 > 0;`. **The quoted text is out of date**: the picture was re-rendered at 05:42 with the v0.4 wording and the claim was never updated. The second verdict's name is also cut off from its reason by the line break. | CONFIRMED in substance (quoted text wrong) | partly: the record's PASS describes text that is no longer in the picture |
| 3 | B: green edge from cached #2 x to ghost #2 half x; purple bracket from ghost #4 half y to cached #2 y | Both edges with exactly these endpoints | Both present, with the right endpoints | CONFIRMED | agrees |
| 4 | B: ghost boxes #2 half (run 1), #3 pos (run 1) ✓, and so on, matching run 1's #2 to #5 | Four faded boxes with dashed borders, each tagged (run 1) | #2 half (run 1), #3 pos check ✓ (run 1), #4 half (run 1), #5 pos check ✓ (run 1); all faded and dashed | CONFIRMED | agrees |
| 5 | B: the ghosts have their own internal edges (blue half y into second half x), scoped to run 1 | Blue from ghost #2 y to ghost #4 x, and green into the ghost pos boxes; no edge to run 2's #4 or #5 | Present as described; nothing links to run 2's own #4 half or #5 pos | CONFIRMED | (no separate row) |
| 6 | B: #3 quarter (z = 12) computed, not cached, with checks 12 > 0 and 6 > 0 | Plain header; children with those reasons | Plain header; #5 pos says "12 > 0" and #7 pos says "6 > 0" | CONFIRMED | agrees |
| 7 | Receipt: four verdicts, the first two cached from run 1 call 1 | `secondVerdicts` in the facts file | The facts file shows exactly that. The picture cannot show the receipt, only the "2 cached verdicts" row. | CONFIRMED (from the facts file) | no row |

## v03-3 drive

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | A: children "#2 clock @0", "#4 clock @1", "#6 clock @2" with amber @k; stamp children untagged | As stated | As stated; #3, #5 and #7 stamp have no @ tag | CONFIRMED | agrees |
| 2 | A: stamp outputs 100, 101, 102; #4 state is blue from #2 state, and #6 from #4 | Values and two blue edges | Present | CONFIRMED | agrees |
| 3 | A: #1 s = 102 via a purple bracket from #6 | One purple edge from #6 state to #1 s | Present | CONFIRMED | agrees |
| 4 | B: states 100 to 103; ticks 0 to 2 "cached"; tick 3 "2 calls" | Four cells with those labels | `cached ← run 1` on ticks 0 to 2 and `2 calls` on tick 3 | CONFIRMED | agrees |
| 5 | C: states 100 to 103, each "cached" | Four cached cells | Ticks 0 to 2 read `cached ← run 1`; tick 3 reads `cached ← run 5` | CONFIRMED | agrees |

## v03-4 concat (picture stale; see the method notes)

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | A: labels `gather[0]←[0] passthrough`, `gather[1]←[1] passthrough`, `gather[2]←[0] gather[3]←[1]` inside the box; **the two #2 pieces share one dashed purple bracket path** from #2 b | Labels as quoted, inside the box; ONE dashed bracket. Refuted by two brackets. | Labels as quoted, inside the box. **Two separate dashed purple brackets** leave #2 b and run side by side, 4 px apart (x = 668 and 672), into #1 all. Grouping only starts above four pieces, so nothing is shared. | **REFUTED** (two parallel brackets, not one) | **disagrees** (author: PASS) |
| 2 | B: the `all` value is cut with … inside the box; continuation "pieces ×8 passthrough pieces ×8"; one dashed bracket from #2 b | As stated | In the committed picture: `all = [1,2,3,4,5,6,7,8,2,4,6,8,10,12,14…` ends about 7 px inside the box edge; the continuation line is as quoted; one dashed bracket. (On the current page the value has moved to its own line.) | CONFIRMED (picture stale) | agrees |
| 3 | Both: no text crosses a box edge and no edge crosses text | Measured text widths stay inside the boxes; no edge goes through a text line | Confirmed by eye and by measurement | CONFIRMED | no row |

## v04-1 relations

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | A: #1 abs has exactly one child, #2 neg; no isNeg or not box | One child | One child, #2 neg | CONFIRMED | agrees |
| 2 | A: rows "◇ flip = true → ran read lt($in.x, 0)" (amber) and "◇ keep = false → skipped read ge($in.x, 0)" (grey) | Two rows, coloured as stated | As stated; the keep row wraps `read ge($in.x, 0)` onto a second line inside the box | CONFIRMED | agrees |
| 3 | A: dotted amber edges leave #1's own x row and enter both decision rows | Two amber edges starting at #1 x | Both start at #1 x and loop back into the flip and keep rows | CONFIRMED | agrees |
| 4 | A: #1 y = 4 with a purple bracket from #2 y | One purple edge | Present | CONFIRMED | no row |
| 5 | B: no children; one grey row "◇ negative? = false → ran keep, skipped negate read lt($in.x, 0)" wrapped inside the box; y = 6 passthrough | As stated | As stated. The row breaks between "skipped" and "negate". | CONFIRMED | agrees |

## v04-2 nested

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | A: children #2 neg, #3 sq, #4 sq; no fourth child | Three children | Three children; #2 y = 3 | CONFIRMED | no row |
| 2 | A: ONE amber row "flip, sqA, sqB = true → ran read lt($in.x, 0)" and a grey row "big = false → skipped read and(lt($in.x, 0), gt(#2.y, 10))" | Two decision rows | As stated, both wrapped inside the box | CONFIRMED | agrees |
| 3 | A: the big row has amber edges from #1 x and #2 y | Two amber edges into the big row | From #1 x (lane 342) and from #2 y (lane 682) | CONFIRMED | agrees |
| 4 | A: y = 9 from #3 y; both = [9,9] with gather[0] and gather[1] brackets from #3 and #4 | Three purple edges | y ← #3 y; both ← #3 y and #4 y | CONFIRMED | no row |
| 5 | B: no children; one grey merged row and one grey big row; y = 5 and both = [5] passthrough | As stated | As stated. The big row reads `and(lt($in.x, 0))` with a single operand (see unclaimed defect 8). | CONFIRMED | agrees |

## v04-3 path slots

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | A: four leaf boxes; #4 leaf#b1 and #7 leaf#b1 both read leaf/ten; lo = 11, hi = 11 | As stated | #3 leaf#b0 leaf/inc, #4 leaf#b1 leaf/ten, #6 leaf#b0 leaf/inc, #7 leaf#b1 leaf/ten; lo = 11, hi = 11 | CONFIRMED | agrees |
| 2 | B: only #7 leaf#b1 reads leaf/ten; #4 reads leaf/inc; lo = 2, hi = 11 | As stated | As stated | CONFIRMED | agrees |

## v04-4 collect

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | A: children "#2 step @5", "#3 step @6", "#4 step @7"; no word "tick" | As stated | As stated | CONFIRMED | agrees |
| 2 | A: row "⟳ step: 3 ticks, 5–7 stopped by ticks" | That row on #1 | Present | CONFIRMED | agrees |
| 3 | A: outs = [5,16,27] with gather[0..2]; three purple brackets from #2, #3, #4 out | Three purple edges ending at the outs row | Present (gather[2] wraps onto a second line). Their horizontals from #2 out and #3 out cross the lane of the s bracket from #4 state (see unclaimed defect 7). | CONFIRMED | agrees |
| 4 | A: s = 3 bracketed from #4 state | One purple edge | Present (innermost lane, x = 668) | CONFIRMED | no row |
| 5 | B: five cells, states 1 to 5, `cached ← run 2..6`, "1 ✓ 0 ✗" on ticks 0 to 2, red "0 ✓ 1 ✗" on ticks 3 to 4 | As stated | As stated | CONFIRMED | agrees |

## v04-5 cached checks

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | #2 header red (✗) AND hatched; header text cut with … inside the box | A red-tinted hatched header, text ending in … before the edge | Pink under the hatch (faint); the text reads `#2 audit.portfolioVarianceWithinRegula…`. **No ✗ glyph and no word "check" appear**: both were cut away to keep the contract name (see unclaimed defect 3). | CONFIRMED if "(✗)" means "red means rejected"; the glyph is absent | agrees, but the record does not mention the missing mark |
| 2 | Implementation line cut with …, starts "audit.portfolio", keeps "· cached from run 1 #2" | As stated | `audit.portfolioVar… · cached from run 1 #2` | CONFIRMED | agrees |
| 3 | #2 has "✗ 1 cached verdict:" and the reason "variance 6 > budget 4" after a cut contract name, without quotes | As stated | `✗ 1 cached verdict:` / `✗ audit.portfolioVarianceWi…:` / `variance 6 > budget 4;` | CONFIRMED | agrees |
| 4 | #3 both hatched; "✗ 2 cached verdicts:", "✗ audit.portfolioVarianceW…:", "variance 6 > budget 4;" in red, "✓ pos: 6 > 0;" in green, all inside the box | As stated | As stated, except that the cut name reads `audit.portfolioVarianceWi…:` (one more character than quoted) | CONFIRMED | agrees |
| 5 | No text crosses a box edge | Measured widths stay inside | Confirmed | CONFIRMED | no row |

## v05-1 inherited skips and else

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | A: children #2 neg, #3 sq, #4 neg; y = -9 from #4; amber "flip = true → ran read lt($in.x=-3, 0)"; grey "keep = false → skipped read else(flip: lt($in.x=-3, 0))" | As stated | As stated, with amber edges from #1 x into both rows. **Nothing on #3 sq or #4 neg shows that they inherit flip's condition**, so the title's "sqr and again inherit it" cannot be seen (unclaimed defect 4). | CONFIRMED | agrees |
| 2 | B: one child #2 id; ONE grey row "flip, sqr, again = false → skipped read lt($in.x=3, 0)"; amber "keep = true → ran read else(flip: …)"; y = 3 from #2 | As stated | As stated; the else row reads `else(flip: lt($in.x=3, 0))` | CONFIRMED | agrees |
| 3 | C: one child id; grey rows for a and b reading eq($in.k="zzz", "neg") and eq($in.k="zzz", "sq"); amber row for other reading else(a: …; b: …), wrapped inside the box | As stated | As stated. #2 id is a cache hit (`cached from run 2 #2`), which the claim does not mention. The wrapped else expression breaks inside `eq(…, "neg")`. | CONFIRMED | agrees |

## v05-2 selection

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | #1 hist has eight children "#2 step @0" to "#9 step @7" | Eight children | Eight children | CONFIRMED | no row |
| 2 | Row "last = 70": exactly one dashed purple bracket from #9 out (tick 7), labelled [7] | One dashed edge that can be followed from #9 out to `last` | The label `[7]` is there, and the drawing has one dashed path from #9 out. But for its whole run between the `all` row (y ≈ 137) and #5 out (y ≈ 625), the solid `all` bracket from #5 out is drawn on the same x (668), so that stretch looks solid. Followed from the top, the "last" line first meets a junction at #5 out = 30; it turns dashed again only below that junction. | CONFIRMED (misleading) | agrees on the drawing; the overlap was not noticed |
| 3 | Row "third = 20": exactly one dashed purple bracket from #4 out (tick 2), labelled [2] | One dashed edge that can be followed from #4 out to `third` | The label `[2]` is there. The dashed path from #4 out runs on x = 672, **the same x as the solid `all` bracket from #6 out**, for its whole length below the `all` row. Its stub at #4 out is drawn under #4's own solid `all` horizontal at the same y. Only about 17 px of dash is visible, just under `third`. To the eye, `third = 20` comes from #6 out = 40. | **REFUTED** (cannot be traced to #4; reads as #6) | **disagrees** (author: PASS on edges) |
| 4 | Row "all = [0,10,…,70]": **grouped labels**; eight brackets, one per tick call | Grouped labels (for example `gather ×8` or `pieces ×8`) and eight brackets | Eight separate labels, `gather[0]` to `gather[7]`, over three lines, and the value printed in full. Nothing is grouped: grouping merges only pieces from the same source, and each piece has its own call. The eight brackets are present. | **REFUTED** (labels are not grouped) | **no row** (the record skips this claim) |
| 5 | Drive row "⟳ step: 8 ticks, 0–7 stopped by ticks" | That row | Present | CONFIRMED | no row |

## v05-3 wrap and fill

| # | Claim | Expected / refuted by | What I saw | Verdict | Author |
|---|---|---|---|---|---|
| 1 | A: purple line "fill: pick → pick/b"; #2 pick#me reads pick/b; #3 pick#model reads pick/a; me = 105, model = 6 | As stated | As stated | CONFIRMED | agrees |
| 2 | A: the me decision prints and(ne($in.mode="play", "spectate"), ge($in.x=5, 0), …) over several lines inside the box | As stated | Four lines inside the box, ending `ne($in.mode="play", "replay-only"))`. Continuation lines are indented less than the first line. | CONFIRMED | agrees |
| 3 | B: the fill line lists both keys, neither marked "(not consulted)"; #3 pick#model reads pick/b; model = 105 | As stated | `fill: pick → pick/b   game/pick#model → pick/b`; #3 reads pick/b; model = 105 | CONFIRMED | agrees |
| 4 | C: #1 boom header red; "✗ QUEUE_FULL:" and then the whole message, without quotes, wrapped inside the box, ending "pending merges" | As stated | As stated; every word of the message is present | CONFIRMED | agrees |

---

## Record rows (V03, V04, V05) against this audit

All 39 rows were read. My verdict agrees with the author's "Final" column on 36 rows; two of those 36 carry a staleness caveat. I disagree on 3 rows.

| Record row | Author's final | This audit |
|---|---|---|
| V03 "v03-2 B: ✓ 2 cached verdicts: 8 > 0; 4 > 0 inside the box" | PASS | Disagree in part. The row is inside the box, but the picture now prints `✓ pos: 8 > 0; ✓ pos: / 4 > 0;`, so the PASS refers to an earlier render. The v03-2 picture was re-rendered at 05:42 without the claim or the record being updated. |
| V03 "v03-4 A: … two #2 pieces share one bracket" | PASS | Disagree: REFUTED, two parallel brackets |
| V05 "v05-2: last = 70 and third = 20 each draw exactly one dashed bracket" | PASS on edges | Disagree: `third` is REFUTED (reads as coming from #6); `last` is true but misleading |
| V03 "v03-4 B" and V03 "v02-1, v02-4" (caveat, not a disagreement) | PASS | Correct for the committed pictures, but `v03-4-concat.png` and `v02-2-gather-crossrun.png` are older than their pages. No record notes that the last look predates the last render. |

The records have no row for 13 facts claims: v03-2 claims 5 and 7; v03-4 claim 3; v04-1 claim 4; v04-2 claims 1 and 4; v04-4 claim 4; v04-5 claim 5; v05-2 claims 1, 4 and 5; and the y bracket in v05-1 claim 1. One of these, v05-2 claim 4, is false. v02 has no claims at all.

## Most serious discrepancies, ranked by how much they would mislead a reader

1. **v05-2, `third = 20 [2]`**. Edge lanes collide, so the dashed bracket from #4 out is hidden under the solid `all` bracket from #6 out and under #4's own `all` horizontal. The picture shows `third` taking its value from #6 out = 40. The point of this picture is "a selection draws one edge to the piece it selects", and on this row it shows the wrong piece. The author recorded PASS.
2. **v05-2, `last = 70 [7]`**. Same cause (lane x = 668, shared with #5's `all` bracket). The line from `last` runs solid down to a junction at #5 out = 30 before it turns dashed again. Technically true, easy to misread.
3. **v05-2 claim 4, "grouped labels"**. The claim is false (eight separate gather labels), and it was never checked: V05 has no row for it.
4. **v03-4 claim 1, "share one dashed purple bracket path"**. Two brackets are drawn. This is a small visual difference, but the author recorded PASS on a statement about how many edges there are, which an edge-by-edge look would have caught.
5. **Stale pictures and records**. `v02-2` and `v03-4` pictures predate their pages. The v03-2 picture was re-rendered with new wording while V03 still quotes the old wording as PASS. A reader who trusts "Final: PASS" is trusting a look at a different render.

## Unclaimed defects

1. **Right-gutter lane wrap** (`src/view.mjs` lines 254–255: `rgutter.set(src.x, (n + 1) % 5)`, lane = `sx + 8 + n * 4`). Every output bracket leaving one column takes the next of only five lanes, wrapping after five, and the counter is shared across the whole picture. With more than five brackets from one column, solid and dashed brackets land on the same x and hide each other. This is the cause of discrepancies 1 and 2. It also puts the v05-2 `all` brackets from #2 and #7, #3 and #8, and #4 and #9 on shared lanes. Those share a target, so they stay correct, but the junctions on a shared lane can be mistaken for one another.
2. **One lane for all decision edges** (`src/view.mjs` line 271: every amber edge turns at `sx + 22`). In v03-1a and v03-1b, the edge from #2 yes into the flip row and the edge from #3 b into the keep row share x ≈ 682 between y ≈ 137 and 225. The lines alone cannot tell "#2 decided flip" from "#2 decided keep"; only the `read #2.yes` text can.
3. **The verdict mark is cut first in long headers** (`src/view.mjs` lines 286–295: header parts are cut in order, so the contract name eats the room before `check ✗`). In v04-5, #2 audit.portfolio…'s header has no ✗ and no "check". Under the hatch, the only sign that the check rejected is a faint pink.
4. **v05-1a's title cannot be seen in its picture.** "sqr and again inherit it": when the cause is true, no decision is recorded for the steps that inherit it (facts: decisions are only `[flip, true]`, `[keep, false]`). #3 sq and #4 neg look exactly like unconditional steps.
5. **Wrapped verdicts split a name from its reason.** In v03-2b, `✓ pos:` ends line one and `4 > 0;` starts line two. This goes against the record's stated design ("contract and reason are separate tags, so the reason wraps whole"): the reason wraps whole, but apart from its name.
6. **Stale pictures**: `v02-2-gather-crossrun.png` (missing `#1` in the cross-run tag) and `v03-4-concat.png` (old layout of v03-4b's `all` row).
7. **Purple brackets cross other brackets without a junction mark.** In v04-4a, the horizontals from #2 out and #3 out cross the lane of the s bracket from #4 state. In v04-3, #5 half#hi's bracket lane passes over the end of the #4 → #2 bracket at #2 y. Readable with care, but ambiguous at a glance.
8. **Short-circuit display hides an operand.** v04-2b's big row reads `and(lt($in.x, 0))`. A reader cannot tell that a second operand `gt(#2.y, 10)` exists. The title's "the gather falls through" is not visible either: `both = [5] gather[0] passthrough` gives no sign that a first alternative was skipped.
9. **Code, not visible in these pictures: decision edges on a cache hit look up the wrong run.** `src/view.mjs` line 266 resolves a decision operand with `find(box, f.call)` in the box's own scope, but a cache hit's decisions name call ids from the original run. I reproduced this in scratch: a cache hit #4 f carrying `read gt(#2.y, 4)` (run 1's #2) drew an amber edge from the current run's unrelated #2 sq. Its value printed without `=9`, because the hit has no children to look the value up in. No v02 to v05 picture has a decision on a cache hit, but the contest pictures with cached ghosts might.
10. **Wrapped expressions are indented inconsistently.** In v05-1c and v05-3a/b, continuation lines are indented 3 spaces under a first line that begins `read` at 5 spaces, and breaks fall between the operands of a nested call (`eq($in.k="zzz",` / `"neg")`). This is cosmetic.

## Totals

- Facts claims (v03 to v05): 54 in all. 51 CONFIRMED (of which 3 are true but misleading: v03-1 claim 3, v05-2 claim 2, and v04-5 claim 1's missing glyph; and 2 quote out-of-date text: v03-2 claim 2, v04-5 claim 4). 3 REFUTED (v03-4 claim 1, v05-2 claim 3, v05-2 claim 4). 0 UNCHECKABLE (the receipt claim v03-2 claim 7 was checked against the facts file).
- v02 titles (not counted above): 4 CONFIRMED, one of them on a stale picture.
- Record rows: 39 in all. I agree with 36 (2 of them with a staleness caveat) and disagree with 3.
