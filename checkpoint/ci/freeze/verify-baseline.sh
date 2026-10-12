#!/usr/bin/env bash
# Build this checkout with the CI target, then require the site to be
# byte-identical to the frozen baseline: same siteBuildId. Run from checkpoint/.
#
#   bash ci/freeze/verify-baseline.sh                 # build, then compare
#   SKIP_BUILD=1 bash ci/freeze/verify-baseline.sh    # compare the existing bazel-bin
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
  bash ci/bazel/run.sh
fi

read_json() { node -e 'const [f,k]=process.argv.slice(1);console.log(JSON.parse(require("fs").readFileSync(f,"utf8"))[k])' "$1" "$2"; }
expected="$(read_json ci/freeze/baseline.json siteBuildId)"
actual="$(read_json bazel-bin/site.receipt.json siteBuildId)"

echo "commit   $(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "expected $expected"
echo "actual   $actual"
if [[ "$expected" != "$actual" ]]; then
  echo "BASELINE MISMATCH: the site is not byte-identical to the frozen baseline." >&2
  echo "Per-file hashes for both sides are in bazel-bin/site.receipt.json (siteFiles)." >&2
  exit 1
fi
echo "BASELINE OK"
