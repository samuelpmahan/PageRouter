# R2305 independent file-only audit

Decision: `amend` for a material receipt-description mismatch. The frozen payload itself is complete and byte/mode exact; source/test changes, bounded test evidence, independent review, and build receipt bindings otherwise agree. Do not edit or normalize the frozen package.

## Package integrity

- Audited `/workspace/scratch/8528bb251845/PageRouter/work/hh-continuous-improvement/cycle-17` read-only.
- Manifest: 115 listed payload files, 847,742 listed bytes; SHA-256 `87ab8b...142fd9` (full hash in result JSON). Manifest and excluded E2305 native result bring the physical set to exactly 117 files. No missing/extra payload paths, byte-length/hash mismatches, or mode mismatches were found.
- E2305 result is the declared excluded file, SHA-256 `a73076499dcfd0c2205619b692d1b25958e9828477773bd0a32a47af7e1c8d47`.
- The original/canonical copied-evidence bindings checked: 60 copy pairs, including original captures, actual receipts, and E2304 fresh `site.receipt.json`/`site.log`; no byte or mode differences found. E2304 receipt and log retain mode `0555`.
- Exact 27 pre-existing HH scratch paths are stated excluded/preserved; no inference that they were deleted or independently enumerated in this audit. Lab7 remains separate and untouched.

## Source and test checkpoint

The two changed product paths match the frozen pins and source snapshots: renderer `checkpoint/vendor/hh/src/public-site.mjs` SHA-256 `d9c17a350375633a53d0dc256be666bb0c82298c9ffa7b05bc6be08156141bfc`; test `checkpoint/vendor/hh/src/public-site.test.mjs` SHA-256 `264f67b21ad165aab85e71c48d48d9d898ca30725418d7b2eb350f9cc98c74c5`. Archived before hashes are renderer `1159a588...` and test `12e8b851...`. The renderer diff is one `aria-label="Toggle account and site navigation"` on the existing toggle; the test adds the four-state anonymous/authenticated × closed/open emitted-tree assertion. Other reviewed controller, app, fixture-provider, and runtime source pins remain unchanged. No source was edited during this audit.

Evidence chronology and qualifications agree with the preserved artifacts:

- E2301/E2302 bounded synthetic probes falsified the directory-recovery defect hypothesis and observed a source-emitted glyph-only navigation control. E2302 is the actual H2 probe; its prepared source-only result is not the execution receipt. Its no-match status was read after recovery, so historical status is not claimed.
- E2303 actual RED raw output reported `undefined`; its JSON projection records `null`. The remaining RED cases were unreached. Actual GREEN output is focused 1/1, public-site 16/16, controller 61/61, with zero skips; the preserved prospective skip prediction was wrong. No browser, computed accessible-name, keyboard, screen-reader, or human result follows from emitted-tree checks.
- R2303 remains an AMEND: wrong cwd, target not loaded, zero tests registered, exit 1. R2303B is separate and accepted: corrected cwd, exact focused test 1/1 pass, zero skips, exit 0. Do not merge these outcomes.
- E2304 retained one canonical build run, exit 0; raw/log evidence reports 2 helper tests, 137 targeted HH, 292 full-suite, 1 Atlas closure, all passing with zero skips; targeted tests overlap the full suite. Receipt reports 843 output-file metadata entries and 14 packages. These are receipt/log claims, not an independent rehash of 843 site bodies; the package contains only the fresh receipt and log, not the output tree.
- E2305 state is a historical snapshot taken while its job was running. The documented failed locator/copy attempts and prior H2/root capture-copy setup qualifications are retained as process history, not product/test failures. No prior raw capture was rewritten.

## Material mismatch: E2304 source-input inventory

README.md, continuation.json, and evidence/E2305/result.json state that the fresh E2304 receipt's 1,538 `sourceInputs` omit `vendor/hh/src/public-site.test.mjs` (the continuation describes a renderer-test input entry as absent). That statement is contradicted by the packaged, hash-bound `evidence/native/build/E2304-H1/fresh-output/site.receipt.json`: its `sourceInputs` array has 1,538 entries and includes `vendor/hh/src/public-site.test.mjs`, 19,545 bytes, SHA-256 `264f67b21ad165aab85e71c48d48d9d898ca30725418d7b2eb350f9cc98c74c5`.

Thus the test is both separately pinned/tested and included in the receipt's source-input inventory. This does not invalidate the successful captured build or the source pins, but the handoff's description of the receipt is materially inaccurate and should be corrected in a new reviewed package revision. This audit does not modify the frozen package.

Scope is file/evidence integrity and provenance only. No test, probe, build, browser, Git, deployment, or product operation was performed.
