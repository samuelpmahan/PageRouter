#!/usr/bin/env python3
"""Read-only comparison of Bazel site receipt hashes to current sources."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', help='PageRouter checkpoint root (contains vendor/hh/src)')
    args = parser.parse_args()
    root = find_checkpoint(args.checkpoint)
    receipt = root / 'bazel-bin/site.receipt.json'
    if not receipt.is_file():
        print(json.dumps({'receipt': str(receipt), 'status': 'UNVERIFIED_MISSING_RECEIPT',
                          'reason': 'No Bazel receipt exists; source freshness was not checked.'}, indent=2))
        return 2
    receipt_data = json.loads(receipt.read_text(encoding='utf-8'))
    changed, missing = [], []
    rows = receipt_data.get('sourceInputs', [])
    for row in rows:
        path = root / row['path']
        if not path.is_file():
            missing.append(row['path'])
            continue
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if len(data) != row['bytes'] or digest != row['sha256']:
            changed.append({'path': row['path'], 'receipt_bytes': row['bytes'],
                            'current_bytes': len(data), 'receipt_sha256': row['sha256'],
                            'current_sha256': digest})
    print(json.dumps({'receipt': str(receipt), 'source_inputs': len(rows),
                      'changed': changed, 'missing': missing,
                      'status': 'CURRENT' if not changed and not missing else 'STALE'}, indent=2))
    return 1 if changed or missing else 0


if __name__ == '__main__':
    raise SystemExit(main())
