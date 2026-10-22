# R1703 independent focused rerun — pre-execution plan

Admission: Native R1703 valid start/readback at epoch 03, GO (reported by root).

Review target: current `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs`, SHA-256 `f0304a33a0526dd94ba8e031986963d0c5f18e09fd101c7878194d2860c8f604`. Controller SHA-256 reviewed unchanged: `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2`.

Exact single focused command:

```sh
node --test --test-concurrency=2 --test-name-pattern='held profile creation keeps the live create draft through failure and explicit resubmission' checkpoint/vendor/hh/src/public-controller.test.mjs
```

The command will run from `/workspace/scratch/8528bb251845/PageRouter` and redirect raw streams and status to these paths:

- `/workspace/scratch/8528bb251845/hh-cycle12/H2/R1703/focused-01.stdout.raw`
- `/workspace/scratch/8528bb251845/hh-cycle12/H2/R1703/focused-01.stderr.raw`
- `/workspace/scratch/8528bb251845/hh-cycle12/H2/R1703/focused-01.exit`

Pre-run review decision criteria: accept if the currently corrected test passes, verifies known and unknown held failures preserve latest rendered draft, provider remains unmutated until fresh explicit resubmit, `public:retry` does not replay writes, explicit failure-path resubmit uses latest values, ordinary held success uses original submitted values captured before `await`, and ephemeral credentials are absent from controller/runtime Parts/storage. No source or Git edits; no broader suites/build/browser/backend/production tests.
