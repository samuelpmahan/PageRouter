"""Prepare declared local Linux build tools and lockfile-verified npm inputs.

Only this preparation step uses the network. Bazel compile actions disable it.
Node, shell, cp and mkdir come from the host and are copied/hash-recorded; shared
system libraries remain a Linux host requirement, not a hermetic toolchain claim.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / '.bazel-tools'

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def main():
    node = Path(shutil.which('node') or '')
    expected = 'v' + (ROOT / '.nvmrc').read_text().strip()
    actual = subprocess.check_output([str(node), '--version'], text=True).strip()
    if actual != expected:
        raise SystemExit(f'Use Node {expected}; found {actual}')
    TOOLS.mkdir(exist_ok=True)
    bin_dir = TOOLS / 'bin'
    bin_dir.mkdir(exist_ok=True)
    for name in ['node', 'sh', 'cp', 'mkdir']:
        source = Path(shutil.which(name)).resolve()
        target = bin_dir / name
        if not target.exists() or digest(source) != digest(target):
            shutil.copy2(source, target)
        target.chmod(0o755)
    for name in ['package.json', 'package-lock.json']:
        shutil.copyfile(ROOT / name, TOOLS / name)
    lock_hash = digest(ROOT / 'package-lock.json')
    marker = TOOLS / 'lock.sha256'
    if not marker.exists() or marker.read_text().strip() != lock_hash or not (TOOLS / 'node_modules').is_dir():
        subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=TOOLS, check=True)
        marker.write_text(lock_hash + '\n')
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    for name in ['esbuild', 'fast-check', 'pure-rand']:
        installed = json.loads((TOOLS / 'node_modules' / name / 'package.json').read_text())
        if installed['version'] != lock['packages']['node_modules/' + name]['version']:
            raise SystemExit('Installed dependency differs from lock: ' + name)
    receipt = {'node': actual, 'lock_sha256': lock_hash,
               'tools': {f.name: digest(f) for f in sorted(bin_dir.iterdir())},
               'host_requirement': 'Linux shared libraries for the declared host executables'}
    (TOOLS / 'toolchain.json').write_text(json.dumps(receipt, sort_keys=True) + '\n')
    (TOOLS / 'WORKSPACE.bazel').write_text('workspace(name="build_tools")\n')
    (TOOLS / 'BUILD.bazel').write_text('package(default_visibility=["//visibility:public"])\nexports_files(["bin/node"])\nfilegroup(name="closure", srcs=glob(["bin/*", "node_modules/**", "toolchain.json"], exclude=["**/.bin/**"]))\n')
    print(json.dumps(receipt, sort_keys=True))

if __name__ == '__main__':
    main()
