#!/usr/bin/env python3
# PROVENANCE: Boone, 2026-09-26. Sam: "Forge needs a 'root sync' command."
# Forge lives on Sam's side; the capability lands here in the shared Drive
# scripts so Forge (or any agent) can shell to one command instead of
# per-folder drive_sync.py invocations. Thin wrapper: all real sync logic
# stays in drive_sync.py; this only walks the known tree and summarizes.
# Multi-root (same day, Sam): PxC storage is a facade over whatever backend
# works best, so "the root" was never one Drive folder. Roots are named in
# roots.json (beside this script, synced to Drive with it); the Clip Factory
# Drive tree is just root #1 (kind=drive). A future root is another entry:
# {"name": ..., "kind": "drive"|"local", "layout": <drive-layout.json path>,
# "local": <mirror dir>} with layout/local relative to the drive/ tree root.
# Rerun: python3 scripts/root_sync.py status [--root <name>]
#        python3 scripts/root_sync.py push --yes [--root <name>]
#        python3 scripts/root_sync.py pull --yes [--root <name>]
"""Root sync: one command over every known storage root.

Reads roots.json (beside this script): a list of named roots. Each
drive-kind root points at a drive-layout.json for folder ids and a local
mirror dir (both relative to the drive/ tree root). Runs drive_sync.py per
folder per root. status is read-only; push/pull are dry runs unless --yes
is passed (mirrors drive_sync.py). --root selects one root; default is all
roots.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DRIVE_ROOT = os.path.dirname(HERE)
ROOTS_FILE = os.path.join(HERE, "roots.json")

# local subdir (under the root's mirror) -> drive-layout.json key
TREE = [
    ("scripts", "scripts"),
    ("docs", "docs"),
    ("state", "state"),
    ("clips", "clips"),
    ("clips-chaos-out", "clips_chaos"),
    ("audio", "audio"),
    ("audio-inbox", "audio_inbox"),
    ("agentnet", "agentnet"),
]


def run_sync(cmd, local_dir, folder_id, yes):
    argv = [sys.executable, os.path.join(HERE, "drive_sync.py"), cmd,
            "--local", local_dir, "--folder", folder_id]
    if yes:
        argv.append("--yes")
    p = subprocess.run(argv, capture_output=True, text=True)
    return p


def summarize(stdout):
    """Pull the compact counts line out of drive_sync status output."""
    m = re.search(r"local=(\d+) drive=(\d+) tombstoned=(\d+)", stdout)
    if not m:
        return "no status line"
    local, drive, tomb = m.groups()

    def count_block(blocks):
        n = 0
        for b in blocks:
            n += len([l for l in b.strip().splitlines() if l.strip()])
        return n

    parts = [f"local={local} drive={drive} tombstoned={tomb}"]
    lo = count_block(re.findall(r"(?m)^LOCAL ONLY:\n((?:  .*\n)+)", stdout))
    st = count_block(re.findall(r"(?m)^STALE.*\n((?:  .*\n)+)", stdout))
    do = count_block(re.findall(r"(?m)^DRIVE ONLY:\n((?:  .*\n)+)", stdout))
    du = count_block(re.findall(r"(?m)^DUPLICATES.*\n((?:  .*\n)+)", stdout))
    if lo:
        parts.append(f"upload {lo}")
    if st:
        parts.append(f"update {st}")
    if do:
        parts.append(f"download {do}")
    if du:
        parts.append(f"DUPES {du}")
    return " ".join(parts)


def sync_root(root, cmd, yes):
    """Run drive_sync per folder for one root. Returns list of (name, summary)."""
    kind = root.get("kind", "drive")
    base = os.path.normpath(os.path.join(DRIVE_ROOT, root.get("local", ".")))
    rows = []
    if kind != "drive":
        return [(root["name"], f"kind={kind}: no sync driver yet, skipped")]
    layout_path = os.path.normpath(os.path.join(DRIVE_ROOT, root["layout"]))
    if not os.path.isfile(layout_path):
        return [(root["name"], f"no layout file at {root['layout']}, skipped")]
    layout = json.load(open(layout_path))
    for local_name, layout_key in TREE:
        local_dir = os.path.join(base, local_name)
        folder_id = layout.get(layout_key)
        if not os.path.isdir(local_dir):
            rows.append((local_name, "no local dir, skipped"))
            continue
        if not folder_id:
            rows.append((local_name, "no folder id in layout, skipped"))
            continue
        p = run_sync(cmd, local_dir, folder_id, yes)
        if p.returncode == 3:
            # drive_sync could not probe the remote (network dying, reboot
            # mid-flight). Report it plainly and skip: never treat this as
            # "remote is empty", and never let the keeper decide a push on it.
            rows.append((local_name, "PROBE FAILED: remote unreachable, skipped"))
        elif p.returncode != 0:
            rows.append((local_name,
                         f"ERROR rc={p.returncode}: {(p.stderr or p.stdout)[-200:]}"))
        else:
            summary = summarize(p.stdout)
            if cmd != "status" and not yes:
                summary += " (dry run)"
            rows.append((local_name, summary))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["status", "push", "pull"])
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--root", default=None, help="sync one named root (default: all)")
    args = ap.parse_args()

    roots = json.load(open(ROOTS_FILE))
    if args.root:
        roots = [r for r in roots if r["name"] == args.root]
        if not roots:
            print(f"no root named {args.root} in roots.json")
            return 1

    mode = "(live)" if args.yes else "(dry run)" if args.cmd != "status" else ""
    print(f"root_sync {args.cmd} {mode}".rstrip())
    for root in roots:
        rows = sync_root(root, args.cmd, args.yes)
        if len(roots) > 1:
            print(f" [{root['name']}]")
        width = max([len(r[0]) for r in rows] or [1])
        for name, summary in rows:
            print(f"  {name:<{width}}  {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

