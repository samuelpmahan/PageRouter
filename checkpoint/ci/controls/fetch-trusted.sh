#!/usr/bin/env bash
# Fetch the trusted libraries whose own tests are the controls, pinned exactly.
#   bash ci/controls/fetch-trusted.sh [dir]     (default: $TMPDIR/pagerouter-trusted)
set -euo pipefail
dir="${1:-${TMPDIR:-/tmp}/pagerouter-trusted}"
mkdir -p "$dir" && cd "$dir"
repo() { # name url commit
  if [[ "$(git -C "$1" rev-parse HEAD 2>/dev/null)" != "$3" ]]; then
    rm -rf "$1" && git init -q "$1" && git -C "$1" fetch -q --depth 1 "$2" "$3" && git -C "$1" checkout -q FETCH_HEAD
  fi
  echo "$1 $(git -C "$1" rev-parse HEAD)"
}
pkg() { # name@version sha256 dir
  mkdir -p "$3"
  if [[ ! -f "$3/package/package.json" ]]; then
    (cd "$3" && npm pack "$1" --silent >/dev/null && tgz=$(ls *.tgz) && echo "$2  $tgz" | sha256sum --check --quiet && tar -xzf "$tgz")
  fi
  echo "$1 $(cd "$3" && sha256sum *.tgz | cut -c1-64)"
}
repo json-canonicalization https://github.com/cyberphone/json-canonicalization 32a48195b9b20fe67b1795e39e4509f14d860b45  # RFC 8785 reference vectors
repo canonicalize https://github.com/erdtman/canonicalize 31fb117afde3ef305b2e1d99bde539bf6300bc62                    # canonicalize 5.1.0, an RFC 8785 implementation
repo escape-html https://github.com/component/escape-html b42947eefa79efff01b3fe988c4c7e7b051ec8d8                     # escape-html 1.0.3
repo fast-deep-equal https://github.com/epoberezkin/fast-deep-equal a8e7172b6c411ec320d6045fd4afbd2abc1b4bde            # its spec tables
pkg fast-deep-equal@3.1.3 b019a0980f27638dc3f85836b0e478f188e00d7a6e5852c0819fa86f56e47b8f fde-pkg                      # the built library
pkg deep-freeze@0.0.1 8114a49a3e2bc05b612b45248faa07e82efd7da58bb1234fea488c02ebc2bb3d df                                # its own test needs `tap`
echo "trusted libraries in $dir"
