#!/usr/bin/env python3
"""Materialize declared original media from exact Drive IDs via root_sync's queue."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from root_sync import call

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--queue', required=True)
    parser.add_argument('--fresh', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    local = Path(manifest['localDirectory'])
    parts_dir = out.parent / 'original-parts'
    if args.fresh:
        parts_dir.mkdir(exist_ok=True)
    parts = []
    for part in manifest['parts']:
        path = (parts_dir if args.fresh else local) / part['name']
        if args.fresh and not path.exists():
            call(args.queue, 'download', manifest['remoteFolderId'],
                 remoteId=part['driveId'], destination=str(path),
                 expectedSha256=part['sha256'], purpose='original-input')
        if not path.is_file() or path.stat().st_size != part['bytes'] or sha(path) != part['sha256']:
            raise RuntimeError(f'Original source part differs from binding: {part["name"]}')
        parts.append(path)
    if out.is_file() and out.stat().st_size == manifest['bytes'] and sha(out) == manifest['sha256']:
        print(json.dumps({'source': str(out), 'sha256': manifest['sha256'], 'mode': 'VERIFIED_REUSE', 'freshRemote': args.fresh}))
        return
    temp = out.with_name(out.name + '.incomplete')
    with temp.open('xb') as target:
        for path in parts:
            with path.open('rb') as source:
                for block in iter(lambda: source.read(1 << 20), b''):
                    target.write(block)
    if temp.stat().st_size != manifest['bytes'] or sha(temp) != manifest['sha256']:
        raise RuntimeError('Assembled original source hash mismatch')
    os.replace(temp, out)
    print(json.dumps({'source': str(out), 'sha256': manifest['sha256'], 'mode': 'ASSEMBLED', 'freshRemote': args.fresh}))

if __name__ == '__main__':
    main()
