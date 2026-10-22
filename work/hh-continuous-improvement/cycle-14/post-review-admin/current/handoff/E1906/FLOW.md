# E1906 scratch proposal — blocked

Status: scratch-only preparation. R1905 is auditing the frozen E1905 package. No repository, package, product, index, commit, or export mutation has been made. These scripts are not syntax-checked or executed. Any later execution requires R1905 acceptance and separate root GO for the specific gate.

## Frozen inputs

- Repository: `/workspace/scratch/8528bb251845/PageRouter`, branch `codex/hh-continuous-improvement`.
- Local base: commit `06b6da36e326758ccd14cda021bc0a15cfd00817`, tree `eb7136f80b1bdfd08c771f519a626a1e508bb1a9`.
- Canonical remote parent reported by root only: `a2b2c45631c14e5f5cb22c3cc2c74fa6bf88d153`; no fresh remote verification is claimed or performed.
- Product source allowlist: `checkpoint/vendor/hh/src/public-controller.mjs` SHA-256 `d730252e211af138383e76ca97b1cf39ddc8aabb4426b2d2ba5560cb58772669`; `checkpoint/vendor/hh/src/public-controller.test.mjs` SHA-256 `9768d179968f1e2fcaafa0576e2896d5a72f45a7ae5ea0153a4ca4596a8bb164`.
- Immutable cycle-14 package: manifest SHA-256 `0534667e8c1960ba8a8562fafe3a0cfc365942945a3852c0eb982d97c326d2bb`, 95 listed payloads plus manifest and E1905 result (97 files total); result SHA-256 `413f929414b8cb0a7b6a55b4138e7ede4fc77f4bb49a11f8192d34df018ef819`.
- Existing untracked `PageRouter/hh-cycle13/` contains 21 known files. They remain untouched, excluded, and must not be staged/exported.
- Future owner/admin closure is expected only at `work/hh-continuous-improvement/cycle-14/post-review-admin/current/`. It does not exist in this preparation and must only be created after accepted R1905 plus further root GO. No receipt or allowlist for that not-yet-created closure is claimed.

## Actual implementation/transport flow

The accepted login repair is limited to the existing success-only `service()` callback: runtime synchronization runs, then the callback projects successful identity/email/community role and clears the login draft, then the service's final notification emits the updated render tree. The route-epoch conditional redirect remains in the outer success handler. The package locks the exact two source hashes above; this E1906 preparation does not edit them.

After review and a later gate-specific GO, the precommit gate is intended to read the current base/status, verify the exact 95 manifest payload hashes plus manifest/result envelopes, validate the separately enumerated future admin closure, enforce the two-source + cycle14 package boundary, preserve the known 21-file HH13 scratch exclusion, and check whitespace only on the two product files and new authored admin documents. Immutable package/raw evidence is hash-checked, never normalized. It must retain the complete original whitespace diagnostics; no config override, normalization, hook bypass, or full-clean claim is allowed.

Only after root reviews actual admin bytes and a final explicit allowlist may staging be authorized. The corrected staged verifier consumes a root-frozen prospective plan and checks exact staged paths, index stages/modes, SHA-256, and Git blob SHA-1 using the known-supported `git ls-files --stage -z -- <literal paths>` form. It is not a permission to stage. One local commit is the maximum future Git scope; no push, fetch, reset, force, export, publication, or deployment is authorized here.

The prepared exporter accepts an immutable 40-hex commit argument (never `HEAD`), verifies its parent/tree, exact two product blobs, immutable 97-file E1905 package, and the separate admin manifest/entries, then reads only committed Git blobs. It records path/mode/Git blob SHA-1/byte length/SHA-256, uses fatal UTF-8 round-trip text or base64, exclusive fresh output, 60,000-byte segment JSON cap and 190,000-byte index cap. The root-reported canonical parent is metadata only, not authenticated. No exporter command is executable under the current authority.

## Prospective command sequence (blocked; not run)

1. After R1905 accepted + root GO: run the precommit source gate from PageRouter using the pinned Node runtime. Stop on any unexpected result; do not retry or rewrite captures.
2. Only after root reads actual future admin files/final path allowlist/prospective commands and issues separate Git GO: stage exact literal paths once; run `git diff --cached --check` preserving original stdout/stderr/exit; run the staged verifier with the root-admitted plan path and its SHA-256; one commit on the existing branch only if each earlier gate is accepted.
3. Only after root separately admits the immutable resulting commit and export plan: run the exporter once with that 40-hex SHA. It writes only a fresh E1906 scratch output child with exclusive creation. Stop on first failure; no overwrite/retry.

Prospective argv and phases are recorded in `prospective-commands.json`. No staging, commit, syntax check, test/build, exporter, source edit, or package edit has occurred in E1906.
