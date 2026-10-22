# E1802 pre-run checkpoint

Prepared 2026-10-18 20:12:54 UTC. Probe has **not** been executed. H2 scope is scratch-only; no PageRouter source/test/Git/build, native, Lab, or browser action has occurred. The current native assignment/start for H2/E1802 was already persisted and read back by root.

## Scope and source facts

- Read `hh-cycle13/brief.txt` fully, plus `hh-cycle13/registry.json` and `hh-cycle13/spec.json`.
- Read PageRouter `SOURCE.md`, `checkpoint/README.md`, the active `.github/workflows/deploy-pages.yml`, cycle-12 README, `post-review/POST-REVIEW.md`, `NEXT.md`, `continuation.json`, and `evidence/manifest.json`. No `AGENTS.md` exists under `PageRouter/`.
- `app.mjs` attaches a delegated `input` handler to the public root. For any named target it calls `controller.updateDraft(name, value)`. Its `submit` handler constructs `new FormData(form)`, converts entries to a payload, clears password inputs for `public:login` before `controller.dispatch`, then clears again only on success.
- The current `updateDraft` rejects password/confirm fields and has no `email` branch for route `login`; it returns `false` without `onChange`. The renderer projects login email from `journey.session.email || journey.registration.identity.email || ''` and gives the login email field `name=email`.
- The controller’s login branch validates the submitted payload, calls `service('Session.login', {email, demoAccount:true}, {credentials:{password, confirmPassword:password}})`, then on success updates visible session identity and navigates. The common `service` path renders once in `busy` before `runtime.invoke`, calls `syncRuntime` after the provider result, classifies failed/outcome-unknown state, and renders completion. It sets no login retry closure.
- `createServiceRuntime` retains the real PxC/provider call path and only turns credential boundary values into a boolean; `Session.login` provider input is the email plus demo flag. Fixture mode has `passwordAuthentication:false`; a successful fixture login is not password verification. Natural denial of a pending synthetic account is `pending_denied`. No backend ambiguity is tested.
- `renderPublicSite` provides a render-tree projection only. This harness will not mount a browser or claim DOM observation. A source-equivalent helper will call the exact delegated target-to-`updateDraft` mapping, then the actual controller `dispatch`, actual volatile fixture provider through a promise-controlled wrapper, and actual render projection. The submitted email is supplied as the synthetic form’s captured FormData-equivalent payload. The decisive observations occur during the held provider request and after its completion—not just in a pre-dispatch tree.

## Exact planned execution

- CWD: `/workspace/scratch/8528bb251845`
- Outer argv: `["bash", "hh-cycle13/H2/E1802/run-probe.sh"]`
- Command: `bash hh-cycle13/H2/E1802/run-probe.sh`
- Inner argv: `["node", "--unhandled-rejections=strict", "/workspace/scratch/8528bb251845/hh-cycle13/H2/E1802/probe.mjs"]`
- No build, test suite, server, browser, network, production/provider account, or publication command is in the plan.

The runner will record actual UTC start/end in `probe.start.utc` and `probe.end.utc`. It redirects Node stdout and stderr directly into their original separate captures and writes the exit status directly; it refuses to overwrite any existing run output. The probe itself writes the structured result once with exclusive-create semantics. Planned original outputs:

- `hh-cycle13/H2/E1802/probe.stdout.raw`
- `hh-cycle13/H2/E1802/probe.stderr.raw`
- `hh-cycle13/H2/E1802/probe.exit`
- `hh-cycle13/H2/E1802/probe.start.utc`
- `hh-cycle13/H2/E1802/probe.end.utc`
- `hh-cycle13/H2/E1802/result.json`

## Prospective actual flow

1. Construct `createFixtureProvider({fixture:true})` with no storage, `createServiceRuntime({...base, services})`, the existing `createPublicController`, and `renderPublicSite`; runtime diagnostics must report `volatile-memory`.
2. Through the public controller, create/approve/login/logout one synthetic `.test` teacher to establish a previous identity. Through the actual runtime/provider port, add a second synthetic pending identity, then log back into and out of the approved identity so its email is the renderer’s fallback. No real provider or account is involved.
3. Call the exact app listener mapping with a fresh synthetic login email. Capture a random `crypto.randomUUID()` password only in memory; model the source submit payload, clear the modeled password before dispatch, and dispatch `public:login` to the actual controller.
4. The actual `Session.login` provider service wrapper signals start and holds the first attempt, then supplies the fixture-supported `transport_failure` to the original fixture port. Observe the actual `busy` render projection; while it is held, submit a same-route newer email edit through the delegated mapping and confirm the form remains enabled; release and inspect the completion projection.
5. Invoke `public:retry` and compare login call counts; explicitly resubmit the typed address as a separate controller event and capture its natural fixture result; then login to the approved synthetic prior identity as the valid success control. Finally, hold a login for the pending synthetic identity, release it naturally, and inspect `pending_denied` completion.
6. Assert provider input excludes password fields; scan retained controller state, fixture snapshot, runtime inspection/Parts, and final tree for every random password (including setup passwords). Output only synthetic nonsecret email fields/classifications and booleans; no password is included in stdout/stderr/result.

The result reports `mountedBrowserObserved:false` and `formDataFromMountedDom:false`. It will distinguish mounted-browser evidence from source/controller/render-tree evidence. An outcome is computed from the observed login-field projection after transport failure and natural pending-auth denial (`confirmed_reuse`, `mixed_change`, or `not_reuse`; otherwise an execution/assertion failure must remain visible and be reported as insufficient evidence rather than rewritten).

## Current source hashes

| Source | SHA-256 |
| --- | --- |
| `PageRouter/checkpoint/vendor/hh/src/app.mjs` | `bde60c7db3393a57c8d1936b149c7ca0181dc90bdb16f846635f4110d6b8a5c3` |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.mjs` | `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2` |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs` | `f0304a33a0526dd94ba8e031986963d0c5f18e09fd101c7878194d2860c8f604` |
| `PageRouter/checkpoint/vendor/hh/src/public-site.mjs` | `96d930a2e6fc8c712dea5a593105071de217069d8f8313c4d531f0c4cf400ef4` |
| `PageRouter/checkpoint/vendor/hh/src/public-site.test.mjs` | `87f74df3c31eca7388c701deb4ac1fd40ec874f9ce17c971582983124762b213` |
| `PageRouter/checkpoint/vendor/hh/services/runtime.mjs` | `1ce3c4510361a2b24df26a3ae09d08093757abee75a5b2ab50353d15ff58b88e` |
| `PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs` | `99807675ac53b1944c8838b3251139b62174c43f82276ef64cc919ce15e7d16d` |
| `PageRouter/checkpoint/vendor/hh/services/fixtures.mjs` | `a915f775582a6ed1cce0e92cb70de34463c2fbf40438eab3ecdcab5c412d6ff7` |
| `PageRouter/checkpoint/vendor/hh/services/contract.mjs` | `6d50ddd27ac35df190a5e3c65e5fc4e5c269ca52ae8febb1d9d332bc2597738c` |
| `PageRouter/checkpoint/vendor/hh/services/index.mjs` | `f7fade286781a86f5339cd1014247fdfc1307bea9de67d318c2b3140741b8838` |

## Prepared harness hashes

| Scratch-only file | SHA-256 |
| --- | --- |
| `hh-cycle13/H2/E1802/probe.mjs` | `7e240b693ee14d7099d41d6ff1bafa020b72e1fee9b6b832663908991cc76b7d` |
| `hh-cycle13/H2/E1802/run-probe.sh` | `e0663f707eee9b05fd9ed807e6cf555adc8582828b524f2fab16fe326e08068a` |
