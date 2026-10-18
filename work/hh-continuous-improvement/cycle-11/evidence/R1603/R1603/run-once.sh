#!/usr/bin/env bash
set -o noclobber
cd /workspace/scratch/8528bb251845/PageRouter
node --test --test-concurrency=2 --test-name-pattern='held registration completion on login preserves transaction classification without replay' checkpoint/vendor/hh/src/public-controller.test.mjs \
  > /workspace/scratch/8528bb251845/hh-cycle11/H2/R1603/focused.stdout.raw \
  2> /workspace/scratch/8528bb251845/hh-cycle11/H2/R1603/focused.stderr.raw
run_status=$?
printf '%s\n' "$run_status" > /workspace/scratch/8528bb251845/hh-cycle11/H2/R1603/focused.exit
exit "$run_status"
