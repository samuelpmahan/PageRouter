# HH11 H1/E1601 first-run notes

## Command and provenance

The exact first-run wrapper is `first-run.sh` (SHA-256 `ee3d760b35776034296d2c44c86e878af04b7ccca21f7fe6a5d52fc820894bf1`). It runs the reviewed `probe.mjs` (SHA-256 `3d86f0b55fe774eee310ee6b98f9855ec0323195e86daeb7605c347a25096dbd`) from `/workspace/scratch/8528bb251845/PageRouter`, and captured the first raw output files without overwriting prior artifacts.

- Exit: `first.exit` contains `0` (SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`).
- Raw stdout: `first.stdout.raw`, 6,822 bytes, SHA-256 `e62effa743fe67f3bbe285edaa1d3f1d9eca6f6362289144e784a5aafba6d3d7`.
- Raw stderr: `first.stderr.raw`, 0 bytes, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

The raw result reports no generated values. The repository remained clean; no PageRouter source/test files or Git refs were changed.

## Observations

- Same-route known transport failure rendered its provider feedback on `/register`. After completion, navigating to `/login` kept the same `local-error` message above a reachable login form with an enabled submit control.
- For a held known transport failure, the script made `/login` current before release; completion then rendered the failure feedback on the actual login render tree.
- The held unknown-outcome branch behaved the same way, with the unknown-outcome provider message shown on login.
- The late success control also rendered its pending-registration success feedback on login. Thus the observed projection is consistent with route-global `journey.outcome` feedback for both success and errors, not uniquely a stale failure case.
- Each case then dispatched invalid login through the real controller: local validation feedback appeared, and the registration call count remained exactly one. The script verified the generated password was absent from retained state/runtime/Parts/storage.

## Qualification

The script's `requestStatus` and `outcomeKind` fields are sampled after the separate invalid-login local-validation control and therefore read `failed` / `validation-error`. They do not describe the preceding registration completion. The original registration result is evidenced by each `result` and `completedRoute.feedback`; the pre-validation login feedback snapshot is in `after`. No raw artifacts were edited after the run.

This was local fixture/controller/render-tree evidence only. No browser was invoked; mounted-browser reachability remains unverified. Whether route-global feedback is a defect is not established by this probe and must be judged against the intended product semantics and independent evidence.
