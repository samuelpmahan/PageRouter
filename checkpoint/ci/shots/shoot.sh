#!/usr/bin/env bash
# Call a shot, then grade it. Run from checkpoint/.
#
#   bash ci/shots/shoot.sh call  SHOT.json
#       Validates the shot, copies it to ci/shots/called/<id>.shot.json and
#       appends its sha256 and the time to ci/shots/called/events.jsonl.
#       Do this before making the change: an unlogged shot is never made.
#
#   bash ci/shots/shoot.sh grade ci/shots/called/<id>.shot.json BASE_COMMIT
#       Builds BASE_COMMIT and the working tree with the CI Bazel target,
#       grades the shot, prints the report and writes called/<id>.grade.json.
#       BASE_COMMIT must have the declared build clock (7d0f607 or later), or
#       site clauses will see clock bytes as changes.
set -euo pipefail
CHECKPOINT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHOTS="$CHECKPOINT/ci/shots"
REPO="$(git -C "$CHECKPOINT" rev-parse --show-toplevel)"
cd "$CHECKPOINT"
[[ -d "$SHOTS/node_modules" ]] || (cd "$SHOTS" && npm ci --no-audit --no-fund)

case "${1:-}" in
  call)
    shot="$2"
    id="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id)' "$shot")"
    node --input-type=module -e '
      import {validateShot} from "./ci/shots/grade.mjs";
      import fs from "node:fs";
      const problems = validateShot(JSON.parse(fs.readFileSync(process.argv[1], "utf8")));
      if (problems.length) { console.error(problems.join("\n")); process.exit(1); }' "$shot"
    target="$SHOTS/called/$id.shot.json"
    [[ "$(cd "$(dirname "$shot")" && pwd)/$(basename "$shot")" == "$target" ]] || cp "$shot" "$target"
    digest="$(node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$target")"
    printf '{"event":"shot.called","shot":"%s","sha256":"%s","at":"%s"}\n' "$id" "$digest" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$SHOTS/called/events.jsonl"
    echo "called $id ($digest)"
    ;;
  grade)
    shot="$2"; base="$3"
    id="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id)' "$shot")"
    work="$(mktemp -d "${TMPDIR:-/tmp}/shot-$id-XXXXXX")"
    git -C "$REPO" archive --prefix=base/ "$base" | tar -x -C "$work"
    (cd "$work/base/checkpoint" && PAGEROUTER_BAZEL_OUTPUT_ROOT="$work/out-base" bash ci/bazel/run.sh)
    cp -r "$(readlink -f "$work/base/checkpoint/bazel-bin")/site.site" "$work/base-site"
    PAGEROUTER_BAZEL_OUTPUT_ROOT="$work/out-candidate" bash ci/bazel/run.sh
    cp -r "$(readlink -f bazel-bin)/site.site" "$work/candidate-site"
    node "$SHOTS/grade.mjs" --shot "$shot" --baseline "$work/base" --candidate "$REPO" \
      --baseline-site "$work/base-site" --candidate-site "$work/candidate-site" \
      --events "$SHOTS/called/events.jsonl" --json "$SHOTS/called/$id.grade.json"
    ;;
  *)
    sed -n '2,13p' "$0"; exit 2 ;;
esac
