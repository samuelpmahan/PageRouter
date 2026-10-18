# E1803 H1 implementation result

## Change

Added a nullable, in-memory login email draft at `state.journey.loginDraft.email`: `null` means no login draft and permits the existing session/registration fallback; a string (including the explicit empty string) represents the current typed login email. Login-route email `updateDraft` updates this bounded controller-owned value and triggers render. The login renderer uses it ahead of the prior fallback. Successful login, logout, and local demo reset clear the draft. Passwords, service payloads, runtime/session state, registration identity, Parts, and storage are not used to retain it. No service/provider behavior was changed.

## Observed tests

- Red checkpoint: 2 focused tests failed before the source fix, showing absent draft retention and explicit-blank fallback override. Raw originals: `/workspace/scratch/8528bb251845/hh-cycle13/H1/E1803-PROPOSAL/red-01.{stdout.raw,stderr.raw,exit,start.utc,end.utc}`.
- Focused green-01: 1 passed, 1 failed because the test assumed the authenticated session projection would contain `avery@fixture.test`; the actual runtime projection was empty. This was a test expectation issue, not an implementation failure. Raw captures and the reconstructed prior source are qualified in `ERRATUM.md`.
- Focused green-02 after correcting only that fallback assertion: 2 passed, 0 failed.
- Full `public-controller.test.mjs`: 59 passed, 0 failed.
- Full `public-site.test.mjs`: 14 passed, 0 failed.

The full-suite and focused green original captures are in this directory. Focused green-01 is retained as a failed validation record and not counted as passing.

## Frozen product source identity

| Path | SHA-256 |
|---|---|
| `PageRouter/checkpoint/vendor/hh/src/public-controller.mjs` | `308c876e8bbfeb20a3e8ee92a4065549f5ca815bec0aa6979bf39c61fa4dc07c` |
| `PageRouter/checkpoint/vendor/hh/src/public-site.mjs` | `5f1135c95fdb3baefb64e49d755e45a87b9eb1b17ff363ed91eb5b516812031b` |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs` | `f426710f6ae9c3012f5eba2aa0d50b3aaca8b4e76a4119dd3ffca58d08e13d4f` |

Validation used Node's test runner on only the focused tests and these two named test files. No build, browser, backend, production-account, package, or Git operation is claimed. Await independent H2 review; this result is not self-accepted.
