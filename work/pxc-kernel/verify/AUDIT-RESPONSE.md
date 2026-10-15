# Response to the independent audit (verify/AUDIT.md)

The audit checked 54 kernel picture claims. It confirmed 51 and refuted 3, and it found defects that my own verification had missed. Each finding and what changed:

| Finding | Verdict on my record | Action | Evidence now |
|---|---|---|---|
| v03-4 claim 1: "two #2 pieces share one bracket" | My PASS was wrong: two brackets were drawn 4 px apart | Claim corrected: two brackets in two lanes | v03-4a re-shot: two dashed brackets, clearly separate |
| v05-2 claim 3: `third` from #4 | My PASS was wrong *to the eye*: the dashed bracket shared a line with a solid one | **View fixed.** Gutter edges are counted first, then each gets its own lane; the gutter is wider (`gap` 54 px) | v05-2 re-shot, gutter zoomed: the dashed lane for `third` stops at #4 out and no solid line covers it |
| v05-2 claim 4: "grouped labels" | Unchecked by me, and false | Claim corrected: eight distinct sources, so nothing groups | v05-2 |
| Right-margin lanes reused every five edges (`view.mjs`) | Not seen by me | Same fix as v05-2 claim 3 | all v02–v05 pictures re-rendered |
| All amber decision edges from one column on one vertical | Not seen by me | Decision edges share the lane allocator with output brackets | v03-1a: the edges from #2 yes and #3 b now run in separate lanes |
| Long header cut before "check ✗" (v04-5) | Not seen by me | The tags (tick, kind, verdict, run) are kept whole; the name is cut | v04-5: `#2 audit.portfolioVarianceWith… check ✗` |
| Decisions carried by a cache hit drew edges to same-numbered boxes of the *current* run (a wrong-box edge) | Not seen by me; no kernel picture showed it | **View fixed.** A hit's operands resolve in the original run's scope when expanded, and are not drawn otherwise. Operand values for a hit's own inputs and for `at` paths now print | new test `view: a cache hit's decisions never draw edges…` in `kernel-v05` (the old code would draw one wrong edge there) |
| v02-2 and v03-4 pictures older than their pages | My records described pictures that no longer matched the code | All kernel pictures re-rendered and re-shot with the current view | `verify/out/v0[2-5]-*.png` |
| 13 claims without a record row | Correct | From v0.6 on, every claim in a facts file gets a row in its V record, including unchanged ones | — |

The audit's judgement was: trust the records for text and values, but recheck edge claims where brackets crowd the margin. I accept it. The margin was crowded because of a view defect, and that defect is now fixed.
