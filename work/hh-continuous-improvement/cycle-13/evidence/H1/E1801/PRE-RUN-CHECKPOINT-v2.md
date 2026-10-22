# HHcycle13 H1 / E1801 pre-run checkpoint — runner v2

Status: root reviewed v1 and requested two bounded construction amendments. This v2 runner is not executed; execution is paused for root's exact-runner GO.

## Proposed command and fresh original capture paths

- CWD: `/workspace/scratch/8528bb251845/hh-cycle13/H1/E1801`
- Executable and exact argv: `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ./probe-v2.mjs`
- UTC plan time: `2026-10-18 20:12:44 UTC`
- Fresh original stdout stream: `stdout-v2.raw` (distinct from v1; must be absent before execution)
- Fresh original stderr stream: `stderr-v2.raw` (distinct from v1; must be absent before execution)
- Fresh original exit status: `exit-v2.txt` (distinct from v1; must be absent before execution)
- Planned shell invocation (writes each stream directly; no post-run reconstruction):

  ```sh
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ./probe-v2.mjs > ./stdout-v2.raw 2> ./stderr-v2.raw
  probe_exit=$?
  printf '%s\n' "$probe_exit" > ./exit-v2.txt
  ```

The existing v1 script/checkpoint and any v1 captures are not overwritten. V2 uses new filenames for script and captures. Before execution, confirm all three v2 capture paths are absent; do not use `>` if any is already present.

## V2 amendments from root's review

1. V1 remains unchanged. V2 binds the second explicit-resubmission UUID password to `secondSecret` and verifies both generated passwords are absent from actual retained surfaces: controller state, runtime snapshot/inspection, Parts, and in-memory storage.
2. Receipt deltas are named `allRuntimeReceiptDelta...` / `allRuntimeReceiptDelta`, because the successful login can navigate to `/profile` and cause unrelated read receipts. Login request-Part counts remain separately filtered by login-shaped request input. No assertions or test thresholds were broadened.

## Scope and concrete flow

The script uses the current `createFixtureProvider`, `createServiceRuntime`, `createPublicController`, `createCommunity`, and `renderPublicSite` seams with in-memory volatile storage. A wrapper around the actual fixture provider's `Session.login` service holds each call until explicitly released, then passes supported `transport_failure` input through to the fixture provider or invokes the fixture provider unchanged. It does not fake `runtime.invoke`, synthesize a runtime result, or claim an external backend commit.

Three cases are planned:

1. On `#/login`, mirror the app's named-input delegation by calling `updateDraft('email', typedEmail)`, then model submit payload capture with Node's `FormData` API from transient email/password inputs and the app's pre-dispatch password clear. Hold `Session.login`, inspect the rendered tree during busy state and after known transport failure, release the provider, test `public:retry` does not make another login call, and explicitly resubmit the approved synthetic `avery@fixture.test` fixture identity.
2. Submit an unregistered synthetic `.test` identity and let the real fixture provider return its natural `not_found` authentication rejection.
3. Use the fixture's approved `avery@fixture.test` identity as a successful login control. Password verification is absent in this fixture and is not claimed.

The script separately counts controller-visible login attempts, wrapped fixture-provider calls, login request Parts, all runtime receipt deltas, and provider state changes. Random UUID passwords exist only in process memory. The script checks each generated password against state, runtime snapshot/inspection, Parts, and storage without printing any password. No provider state is changed by the known transport failure or natural auth rejection; successful fixture login changes only the local fixture session.

This is a host simulation of current delegated input, FormData payload, clear-password, controller/runtime, and render-tree behavior. It is not mounted DOM, native browser QA, or a claim that the simulated input was typed in a browser. The source-based app listener and renderer projection are recorded separately from executed tree evidence.

## Source and runner SHA-256 immediately before review

| File | SHA-256 |
|---|---|
| `probe-v2.mjs` | `27686af3136c0bd4983d0b67553aed5dd268fa2254c8fe76b5cdec10e9f7fbe4` |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.mjs` | `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2` |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs` | `f0304a33a0526dd94ba8e031986963d0c5f18e09fd101c7878194d2860c8f604` |
| `PageRouter/checkpoint/vendor/hh/src/app.mjs` | `bde60c7db3393a57c8d1936b149c7ca0181dc90bdb16f846635f4110d6b8a5c3` |
| `PageRouter/checkpoint/vendor/hh/src/public-site.mjs` | `96d930a2e6fc8c712dea5a593105071de217069d8f8313c4d531f0c4cf400ef4` |

PageRouter remains clean on existing branch `codex/hh-continuous-improvement` at local head `b91b0ab0d10bf0ddeed68144ff2654e880e0401f`. No source/test edits, Git operations, build, browser attempt, native write, or execution of v1/v2 occurred.
