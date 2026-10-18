# HH continuous improvement — cycle 13

**Current entry point:** [ENTRYPOINT.md](ENTRYPOINT.md). This is a lean, workspace-bound evidence package for the E1801–E1805 work and independent R1803 review. It is not a portable script bundle, browser-QA claim, production release, or deployment artifact.

## Current disposition

H1 owns native-assigned E1805 until handoff. The bounded login-email draft correction is independently accepted at the exact three frozen source hashes in [R1803](evidence/native/receipts/R1803.json). One admitted local Bazel source build completed successfully as E1804 and is bound to those same source files. The package is prepared for independent H2 package audit; do not stage, commit, export, publish, rebuild, or mutate product sources before that audit and explicit root GO.

| Packet | Observed disposition | Evidence entry |
|---|---|---|
| E1801 H1 | Actual volatile fixture baseline probe; failure-retention defect demonstrated; v1 retained as unrun | [E1801](evidence/H1/E1801/result.json) |
| E1802 H2 | Independent volatile fixture probe confirmed retention loss, no retry, and successful fixture control | [E1802](evidence/H2/E1802/result-v2.json) |
| E1803 H1 | Red-first bounded in-memory email draft fix; red had 2 failures, green-01 retained 1 incorrect fixture expectation, green-02 corrected only that assertion and passed; controller 59/59, public-site 14/14 | [E1803](evidence/H1/E1803/original-captures/RESULT.md) |
| R1803 H2 | Independent review accepted exact three-source checkpoint with stated limits | [Review](evidence/H2/R1803/review.json) |
| E1804 H1 | One local source build: success, 1,538 source inputs, 843 verified site files, 14 PxCube packages rebuilt | [E1804](evidence/H1/E1804/result.json) |
| E1805 H1 | This package/continuation checkpoint; current owner is H1 until handoff | [Native result](evidence/E1805/result.json) |

## Frozen source and build identity

The three product files are unchanged after independent R1803 acceptance and E1804 build:

| Product path | SHA-256 |
|---|---|
| `checkpoint/vendor/hh/src/public-controller.mjs` | `308c876e8bbfeb20a3e8ee92a4065549f5ca815bec0aa6979bf39c61fa4dc07c` |
| `checkpoint/vendor/hh/src/public-site.mjs` | `5f1135c95fdb3baefb64e49d755e45a87b9eb1b17ff363ed91eb5b516812031b` |
| `checkpoint/vendor/hh/src/public-controller.test.mjs` | `f426710f6ae9c3012f5eba2aa0d50b3aaca8b4e76a4119dd3ffca58d08e13d4f` |

E1804's current receipt binds `sourceDigest` `f28be39fc1cd2acbd8e2433bb349b6086ead8f26b3a6f660049e0a69f18dcfee` to 1,538 inputs and `siteDigest` `9df3572f7ef26044872aa89612a5bfc3929902a03cb1671c428001e6b26464bd` to 843 files. The reported `siteBuildId` is `3b0d0b8ca23975b945f9294432ee7fa0c6da893cbf636438e365a0bfe801c877`. Four test summaries are retained distinctly: build-helper 2/2, targeted HH 133/133, full npm suite 288/288, and Atlas built-import 1/1. The 133 targeted HH tests overlap the 288-test npm suite and are excluded from the distinct count; 291 is a count of test cases, not independent behaviors.

## Evidence and boundaries

- E1803's original RED run had two failures. Green-01 had one test-expectation failure because that fixture's authenticated email fallback was actually empty; a single assertion was corrected before green-02. Preserve both outcomes, do not relabel green-01 as passing.
- The green-01 pre-correction test file is reconstructed after green-02, not a contemporaneous capture. Its SHA-256 matches the declared pre-run hash `d3eb4fb4f8858f41ce5a5bae35ad28ce3aea9e2b65ba9de2b9564c71d1bb5e81`; see its explicit filename and [capture erratum](evidence/H1/E1803/original-captures/ERRATUM.md).
- Genuine green stdout/stderr/exit/time files are retained from exact-byte originals. Four accidental one-newline stderr copies remain under `disqualified-newline-stderr/` as counterexamples, are marked disqualified, and are not normalized or treated as raw evidence. The accidental `PageRouter/hh-cycle13/` directory is not part of this package and must be excluded from any Git allowlist; it remains untouched.
- The probe verified random test passwords were absent from controller state, runtime, Parts, and storage. It did not claim that normal non-secret submitted email values are absent from login request Parts.
- All archived JavaScript and shell probes/build wrappers have inert `.mjs.txt` or `.sh.txt` suffixes. Their original relative imports remain workspace-bound references; they are not claimed portable or directly executable.
- No mounted browser, screenshots, repeated blocked-route attempt, exposure workaround, production service/account, external email, or deployment was used. Browser verification remains unverified; screenshots: 0.
- The recorded Python-geography work remains separate from this HH scope.
- Root-provided Git readback was local `b91b0ab0d10bf0ddeed68144ff2654e880e0401f`, remote `b4bd028e5b907efe33c053dc26705d5710f96aec`, both on tree `6b165318096ac0def49f178551603c5fdc988681`. No Git command, staging, commit, branch change, or publication was performed here.
- A standard whitespace gate is predeclared for the three product paths and the newly authored package docs. It has not been run in this package task; keep its full raw diagnostic if later run. Do not normalize files, change `core.whitespace`, or claim full-clean status without that check.

See [NEXT.md](NEXT.md), [continuation.json](continuation.json), [evidence/manifest.json](evidence/manifest.json), and the [E1805 native result](evidence/E1805/result.json) for the controlled handoff state and closed inventory.
