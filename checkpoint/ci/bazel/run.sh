#!/usr/bin/env bash
set -euo pipefail
BUILD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BUILD_ROOT"
python3 ci/bazel/bootstrap.py
BAZEL_COMMAND="${BAZEL:-bazel}"
EXPECTED_BAZEL="$(cat .bazelversion)"
ACTUAL_BAZEL="$("$BAZEL_COMMAND" --version)"
if [[ "$ACTUAL_BAZEL" != "bazel $EXPECTED_BAZEL" ]]; then
  echo "Use Bazel $EXPECTED_BAZEL; found $ACTUAL_BAZEL" >&2
  exit 1
fi
node --test --test-concurrency=2 ci/bazel/build-helpers.test.mjs
"$BAZEL_COMMAND" --batch --output_user_root="${PAGEROUTER_BAZEL_OUTPUT_ROOT:-${TMPDIR:-/tmp}/pagerouter-bazel-${UID}}" build //:site
node ci/bazel/verify-output.mjs bazel-bin/site.site bazel-bin/site.receipt.json
