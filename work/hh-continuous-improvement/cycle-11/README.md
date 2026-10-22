# HH continuous-improvement cycle 11

This package records the current cycle's runtime probes, behavior-only regression, independent review, and one canonical source build. It does not establish a product defect or claim a user-visible correction. The observed login-page feedback for late registration outcomes also occurred in a success control; whether that shared feedback projection is intended remains unresolved.

## Findings and scope

- E1601/H1 observed known failure, unknown outcome, same-route failure, and success using the actual volatile fixture provider, controller, runtime, and rendered tree. E1602/H2 independently exercised known and unknown failures plus controls. Both observed the current login route/form remain usable and no automatic second registration call. Neither used a real provider, backend, or browser.
- Phase note: E1601's `requestStatus` and `outcomeKind` fields were sampled after its separate empty-login validation control. For original registration completion, use each observation's `result` and `completedRoute.feedback`; `after` records the pre-validation login feedback. E1602 and the regression capture completion before their validation controls.
- E1603 adds exactly one table-driven test in `public-controller.test.mjs` for late known failure, unknown outcome, and pending-registration success. It preserves transaction classification, usable login form, no automatic retry, and password nonretention; it does not freeze global feedback text, style, or policy. The first pass was expected, not a red-before-fix claim.
- H1's focused/controller/public-site results were 1/1, 56/56, and 14/14. H2's independent R1603 focused run was 1/1 and accepted the exact test-only change. The canonical E1604 build was a fresh sandbox action (not a cache hit): 2 build helpers, 130 targeted HH/controller/community, 285 full npm, and 1 built Atlas import passed. These suite counts overlap and are not distinct-test arithmetic. The build rebuilt 14 packages and verified 843 emitted site files.
- The build receipt binds test SHA `e11885f0f55e56094bed3e865d9acfcb57fc995097d5be627f9ebed3631d89a3`, unchanged controller SHA `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2`, source digest `c7f2947f7ce36b1f4e51d3ad195915f8dadfa2ed7ac37f2eb01e6c33b606a565`, and site digest `439c3dea926aa4cf6f7b1f9a40b68f416a0e98233c8649adf9762826b00195bd` (`siteBuildId` `d492bba4e7d38e22b73950358dd4a432b4a47848b2c1ba9eeaf614fa506e81d1`).

## Limits and handoff

Mounted-browser QA, backend behavior, production authority, and human acceptance are unverified. No repeated browser attempts, source-policy/controller change, commit, push, deployment, or publication occurred. The only product-source change is the single test file above; no implementation defect is claimed. The native state snapshot records E1605 as running because it was captured before this package result was submitted; see the separately submitted E1605 result and package manifest for the frozen payload boundary.

The next candidate is a separate, unexecuted probe of `TeacherProfile.createProfile`: after entering a typed nonsecret draft, hold known/unknown transport failure and inspect draft/form/provider mutation and explicit retry. Existing source may already preserve the draft, so this may falsify the hypothesis. It requires a new native packet before any probe or edits.

`evidence/manifest.json` hashes each included payload byte-for-byte. It excludes itself and any after-audit administration; no post-review files are included in this frozen package.
