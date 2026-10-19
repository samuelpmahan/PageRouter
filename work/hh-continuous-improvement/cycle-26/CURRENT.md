# HH cycle 26 — teacher current-vote feedback

## Finding and change

The actual volatile synthetic fixture flow confirmed teacher vote, upvote sorting, detail navigation, downvote correction, back navigation, and index upvote correction. Vote state and counts were correct, but the pure rendered detail projection did not tell a teacher their current vote or expose pressed states; the index upvote control also lacked its pressed state. This supports only a renderer projection enhancement, not a vote, sort, navigation, or storage defect.

The change derives teacher feedback from the existing persona's `topic.votes` and `topic.downvotes`: detail text says `Your vote: No vote`, `Upvote`, or `Downvote`; detail arrows and the index upvote control use string-valued `aria-pressed`. Counts, sort semantics, role/hidden/persona guards, event payloads, controller, app, storage, services, and backend behavior are unchanged. Only `community.mjs`, `community.test.mjs`, and `public-controller.test.mjs` changed.

## Evidence and verification

H1's E3201 completed the actual rendered-tree flow. Two earlier baseline harness attempts failed on harness assumptions (forum route naming; two legitimate initialization receipts), then the corrected third attempt completed. H2's E3202 had five stub-harness failures and is explicitly insufficient evidence, not an actual fixture run. E3203's first filter selected only the controller RED and missed the renderer test; the corrected exact filter then produced the intended 2/2 RED, followed by focused GREEN 2/2 and HH source suite 110/110. The focused cases overlap the source suite.

Independent H2 R3203 accepted the change after an actual fixture/controller lifecycle and focused 2/2 pass. Its initial attempt exposed an optional absent `downvotes` seed field and is retained as a harness failure; the second attempt normalized only that harness expectation. The reviewer confirmed current-vote recovery, role/hidden guards, unchanged seed counts, and no extra runtime receipts.

The one canonical E3204 build succeeded: build helpers 2/2, targeted HH controller/community 157/157, full fresh-site suite 312/312, Atlas import closure 1/1; the targeted and full-suite runs overlap. It verified 843 site files and rebuilt 14 PxCube packages without relocation. Fresh receipt binds all three changed source/test inputs. The initial misspelled Bazel path was detected before `run.sh` and no build ran from it; the corrected pinned path was used for the sole canonical execution.

## Boundaries and next proposal

Evidence is source-backed and synthetic. No visual/DOM, screen-reader/accessibility, human-acceptance, deployment, production, backend, or external-service claim is made. No vote math, count, sort, controller, app, service, storage, or authority change is included.

Next proposal, requiring a separate GO: probe an actual volatile author-owned topic deletion through index return/back and empty-state recovery before presuming a defect. Do not replay other completed flows.

This is the package creation-time/pre-commit record. Root audit is required before any staging or ordinary exact-path review-branch commit; final branch/PR delivery status remains separate authority. No main-branch landing or deployment is authorized here.

Native coordination used two actual Luna/high-worker contexts. Native JSON receipts validate capacity, eligibility, pins, and exact objective; coordinator guard/admission/dispatch is a separate layer. No autonomous-service, speedup, or causality claim is made. The copied context state and epoch-05 solve capture creation-time E3205-running, not final commit status; subsequent root proof governs final native/publication status.
