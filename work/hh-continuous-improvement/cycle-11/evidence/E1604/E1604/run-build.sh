#!/usr/bin/env bash
set -u
set -o noclobber
cd /workspace/scratch/8528bb251845/PageRouter/checkpoint
date -u +%Y-%m-%dT%H:%M:%SZ > /workspace/scratch/8528bb251845/hh-cycle11/H1/E1604/build.start.utc || exit 125
BAZEL=/workspace/scratch/8528bb251845/tools/bazel bash ci/bazel/run.sh \
  > /workspace/scratch/8528bb251845/hh-cycle11/H1/E1604/build.stdout.raw \
  2> /workspace/scratch/8528bb251845/hh-cycle11/H1/E1604/build.stderr.raw
build_status=$?
date -u +%Y-%m-%dT%H:%M:%SZ > /workspace/scratch/8528bb251845/hh-cycle11/H1/E1604/build.end.utc || exit 125
printf '%s\n' "$build_status" > /workspace/scratch/8528bb251845/hh-cycle11/H1/E1604/build.exit || exit 125
printf '%s\n' "$build_status" > /workspace/scratch/8528bb251845/hh-cycle11/H1/E1604/wrapper.exit || exit 125
exit "$build_status"
