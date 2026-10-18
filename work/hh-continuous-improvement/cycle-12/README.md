# PageRouter continuous-improvement cycle 12

This is a lean, byte-bound package for the E1701–E1704 investigation and R1703 review. The tested hypothesis was that a reachable `TeacherProfile.createProfile` failure might lose the typed draft/form or automatically repeat a write. Both independent synthetic-fixture probes falsified that hypothesis in their tested scope. The only PageRouter product-repository change is one test file: `checkpoint/vendor/hh/src/public-controller.test.mjs` (115 insertions, no deletions). Controller, app, provider, and renderer behavior were not changed.

## Findings and verified checkpoint

- H1/E1701 and H2/E1702 independently exercised known transport failure, unknown outcome, explicit resubmission, and a success control against volatile synthetic fixture providers and the controller/render tree. Draft/form retention held; failed attempts did not mutate the synthetic provider profile or cause automatic write retries; `public:retry` did not issue a write; a deliberate new submission succeeded. The fixture's `outcome_unknown` fails before provider mutation, so it does not establish real-backend ambiguous-commit behavior.
- E1703 adds one table-driven behavior regression for those flows, including edits while the request is held. Focused regression: 1/1. Full controller suite: 57/57 (56 existing plus this test). Public-site suite: 14/14. R1703 independently accepted the exact test hash `f0304a33a0526dd94ba8e031986963d0c5f18e09fd101c7878194d2860c8f604`. The first pass is useful compatibility coverage, not a red-before-fix claim.
- E1704 ran the canonical isolated source build bound to that test hash and unchanged controller hash `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2`. It verified 843 emitted files and 14 PxCube packages. Build-log suites: helpers 2/2, targeted HH/controller/community 131/131, full npm suite 286/286, built Atlas import 1/1. These counts overlap and are not distinct-test arithmetic. The exact receipt and `site.log` are retained under `evidence/E1704/`.

## Provenance and boundaries

The manifest records exact paths, byte lengths, and SHA-256 values for this frozen payload. Raw/copy limitations remain explicit: E1701's first script version and first-run output were not separately preserved; E1701's current raw-named stdout is copied from tool-transcript output, not a shell-captured stream. E1702's four-run execution log contains combined tool output and exit testimony, not separate captured stdout/stderr; earlier probe script versions were overwritten and are not reconstructed. E1702 summary normalization was refused by root preflight before native invocation, not rejected by native finish. The initial receipt-copy `ENOENT` and following empty epoch-01 solve are documented in the bookkeeping erratum; no native finish or evidence rewrite happened on that first failed preflight.

The `.mjs.txt` files are inert archived text snapshots, not runnable tests. Workspace-bound probes with absolute imports are not promised portable. The package includes neither old cycle archives nor a `site.evidence` tree, browser screenshots, or screenshots of any kind. Browser QA remains unverified (zero screenshots); no backend, production account, human acceptance, publication, or deployment claim is made.

Archived raw diagnostic bytes are immutable. Any whitespace/style check applies only to authored README/NEXT/continuation/manifest material, never to raw captures or copied source snapshots.

See [NEXT.md](NEXT.md) for the next unexecuted candidate and `continuation.json` for ownership, exact source/build bindings, and limits. `evidence/manifest.json` is the package boundary and is intentionally excluded from hashing itself.
