#!/usr/bin/env bash
# Build this checkout with the CI target, then prove the site matches the
# frozen baseline apart from build clocks. Run from checkpoint/.
#
#   bash ci/freeze/verify-baseline.sh            # build, then compare
#   SKIP_BUILD=1 bash ci/freeze/verify-baseline.sh   # compare existing bazel-bin
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
  bash ci/bazel/run.sh
fi

expected="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("ci/freeze/baseline.json","utf8")).stableDigest)')"
report="$(node ci/freeze/stable-digest.mjs bazel-bin/site.site)"
actual="$(node -e 'console.log(JSON.parse(process.argv[1]).stableDigest)' "$report")"

echo "commit   $(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "expected $expected"
echo "actual   $actual"
if [[ "$expected" != "$actual" ]]; then
  echo "BASELINE MISMATCH: the site differs from the frozen baseline beyond build clocks." >&2
  echo "List differing files: node ci/freeze/stable-digest.mjs bazel-bin/site.site --files" >&2
  exit 1
fi
echo "BASELINE OK"
