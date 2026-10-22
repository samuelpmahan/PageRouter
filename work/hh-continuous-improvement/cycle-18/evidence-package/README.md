# HH18 contact-copy evidence

This 28-file package records the verified contact-preview repair. The page now says, “This preview lets you prepare a contact note. Nothing is sent,” and the submit action reads “Prepare note.” The controller still keeps the submitted note in local journey state and returns `remote:false`; no provider contact or mail operation ran.

H1’s initial synthetic probe (E2401) and H2’s independent probe (E2402) observed the original send-copy mismatch. H1 changed two renderer strings only (E2403); the focused renderer/controller run passed 77/77, and a combined synthetic render+submit probe confirmed the disclosure, retained note and zero provider-call deltas. H2 independently accepted the copy and behavior in R2403.

The configured source build passed on 2026-10-19 with exit 0 under Node 24.19.0. It reports 1,538 source inputs, 843 fresh site files, 14 successful PxCube packages, site build ID `c9126b2c2dd96d98d6292ed1506f4c01298a073099dbc34ae538625fc51c27ee`, and digest `4c100f9feea4b8baa4a519f3f8fa011d89b9b240518bd52961b909b5c57f93e4`. The focused run passed 77 tests; the build log names 137 HH source tests, 292 full-suite tests and one built Atlas import test. The 77/137/292 layers overlap and must not be summed. The receipt binds `public-site.mjs` SHA-256 `dfbbf6127c181b8818cf3071bdd02e5c32f799a8e8ceabc8755b4cb0ed79df6a` and the controller/tests inputs.

The five native assignment receipts cover epochs 0–4. Raw probe/test/build stdout, build stderr, UTC bounds and exit status are retained. Browser QA remains unverified; this candidate build was not deployed. No real account, backend, email or outbound message was used.
