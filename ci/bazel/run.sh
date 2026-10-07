#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export PYTHONDONTWRITEBYTECODE=1
python3 ci/bazel/bootstrap.py
BAZEL="$ROOT/.bootstrap/bazel"
COMMON=(--enable_bzlmod=false --spawn_strategy=sandboxed --sandbox_default_allow_network=false)
"$BAZEL" --batch --output_user_root="$ROOT/.bazel-cache" build "${COMMON[@]}" //:pagerouter_site
"$BAZEL" --batch --output_user_root="$ROOT/.bazel-cache" test "${COMMON[@]}" --test_output=errors --nocache_test_results //:pagerouter_verify
mkdir -p verification
python3 ci/bazel/verify_outputs.py --site bazel-bin/pagerouter_site.site --receipt bazel-bin/pagerouter_site.receipt.json > verification/output-validation.json
cat verification/output-validation.json
python3 ci/bazel/run_observation.py
