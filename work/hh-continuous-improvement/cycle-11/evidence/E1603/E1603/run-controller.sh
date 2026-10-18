#!/usr/bin/env bash
set -o noclobber
cd /workspace/scratch/8528bb251845/PageRouter
node --test --test-concurrency=2 checkpoint/vendor/hh/src/public-controller.test.mjs \
  > /workspace/scratch/8528bb251845/hh-cycle11/H1/E1603/controller.stdout.raw \
  2> /workspace/scratch/8528bb251845/hh-cycle11/H1/E1603/controller.stderr.raw
run_status=$?
printf '%s\n' "$run_status" > /workspace/scratch/8528bb251845/hh-cycle11/H1/E1603/controller.exit
exit "$run_status"
