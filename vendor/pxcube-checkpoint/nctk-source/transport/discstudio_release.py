#!/usr/bin/env python3
"""LocalCI: build and verify a DiscStudio Pages ZIP from canonical nctk source."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import zipfile
from root_sync import call, extract_checked, sha

ITEM = 'recipes/discstudio-photo-card.json'
NAMESPACE = 'localci.discstudio-pages@1'

def make_archive(dist: Path, archive: Path):
    if dist.is_symlink() or not dist.is_dir():
        raise RuntimeError('canonical dist must be a real directory')
    files = []
    for path in sorted(dist.rglob('*')):
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise RuntimeError(f'unsafe dist entry: {path}')
        if stat.S_ISREG(mode):
            files.append(path)
    if not files or not (dist / 'BUILD_INFO.json').is_file():
        raise RuntimeError('canonical build output is missing BUILD_INFO.json')
    with zipfile.ZipFile(archive, 'w') as output:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(dist).as_posix(), (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    return {p.relative_to(dist).as_posix(): sha(p) for p in files}

def verify_archive(archive: Path, dist: Path, extracted: Path):
    expected = {p.relative_to(dist).as_posix(): sha(p) for p in dist.rglob('*') if p.is_file()}
    actual = {name: info['sha256'] for name, info in extract_checked(archive, extracted).items()}
    if actual != expected or not (extracted / 'index.html').is_file() or not (extracted / '.nojekyll').is_file():
        raise RuntimeError('Pages archive differs from canonical dist')
    info = json.loads((extracted / 'BUILD_INFO.json').read_text())
    if info.get('artifact') != 'discstudio-tournament-pages' or info.get('static') is not True or not info.get('buildId'):
        raise RuntimeError('invalid BUILD_INFO.json')
    return expected, info

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', default=str(Path(__file__).resolve().parents[1]))
    ap.add_argument('--out', required=True, help='new durable local output directory, outside canonical source')
    ap.add_argument('--folder', help='Drive folder ID; omit to leave an explicit pending bridge')
    ap.add_argument('--queue', help='existing connected-agent Drive queue path')
    ap.add_argument('--queue-timeout', type=int, default=30)
    ap.add_argument('--test-timeout', type=int, default=600)
    a = ap.parse_args()
    root = Path(a.root).resolve()
    app = root / 'vendor/discstudio/disc'
    out = Path(a.out).absolute()
    if out.exists() or out.is_relative_to(root):
        raise RuntimeError('out must be a new directory outside canonical source')
    out.mkdir(parents=True)
    commands = [['node', str(root / 'transport/validate_directory_tree.mjs'), str(root)],
                ['npm', 'ci'], ['npm', 'test'], ['npm', 'run', 'test:capture'], ['npm', 'run', 'build']]
    checks = []
    for command in commands:
        process = subprocess.run(command, cwd=root if command[0] == 'node' else app, capture_output=True, text=True, timeout=a.test_timeout)
        checks.append({'command': shlex.join(command), 'exitCode': process.returncode,
                       'stdoutTail': process.stdout[-4000:], 'stderrTail': process.stderr[-4000:]})
        if process.returncode:
            break
    archive = out / 'pages-artifact.zip'
    receipt = {'schema': 'localci-discstudio-pages-release@1',
               'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'workItem': ITEM, 'namespace': NAMESPACE, 'sourceRoot': str(root),
               'checks': checks, 'verdict': 'PASS' if len(checks) == len(commands) and all(c['exitCode'] == 0 for c in checks) else 'FAIL',
               'bridge': {'status': 'PENDING', 'folder': a.folder}}
    if receipt['verdict'] == 'PASS':
        make_archive(app / 'dist', archive)
        hashes, info = verify_archive(archive, app / 'dist', out / 'extracted')
        receipt.update({'archive': str(archive), 'archiveSha256': sha(archive),
                        'buildInfo': info, 'fileCount': len(hashes), 'files': hashes,
                        'extracted': str(out / 'extracted')})
    rp = out / 'release-receipt.json'
    rp.write_text(json.dumps(receipt, indent=2) + '\n')
    if a.folder and receipt['verdict'] == 'PASS':
        queue = a.queue or str(root / 'transport/queue')
        try:
            result = call(queue, 'upload', a.folder, timeout=a.queue_timeout,
                          name=archive.name, local=str(archive), size=archive.stat().st_size,
                          sha256=receipt['archiveSha256'], purpose='localci-discstudio-pages-release')
            receipt['bridge'] = {'status': 'UPLOADED', 'folder': a.folder, 'archiveId': result['remoteId']}
            rp.write_text(json.dumps(receipt, indent=2) + '\n')
            proof = call(queue, 'upload', a.folder, timeout=a.queue_timeout,
                         name=rp.name, local=str(rp), size=rp.stat().st_size,
                         sha256=sha(rp), purpose='localci-discstudio-pages-receipt')
            (out / 'bridge-result.json').write_text(json.dumps({
                'archiveId': result['remoteId'], 'receiptId': proof['remoteId'],
                'receiptSha256': sha(rp)}, indent=2) + '\n')
        except (TimeoutError, RuntimeError) as error:
            receipt['bridge'] = {**receipt['bridge'], 'status': 'PENDING', 'reason': str(error), 'queue': queue}
            rp.write_text(json.dumps(receipt, indent=2) + '\n')
    observer = root / 'transport/record_localci_observation.mjs'
    subprocess.run(['node', str(observer), str(root), str(rp)], check=True)
    print(json.dumps({'verdict': receipt['verdict'], 'receipt': str(rp),
                      'archive': receipt.get('archive'), 'archiveSha256': receipt.get('archiveSha256'),
                      'bridge': receipt['bridge']}, indent=2))
    return 0 if receipt['verdict'] == 'PASS' else 1

if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(f'LocalCI DiscStudio release failed: {error}', file=sys.stderr)
        raise SystemExit(2)
