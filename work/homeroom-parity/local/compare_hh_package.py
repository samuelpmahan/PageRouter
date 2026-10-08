#!/usr/bin/env python3
"""Hash-compare HH source with assembled packages; read-only, no build/install."""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path

REWRITES = {
    Path('pxc-devtools/devtools-data.mjs'): (
        "'../../services/pxc.mjs'", "'../services/pxc.mjs'"),
    Path('style-playground.mjs'): (
        "'../services/style-playground.mjs'", "'./services/style-playground.mjs'"),
}


def find_checkpoint(explicit: str | None) -> Path:
    if explicit:
        candidate = Path(explicit).expanduser().resolve()
    elif os.environ.get('HH_CHECKPOINT_ROOT'):
        candidate = Path(os.environ['HH_CHECKPOINT_ROOT']).expanduser().resolve()
    else:
        cwd = Path.cwd().resolve()
        candidates = (cwd / 'work/PageRouter/checkpoint', cwd / 'checkpoint', cwd)
        candidate = next((p for p in candidates if (p / 'vendor/hh/src').is_dir()), None)
        if candidate is None:
            raise SystemExit('Cannot find PageRouter checkpoint. Pass --checkpoint PATH or set HH_CHECKPOINT_ROOT.')
    if not (candidate / 'vendor/hh/src').is_dir():
        raise SystemExit(f'Not a PageRouter checkpoint (missing vendor/hh/src): {candidate}')
    return candidate


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', help='PageRouter checkpoint root (contains vendor/hh/src)')
    args = parser.parse_args()
    root = find_checkpoint(args.checkpoint)
    sources = ((root / 'vendor/hh/src', Path('.')),
               (root / 'vendor/hh/services', Path('services')))
    packages = (('dist', root / 'dist/compiled/hh'),
                ('bazel-bin/site.site', root / 'bazel-bin/site.site/compiled/hh'))
    failed = False
    for label, destination in packages:
        if not destination.is_dir():
            print(f'{label}: MISSING {destination}')
            failed = True
            continue
        differences = []
        source_count = 0
        for source_root, target_prefix in sources:
            for source in sorted(source_root.rglob('*')):
                if not source.is_file() or source.name == 'CHECKPOINT.md':
                    continue
                source_count += 1
                rel = target_prefix / source.relative_to(source_root)
                target = destination / rel
                if not target.is_file():
                    differences.append((str(rel), 'missing package file'))
                    continue
                source_bytes = source.read_bytes()
                target_bytes = target.read_bytes()
                if rel in REWRITES:
                    old, new = REWRITES[rel]
                    source_text = source_bytes.decode('utf-8')
                    expected_count = 2 if rel.name == 'style-playground.mjs' else 1
                    if source_text.count(old) != expected_count:
                        differences.append((str(rel), 'source rewrite count differs from assembly recipe'))
                        continue
                    expected = source_text.replace(old, new).encode('utf-8')
                else:
                    expected = source_bytes
                if sha(expected) != sha(target_bytes):
                    differences.append((str(rel), f'expected={sha(expected)} actual={sha(target_bytes)}'))
        result = 'PASS' if not differences else 'DIFFERENCES'
        print(f'{label}: {result}; package={destination}; source files checked={source_count}')
        for rel, issue in differences:
            print(f'  {rel}: {issue}')
        failed |= bool(differences)
    print('Expected package-only import rewrites:')
    for rel, (old, new) in REWRITES.items():
        print(f'  {rel}: {old} -> {new}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
