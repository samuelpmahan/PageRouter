#!/usr/bin/env bash
set -o noclobber
cd /workspace/scratch/8528bb251845/PageRouter
node /workspace/scratch/8528bb251845/hh-cycle11/H1/E1601/probe.mjs \
  > /workspace/scratch/8528bb251845/hh-cycle11/H1/E1601/first.stdout.raw \
  2> /workspace/scratch/8528bb251845/hh-cycle11/H1/E1601/first.stderr.raw
run_status=$?
printf '%s\n' "$run_status" > /workspace/scratch/8528bb251845/hh-cycle11/H1/E1601/first.exit
exit "$run_status"
