"""Pinned Linux tool acquisition. Network is permitted here, never in build actions."""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / ".bootstrap"
NODE_VERSION = "24.21.0"
NODE_SHA = "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"
BAZEL_SHA = "c97f02133adce63f0c28678ac1f21d65fa8255c80429b588aeeba8a1fac6202b"
BUSYBOX_SHA = "6e123e7f3202a8c1e9b1f94d8941580a25135382b99e8d3e34fb858bba311348"

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def acquire(name, url, expected, override):
    target = BASE / name
    if target.exists() and digest(target) == expected:
        return target
    if os.environ.get(override):
        shutil.copyfile(os.environ[override], target)
    else:
        with urllib.request.urlopen(url, timeout=120) as response, target.open("wb") as output:
            shutil.copyfileobj(response, output)
    if digest(target) != expected:
        target.unlink()
        raise SystemExit("Downloaded identity mismatch: " + name)
    return target

def main():
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise SystemExit("This pinned recipe requires Linux x86_64")
    if platform.python_version() != "3.14.4":
        raise SystemExit("Bootstrap requires the workflow-pinned Python 3.14.4")
    BASE.mkdir(exist_ok=True)
    node_archive = acquire("node.tar.xz", f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.xz", NODE_SHA, "PAGEROUTER_NODE_ARCHIVE")
    bazel = acquire("bazel", "https://github.com/bazelbuild/bazel/releases/download/7.4.1/bazel-7.4.1-linux-x86_64", BAZEL_SHA, "PAGEROUTER_BAZEL_BINARY")
    bazel.chmod(0o755)
    repo = BASE / "toolchain"
    if not (repo / "node/bin/node").exists():
        extraction = BASE / "node-extracted"
        extraction.mkdir(exist_ok=True)
        with tarfile.open(node_archive) as archive:
            archive.extractall(extraction, filter="data")
        repo.mkdir(exist_ok=True)
        shutil.move(str(extraction / f"node-v{NODE_VERSION}-linux-x64"), str(repo / "node"))
        extraction.rmdir()
    node = repo / "node/bin/node"
    busybox = acquire("busybox", "https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox", BUSYBOX_SHA, "PAGEROUTER_BUSYBOX_BINARY")
    for applet in ["sh", "mkdir", "cp"]:
        target = repo / "shell/bin" / applet
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(busybox, target)
        target.chmod(0o755)
    if digest(node) != "7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c":
        raise SystemExit("Node executable identity mismatch")
    package_files = [ROOT / "package.json", ROOT / "package-lock.json"]
    lock_sha = digest(package_files[1])
    marker = repo / "dependency-lock.sha256"
    if not marker.exists() or marker.read_text().strip() != lock_sha:
        for source in package_files:
            shutil.copyfile(source, repo / source.name)
        env = dict(os.environ)
        env["PATH"] = str(node.parent) + os.pathsep + env.get("PATH", "")
        env["npm_config_cache"] = str(BASE / "npm-cache")
        # SRI integrity verification is performed by npm against the immutable lock.
        # No package lifecycle scripts or esbuild fallback downloads are permitted.
        subprocess.run([str(node), str(repo / "node/lib/node_modules/npm/bin/npm-cli.js"), "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=repo, env=env, check=True)
        marker.write_text(lock_sha + "\n")
    lock = json.loads(package_files[1].read_text())
    for name in ["esbuild", "fast-check", "pure-rand", "@esbuild/linux-x64"]:
        actual = json.loads((repo / "node_modules" / name / "package.json").read_text())
        if actual["version"] != lock["packages"]["node_modules/" + name]["version"]:
            raise SystemExit("Installed package identity mismatch: " + name)
    (repo / "WORKSPACE").write_text('workspace(name = "pagerouter_toolchain")\n')
    (repo / "BUILD.bazel").write_text('package(default_visibility = ["//visibility:public"])\nexports_files(["node/bin/node"])\nfilegroup(name="closure", srcs=glob(["node/**", "node_modules/**", "shell/**", "toolchain-receipt.json"], exclude=["**/.bin/**"]))\n')
    # Bazel's file glob dereferences distribution symlinks such as bin/npm.
    # Bind those declared paths to their exact target bytes; .bin is excluded
    # consistently from both the filegroup and this receipt.
    files = [{"path": p.relative_to(repo).as_posix(), "sha256": digest(p), "bytes": p.stat().st_size} for p in sorted(repo.rglob("*")) if p.is_file() and ".bin" not in p.relative_to(repo).parts and p.name not in ("toolchain-receipt.json", "BUILD.bazel", "WORKSPACE", "dependency-lock.sha256")]
    receipt = {"schema": "pagerouter-toolchain@1", "platform": "linux-x86_64", "host_python": {"version": platform.python_version(), "executable_sha256": digest(Path(sys.executable).resolve()), "role": "bootstrap-only; compilation uses declared Node"}, "node_version": NODE_VERSION, "node_archive_sha256": NODE_SHA, "bazel_version": "7.4.1", "bazel_sha256": BAZEL_SHA, "lock_sha256": lock_sha, "npm_version": subprocess.check_output([str(node), str(repo / "node/lib/node_modules/npm/bin/npm-cli.js"), "--version"], text=True).strip(), "files": files, "network_boundary": ["nodejs.org (archive SHA256)", "github.com/bazelbuild and its release CDN (binary SHA256)", "registry.npmjs.org (lockfile SRI)", "actions/python-versions (exact Python 3.14.4 provisioned by pinned setup-python action)"]}
    receipt["busybox_version"] = "1.35.0"
    receipt["busybox_sha256"] = BUSYBOX_SHA
    receipt["network_boundary"].append("busybox.net (static shell/mkdir/cp tool, binary SHA256)")
    (repo / "toolchain-receipt.json").write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n")
    print(json.dumps({"toolchain_receipt_sha256": digest(repo / "toolchain-receipt.json"), "declared_tool_files": len(files), "node": NODE_VERSION, "npm": receipt["npm_version"], "bazel": "7.4.1"}))

if __name__ == "__main__":
    main()
