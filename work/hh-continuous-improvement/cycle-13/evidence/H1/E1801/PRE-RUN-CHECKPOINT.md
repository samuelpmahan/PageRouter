# HHcycle13 H1 / E1801 pre-run checkpoint

Status: reviewed for execution planning only. This runner has not been executed.

## Proposed command and original capture paths

- CWD: `/workspace/scratch/8528bb251845/hh-cycle13/H1/E1801`
- Executable: `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`
- Exact argv: `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ./probe-v1.mjs`
- UTC plan time: `2026-10-18 20:10:44 UTC`
- Original stdout stream: `stdout-v1.raw`
- Original stderr stream: `stderr-v1.raw`
- Original exit status: `exit-v1.txt`
- Planned shell invocation (streams are captured directly at execution, never reconstructed from tool output):

  ```sh
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ./probe-v1.mjs > ./stdout-v1.raw 2> ./stderr-v1.raw
  probe_exit=$?
  printf '%s\n' "$probe_exit" > ./exit-v1.txt
  ```

## Scope and concrete flow

The script uses the current `createFixtureProvider`, `createServiceRuntime`, `createPublicController`, `createCommunity`, and `renderPublicSite` seams with in-memory volatile storage. A wrapper around the actual fixture provider's `Session.login` service holds each call until explicitly released, then passes supported `transport_failure` input through to the fixture provider or invokes the fixture provider unchanged. It does not fake `runtime.invoke`, synthesize a runtime result, or claim an external backend commit.

Three cases are planned:

1. On `#/login`, mirror the app's named-input delegation by calling `updateDraft('email', typedEmail)`, then model submit payload capture from transient email/password inputs and the app's pre-dispatch password clear. Hold `Session.login`, inspect the rendered tree during busy state and after known transport failure, release the provider, test `public:retry` does not make another login call, and explicitly resubmit the approved synthetic `avery@fixture.test` fixture identity.
2. Submit an unregistered synthetic `.test` identity and let the real fixture provider return its natural `not_found` authentication rejection.
3. Use the fixture's approved `avery@fixture.test` identity as a successful login control. Password verification is absent in this fixture and is not claimed.

The script separately counts controller-visible login attempts, wrapped fixture-provider calls, login request Parts, receipt deltas, and provider state changes. Random UUID passwords exist only in process memory. The script checks state, runtime snapshot/inspection, Parts, and storage for each generated password without printing it. No provider state is changed by the known transport failure or natural auth rejection; successful fixture login changes only the local fixture session.

This is a host simulation of current delegated input, FormData payload, clear-password, controller/runtime, and render-tree behavior. It is not mounted DOM, native browser QA, or a claim that the simulated input was typed in a browser. The source-based app listener and renderer projection are recorded separately from executed tree evidence.

## Source and runner SHA-256 immediately before review

| File | SHA-256 |
|---|---|
| `probe-v1.mjs` | `cf4201968c7ab42abf756bfd37b74e8024c06fc3e0773ec0ffa95e4dc94a0304` |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.mjs` | `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2` |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs` | `f0304a33a0526dd94ba8e031986963d0c5f18e09fd101c7878194d2860c8f604` |
| `PageRouter/checkpoint/vendor/hh/src/app.mjs` | `bde60c7db3393a57c8d1936b149c7ca0181dc90bdb16f846635f4110d6b8a5c3` |
| `PageRouter/checkpoint/vendor/hh/src/public-site.mjs` | `96d930a2e6fc8c712dea5a593105071de217069d8f8313c4d531f0c4cf400ef4` |

The PageRouter repository remained clean on existing branch `codex/hh-continuous-improvement` at local head `b91b0ab0d10bf0ddeed68144ff2654e880e0401f`; no Git operation or product/source/test edit was performed.

Execution is paused until root reviews this exact script/checkpoint and authorizes the run. If the script changes, retain this version and use a new versioned script/capture set.
