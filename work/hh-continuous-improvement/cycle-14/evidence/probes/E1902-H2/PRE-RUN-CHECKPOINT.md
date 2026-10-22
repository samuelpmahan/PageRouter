# E1902 / H2 pre-run checkpoint

Prepared after native epoch 00 assigned and persisted H2/E1902. Probe has not run. H2 scope is scratch-only; no PageRouter source/test/Git/build, native, separate lab, or browser action is authorized or performed.

## Frozen question and expected result

One bounded success-path probe: during a held `Session.login` for submitted identity A, update the reachable login email draft to a distinct synthetic identity B, navigate away and reenter the login route before releasing the provider call, then observe authority, draft, route projection, provider call counts, and credential absence.

Prediction from current controller semantics: successful explicit login authenticates the submitted A identity and clears the newer draft B as part of the authority change. Route reentry increments the route epoch, so completion should not auto-redirect; the login tree should project the authenticated session identity A. Exactly one explicit `Session.login` provider call should occur, with no automatic registration/profile write/retry. Password must be absent from controller state, runtime snapshot/inspect, actual Parts, volatile storage, and rendered virtual tree.

Falsifier: the successful completion fails to authenticate A; preserves B as the active login draft/projection after authority becomes A; redirects despite route reentry; causes any extra provider call; or any inspected actual surface retains the random password. This is not a presumed defect: clearing B in favor of the newly authenticated A may be the correct policy.

## Frozen source and artifact pins

PageRouter branch `codex/hh-continuous-improvement`, HEAD `06b6da36e326758ccd14cda021bc0a15cfd00817`, tree `eb7136f80b1bdfd08c771f519a626a1e508bb1a9`. Existing untracked `PageRouter/hh-cycle13/` is preserved and out of scope.

| File | SHA-256 |
|---|---|
| `PageRouter/checkpoint/vendor/hh/src/public-controller.mjs` | `308c876e8bbfeb20a3e8ee92a4065549f5ca815bec0aa6979bf39c61fa4dc07c` |
| `PageRouter/checkpoint/vendor/hh/src/public-site.mjs` | `5f1135c95fdb3baefb64e49d755e45a87b9eb1b17ff363ed91eb5b516812031b` |
| `PageRouter/checkpoint/vendor/hh/src/app.mjs` | `bde60c7db3393a57c8d1936b149c7ca0181dc90bdb16f846635f4110d6b8a5c3` |
| `PageRouter/checkpoint/vendor/hh/services/runtime.mjs` | `1ce3c4510361a2b24df26a3ae09d08093757abee75a5b2ab50353d15ff58b88e` |
| `PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs` | `99807675ac53b1944c8838b3251139b62174c43f82276ef64cc919ce15e7d16d` |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs` | `f426710f6ae9c3012f5eba2aa0d50b3aaca8b4e76a4119dd3ffca58d08e13d4f` |
| `probe.mjs` | `6b8f640b0031ee0c4c62df7baed4b360dcf912445118f594c245ec4afcea1618` |
| `run-probe.sh` | `96bef8f9757ab0a6d8adfebbea5a2d962efe9493b7c15bd7cb452efcb3cf5f19` |

## One-run command and captures

Outer argv: `["bash", "hh-cycle14/H2/E1902/run-probe.sh"]` from `/workspace/scratch/8528bb251845`.

Inner argv: `["node", "--unhandled-rejections=strict", "/workspace/scratch/8528bb251845/hh-cycle14/H2/E1902/probe.mjs"]` from `/workspace/scratch/8528bb251845/hh-cycle14/H2/E1902`.

The single invocation prospectively captures original stdout, stderr, exit, UTC start, and UTC end to `probe.stdout.raw`, `probe.stderr.raw`, `probe.exit`, `probe.start.utc`, and `probe.end.utc`. `result.json` will be an exact byte copy of stdout only after successful completion. A first unexpected harness/assertion failure is preserved and stops this task; no retry or silent overwrite.

Probe is limited to a volatile in-memory provider fixture. Emails are synthetic fixture values; password is random and process-memory-only. No real account/backend/provider/Python/production service, mounted DOM, browser, or external write is used. Behavior is reached through the existing controller's source-equivalent delegated input (`updateDraft`), actual rendered virtual login form, and actual `public:login` controller dispatch. This does not claim mounted-DOM reachability.
