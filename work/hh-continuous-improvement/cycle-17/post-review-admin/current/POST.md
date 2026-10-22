# Cycle 17 post-review correction

This is a new, separately indexed correction record. It supplements the frozen cycle-17 package; it does not rewrite or retroactively accept that packet. R2305's original decision remains `amend` pending a new independent R2305B audit of this exact supplement and its cross-claims.

## Corrected receipt fact

The actual, hash-bound E2304 `site.receipt.json` has 1,538 `sourceInputs` and includes `vendor/hh/src/public-site.test.mjs` with 19,545 bytes and SHA-256 `264f67b21ad165aab85e71c48d48d9d898ca30725418d7b2eb350f9cc98c74c5`. Thus the test is both separately pinned/tested and included in the build receipt's source-input inventory. The frozen README, continuation, E2305 result, and prior root commentary that said the test was absent are inaccurate on this specific fact and remain byte-exact history. Root's lookup error and correction are preserved in `root-receipt-input-erratum.md`; the underlying successful build and test results are not invalidated.

## Review disposition and scope

R2305 independently found the material discrepancy and otherwise confirmed the original 115 payload files / 847,742 listed bytes, 117 physical files including the manifest and E2305 result, matching listed hashes/full modes, and 60 original/copy bindings. It did not rehash the 843 site output bodies. R2305 remains an AMEND; this supplement does not relabel it accepted. A new independent R2305B file-only audit must reconcile this correction with the frozen claims before any staging or commit.

The E2304 actual result, original E2304 receipt, E2305 frozen result/receipt, R2305 review/audit/result/receipt, current captured native state and policy, and exact root erratum are preserved as distinct supplemental files. `evidence/manifest.json` remains unchanged and binds the original 117-file package only. The separate admin manifest binds only this new directory's payload; it excludes itself to avoid a circular digest.

## Frozen product/evidence limits

The two reviewed product paths remain renderer `checkpoint/vendor/hh/src/public-site.mjs` (`d9c17a350375633a53d0dc256be666bb0c82298c9ffa7b05bc6be08156141bfc`) and test `checkpoint/vendor/hh/src/public-site.test.mjs` (`264f67b21ad165aab85e71c48d48d9d898ca30725418d7b2eb350f9cc98c74c5`). No new source, test, probe, or build run is claimed or needed for this evidence-description correction.

The E2304 receipt reports 843 output-file metadata entries, but no 843 output bodies were retained or rehashed; only the fresh receipt and log are in the frozen package. Test counts remain as recorded in the raw evidence; targeted HH counts overlap the full-suite count and are not additive. Emitted-tree/UI evidence is not browser DOM, computed accessible-name, keyboard, screen-reader, human, backend, deployment, or production evidence. The exact 27 historical HH13/HH15 scratch paths remain preserved and excluded; Lab7 remains separate.

The accompanying state and policy files are captured-time snapshots, not live state. The included native registry is an earlier registration snapshot; it is not a claim of current assignment/ownership. No live-state inference should be made from these copied records.
