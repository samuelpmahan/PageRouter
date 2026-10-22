# H2 R1803 review checkpoint

Prepared before running the H2 adversarial probe. H2 is independent review only; no product source, test, Git, build, native, Lab, browser, backend, or account changes/actions are included.

## Frozen source bindings

| Source | SHA-256 |
| --- | --- |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.mjs` | `308c876e8bbfeb20a3e8ee92a4065549f5ca815bec0aa6979bf39c61fa4dc07c` |
| `PageRouter/checkpoint/vendor/hh/src/public-site.mjs` | `5f1135c95fdb3baefb64e49d755e45a87b9eb1b17ff363ed91eb5b516812031b` |
| `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs` | `f426710f6ae9c3012f5eba2aa0d50b3aaca8b4e76a4119dd3ffca58d08e13d4f` |

These exact current files are the only product/test sources in H2's review binding. `app.mjs` was read for flow interpretation but is not an additional validation binding.

Capture provenance correction: the H1 RED-01 originals are in root `hh-cycle13/H1/E1803-PROPOSAL/`. The original focused green captures were created under `PageRouter/hh-cycle13/H1/E1803-PROPOSAL/` and byte-copied with verified hashes into `hh-cycle13/H1/E1803-ORIGINAL-CAPTURES/`. The newline-altered duplicate stderr files described by the H1 erratum are excluded.

## Source flow traced

`app.mjs` delegates non-secret named input events to `controller.updateDraft(name, value)`. The form submit handler validates the mounted form, copies `FormData` into a transient payload, clears password inputs, and awaits `controller.dispatch`. The controller rejects invalid login credentials locally before a service call. For valid login it calls `service('Session.login', ...)`; service sets busy and notifies before runtime invocation, then syncs runtime state, sets success/error status, and notifies before returning to the login handler. The login handler clears the email draft only after success; on failure it leaves it intact. It navigates to profile only if the route epoch has not changed during the request. Thus a route-away/back completion can be especially important: handler state may clear after the service's final render notification, while the current route is still login.

On ordinary same-route renders, `app.mjs` snapshots password inputs synchronously from DOM and restores them after replacing children. Password fields are not `updateDraft` state. The Node probes below do not mount a DOM; they model the delegated input and form-payload snapshot, and inspect the actual renderer tree/controller/runtime/storage.

## Already-executed focused named test

The admitted focused rerun was executed once with cwd `/workspace/scratch/8528bb251845/PageRouter/checkpoint`:

```text
node --test --test-name-pattern='login draft' vendor/hh/src/public-controller.test.mjs
```

Direct original streams, exit, and UTC captures are:

- `hh-cycle13/H2/R1803/focused-login-draft.stdout.raw`
- `hh-cycle13/H2/R1803/focused-login-draft.stderr.raw`
- `hh-cycle13/H2/R1803/focused-login-draft.exit`
- `hh-cycle13/H2/R1803/focused-login-draft.start.utc`
- `hh-cycle13/H2/R1803/focused-login-draft.end.utc`

No post-run tool-output copying was used. The recorded actual process exit is `0`; both focused login-draft tests passed.

## Proposed adversarial probe; not yet executed

One volatile fixture-provider probe will exercise only current controller/runtime/renderer source. Exact script: `hh-cycle13/H2/R1803/adversarial-login-projection.mjs` (SHA-256 is recorded before execution below). Exact outer argv:

```text
["bash", "/workspace/scratch/8528bb251845/hh-cycle13/H2/R1803/run-adversarial-login-projection.sh"]
```

Exact inner argv:

```text
["node", "--unhandled-rejections=strict", "/workspace/scratch/8528bb251845/hh-cycle13/H2/R1803/adversarial-login-projection.mjs"]
```

The script holds the actual `Session.login` service boundary in memory while allowing the original fixture provider/runtime to handle both invocations. Its first actual fixture invocation returns `outcome_unknown`; it observes a newer delegated email edit, navigation away/back, current email projection, and `public:retry` without another provider call. It then submits an explicitly blank email/password to exercise local validation and checks that no provider login is added. Its final actual fixture invocation uses the existing synthetic `avery@fixture.test` fixture account; while held, it navigates away/back before success, then records controller draft-clearing and the final renderer projection to test whether a notification occurs after the handler clears state. Ephemeral password values are generated in process memory only; they are never printed or written into observed state/logs. Assertions include absence of those values from state/runtime/inspect/PxC/storage/tree surfaces and expected fixture-only session success. This makes no real-password or backend claim.

No mounted browser or DOM behavior is claimed. The named focused-test run has already happened, but the adversarial probe has not started. If admitted after root review, direct original captures will be created only once at these absolute paths:

- `/workspace/scratch/8528bb251845/hh-cycle13/H2/R1803/adversarial-login-projection.stdout.raw`
- `/workspace/scratch/8528bb251845/hh-cycle13/H2/R1803/adversarial-login-projection.stderr.raw`
- `/workspace/scratch/8528bb251845/hh-cycle13/H2/R1803/adversarial-login-projection.exit`
- `/workspace/scratch/8528bb251845/hh-cycle13/H2/R1803/adversarial-login-projection.start.utc`
- `/workspace/scratch/8528bb251845/hh-cycle13/H2/R1803/adversarial-login-projection.end.utc`

The wrapper refuses existing paths including dangling symlinks, uses strict shell behavior, records the actual child exit even on expected nonzero status, and does not launch the child if the prelaunch UTC capture fails. Any run failure is retained and is not overwritten or retried.

Pre-execution hashes:

| File | SHA-256 |
| --- | --- |
| `adversarial-login-projection.mjs` | `6de8fc8099c232db411406ad63716f772c6bcd168b8967510d0167ac141f2d75` |
| `run-adversarial-login-projection.sh` | `4a3ffa6393e73b7985f8e50295572e92dbe41db9b19cfaa470398f9bb5996eed` |
