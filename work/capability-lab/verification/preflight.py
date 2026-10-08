#!/usr/bin/env python3
"""Bounded resource evidence; reads metadata only, never command lines or logs."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "outputs/capability-lab/evidence/independent"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(EVIDENCE / "preflight.json"))
    parser.add_argument("--max-processes", type=int, default=2048)
    parser.add_argument("--max-entries", type=int, default=4000)
    parser.add_argument("--max-seconds", type=float, default=5)
    parser.add_argument("--managed-pid", type=int, action="append", default=[])
    parser.add_argument("--budget-bytes", type=int, default=2147483648)
    args = parser.parse_args()
    if not 1 <= args.max_processes <= 4096 or not 1 <= args.max_entries <= 10000 or not 0.1 <= args.max_seconds <= 10:
        raise ValueError("bounds exceed independent preflight policy")
    output = Path(args.output).resolve()
    configured_evidence = Path(os.environ.get("CAPABILITY_EVIDENCE_ROOT", str(EVIDENCE))).resolve()
    if not (configured_evidence.is_relative_to(EVIDENCE) or configured_evidence.is_relative_to(Path("/mnt/d/somefile/capability-lab"))):
        raise ValueError("configured evidence root must stay in owned independent or D-stage scope")
    if not output.is_relative_to(configured_evidence):
        raise ValueError("output must stay in independent evidence scope")
    started = time.monotonic()
    deadline = started + args.max_seconds
    memory = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        if key in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
            memory[key + "Bytes"] = int(value.split()[0]) * 1024
    cgroup = {}
    for name in ["memory.max", "memory.current", "pids.max", "pids.current"]:
        location = Path("/sys/fs/cgroup") / name
        if location.exists():
            cgroup[name] = location.read_text().strip()
    disks = []
    for target in [ROOT, Path("/mnt/d")]:
        stat = os.statvfs(target)
        disks.append({"path": str(target), "totalBytes": stat.f_blocks * stat.f_frsize,
                      "availableBytes": stat.f_bavail * stat.f_frsize})
    processes = []
    visited = 0
    with os.scandir("/proc") as entries:
        for entry in entries:
            if not entry.name.isdigit():
                continue
            if visited >= args.max_processes or time.monotonic() >= deadline:
                break
            visited += 1
            try:
                status = {}
                with open(Path(entry.path) / "status") as handle:
                    for line in handle:
                        key, _, value = line.partition(":")
                        if key in {"Name", "VmRSS", "Threads", "State", "PPid"}:
                            status[key] = value.strip()
                rss = int(status.get("VmRSS", "0 kB").split()[0]) * 1024
                processes.append({"pid": int(entry.name), "name": status.get("Name"),
                                  "parentPid": int(status.get("PPid", "0")),
                                  "rssBytes": rss, "threads": int(status.get("Threads", "0")),
                                  "state": status.get("State")})
            except (FileNotFoundError, PermissionError, ProcessLookupError):
                pass
    count, bytes_seen = 0, 0
    queue = [ROOT / "outputs/capability-lab", ROOT / "work/capability-lab"]
    errors = 0
    while queue and count < args.max_entries and time.monotonic() < deadline:
        directory = queue.pop()
        try:
            with os.scandir(directory) as entries:
                for entry in entries:
                    if count >= args.max_entries or time.monotonic() >= deadline:
                        break
                    count += 1
                    if entry.is_file(follow_symlinks=False):
                        bytes_seen += entry.stat(follow_symlinks=False).st_size
                    elif entry.is_dir(follow_symlinks=False) and entry.name not in {"node_modules", ".git"}:
                        queue.append(Path(entry.path))
        except (FileNotFoundError, PermissionError):
            errors += 1
    report = {"schema": "capability-lab.independent.preflight.v1",
              "generatedAt": datetime.now(timezone.utc).isoformat(),
              "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "memory": memory, "cgroup": cgroup, "disks": disks,
              "processes": {"visited": visited, "maxVisited": args.max_processes,
                            "topRss": sorted(processes, key=lambda p: p["rssBytes"], reverse=True)[:12]},
              "artifactMetadata": {"entriesVisited": count, "bytesObserved": bytes_seen,
                                   "truncated": bool(queue), "errors": errors},
              "bounds": {"maxEntries": args.max_entries, "maxSeconds": args.max_seconds},
              "elapsedSeconds": time.monotonic() - started,
              "contentsRead": ["proc memory/status", "cgroup scalar limits", "this script"],
              "decision": "light Node tests and one browser session only; generated bulk evidence goes to D"}
    if args.managed_pid:
        groups = []
        combined = set()
        for root_pid in args.managed_pid:
            descendants = {root_pid}
            changed = True
            while changed:
                before = len(descendants)
                descendants.update(p["pid"] for p in processes if p["parentPid"] in descendants)
                changed = len(descendants) != before
            members = [p for p in processes if p["pid"] in descendants]
            combined.update(p["pid"] for p in members)
            groups.append({"rootPid": root_pid, "present": any(p["pid"] == root_pid for p in members),
                           "rssBytes": sum(p["rssBytes"] for p in members), "members": members})
        combined_rss = sum(p["rssBytes"] for p in processes if p["pid"] in combined)
        report["managedObservation"] = {"groups": groups, "combinedRssBytes": combined_rss,
                                         "budgetBytes": args.budget_bytes,
                                         "belowBudgetAtSnapshot": combined_rss <= args.budget_bytes,
                                         "enforcement": "observed snapshot only; no operating-system hard limit established",
                                         "peakEstablished": False}
    browser_processes = [p for p in processes if any(name in (p["name"] or "").lower()
                                                   for name in ["chrome", "chromium", "headless_shell"])]
    report["allVisibleBrowserMetadata"] = {"processes": browser_processes,
                                            "rssBytes": sum(p["rssBytes"] for p in browser_processes),
                                            "scope": "all visible Linux browser-name matches; may include other sessions, not attributed to this product"}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
