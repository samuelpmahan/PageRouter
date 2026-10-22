# E1802 v2 pre-run checkpoint

Prepared 2026-10-18 20:16:00 UTC. Neither the v1 nor v2 probe has been executed. V1 files are retained byte-for-byte. H2 remains scratch-only; no PageRouter source/test/Git/build, native, Lab, or browser action has occurred.

This is a bounded pre-first-run harness repair requested after root fully reviewed v1: it replaces one unrelated setup-baseline render-count assertion with an exact immediate before/after count around the newer same-route delegated email edit. No product source, probe scenario, outcome threshold, or evidence interpretation changed. The probe's independent transport, pending-auth, provider-email, success, retry, and password-retention observations remain unchanged.

## Source findings and flow

The source/current-flow findings are unchanged and fully documented in `PRE-RUN-CHECKPOINT.md`. In brief: `app.mjs` delegates named `input` events to `controller.updateDraft`, takes a `FormData` snapshot on submit, and clears password inputs before `controller.dispatch`. Login has no email draft branch; renderer projection uses the existing session/registration identity. Controller `service` emits a busy render before the actual `Session.login` runtime/provider invocation and a completion render after `syncRuntime`. The existing runtime and fixture provider remain the real execution path; passwords are boundary-only, fixture mode is volatile-memory and does not authenticate passwords. Natural pending-account denial is `pending_denied`.

The Node probe models the source listener and captured form payload but does not mount a DOM. It executes the actual controller dispatch and actual volatile fixture runtime/provider with promise-held service calls, then inspects the actual `renderPublicSite` tree while held and after completion. Output explicitly states `mountedBrowserObserved:false` and `formDataFromMountedDom:false`. See `probe-v2.mjs` for the complete prepared flow and assertions.

## Exact planned execution and captures

- CWD: `/workspace/scratch/8528bb251845`
- Outer command: `bash hh-cycle13/H2/E1802/run-probe-v2.sh`
- Outer argv: `["bash", "hh-cycle13/H2/E1802/run-probe-v2.sh"]`
- Inner argv: `["node", "--unhandled-rejections=strict", "/workspace/scratch/8528bb251845/hh-cycle13/H2/E1802/probe-v2.mjs"]`
- No build, test suite, server, browser, network, production/provider account, or publication command is planned.

The strict v2 wrapper checks every v2 output path (including dangling symlinks) before launch, refuses overwrites, stops on `cd`/UTC-capture/permission failures before starting Node, and records a nonzero Node result without losing its actual status. Node stdout/stderr are redirected directly to separate raw files; the probe itself writes `result-v2.json` once with exclusive-create semantics. UTC start/end are written by the wrapper. A prelaunch wrapper failure creates no child output/capture and must remain a visible process failure, not be reconstructed.

Prospective original captures:

- `hh-cycle13/H2/E1802/probe-v2.stdout.raw`
- `hh-cycle13/H2/E1802/probe-v2.stderr.raw`
- `hh-cycle13/H2/E1802/probe-v2.exit` (Node child exit code; wrapper returns the same code)
- `hh-cycle13/H2/E1802/probe-v2.start.utc`
- `hh-cycle13/H2/E1802/probe-v2.end.utc`
- `hh-cycle13/H2/E1802/result-v2.json`

No post-run tool-output copying is planned. If a v2 execution fails, the v1/v2 source scripts and raw output must be preserved; corrections require a new numbered version.

## Exact v1-to-v2 changes

1. Removed `baselineRenderFrames` captured before earlier setup/dispatch operations.
2. Added `rendersBeforeNewerInput` immediately before `delegatedInput(env, 'email', newerEmail)` and `rendersAfterNewerInput` immediately after it, with no await or other event between.
3. Replaced the `baselineRenderFrames + 1` expectation with `rendersAfterNewerInput === rendersBeforeNewerInput`, asserting the rejected delegated edit itself emits zero renders. Busy/completion observations and other assertions are unchanged.
4. Versioned the structured result output from `result.json` to `result-v2.json`; all v2 stream/exit/time capture paths are separate from v1.

Key exact code delta:

```diff
- const baselineRenderFrames = env.renderFrames;
...
+ const rendersBeforeNewerInput = env.renderFrames;
  const newerInputAccepted = delegatedInput(env, 'email', newerEmail);
- const transportRenderCountDuringNewerEdit = env.renderFrames;
+ const rendersAfterNewerInput = env.renderFrames;
...
- assert.equal(transportRenderCountDuringNewerEdit, baselineRenderFrames + 1, ...);
+ assert.equal(rendersAfterNewerInput, rendersBeforeNewerInput, ...);
```

## Source and harness hashes

All current source hashes below match the initial E1802 pre-run checkpoint; no PageRouter file was edited.

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

| Versioned scratch file | SHA-256 |
| --- | --- |
| `hh-cycle13/H2/E1802/probe-v2.mjs` | `cd0a2d7729fdd757f5ca2c2d896322268bf4a5edb5b31f58e2e73dad83e9bcb0` |
| `hh-cycle13/H2/E1802/run-probe-v2.sh` | `32d54e7be336309b8ae6930a0277d86a4dd7bdae7aa1dde1b675a7a64c0c9f4f` |

No v2 run has started. Awaiting root's explicit GO after review.
