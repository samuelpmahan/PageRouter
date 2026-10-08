#!/usr/bin/env python3
"""Capture a bounded stable stage candidate, excluding history and dependencies."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import zipfile

ROOT = Path(__file__).resolve().parents[3]
PRODUCT = ROOT / "outputs/capability-lab"
EVIDENCE = PRODUCT / "evidence/independent"
ARCHIVES = Path("/mnt/d/somefile/capability-lab")
MAX_FILE = 4 * 1024 * 1024
MAX_TOTAL = 24 * 1024 * 1024
FAMILIES = ["src/statistics", "src/linalg", "src/runtime", "src/composed",
            "test/statistics", "test/linalg", "test/runtime", "test/composed"]
FIXED = ["CONTRACT.md", "PLAN.md", "PROGRESS.md", "WATCH-CONTRACT.md", "WATCH-HANDOFF.md",
         "index.html", "serve.mjs", "ui/app.mjs", "ui/style.css", "ui/statistics.mjs", "ui/linalg.mjs",
         "catalog/statistics.json", "catalog/linalg.json", "catalog/composed.json",
         "docs/statistics.md", "docs/linalg.md", "docs/workbench.md",
         "docs/team-statistics-delegation.jsonl", "docs/team-linalg-delegation.jsonl", "docs/team-workbench-delegation.jsonl",
         "scripts/verify-all.mjs", "scripts/verify-browser.mjs", "scripts/delegation-report.mjs",
         "evidence/independent/gate-latest.json", "evidence/independent/browser-latest.json",
         "evidence/independent/coverage.md", "evidence/independent/counterexamples.md"]
VERIFIERS = ["preflight.py", "fixtures.json", "gate.mjs", "browser.mjs", "archive_snapshot.py"]
WATCH_FIXED = ["ui/watches.mjs", "catalog/watch-mechanisms.json", "docs/watch-mechanisms.md",
               "docs/watch-transport.md", "docs/watch-geometry.md", "docs/watches-workbench.md",
               "scripts/verify-watches.mjs", "evidence/independent/watch-gate-latest.json",
               "evidence/independent/watch-browser-latest.json", "evidence/independent/watch-sources.md"]
WATCH_VERIFIERS = ["watch-fixtures.json", "watch-gate.mjs", "watch-browser.mjs"]
ML_FIXED = ["ML-CONTRACT.md", "LEARNING-CONTRACT.md", "ML-HANDOFF.md", "ui/ml.mjs",
            "docs/ml-statistics.md", "docs/ml-linalg.md", "docs/ml-workbench.md",
            "scripts/verify-ml.mjs", "evidence/independent/ml-gate-latest.json",
            "evidence/independent/ml-browser-latest.json", "evidence/independent/ml-coverage.md"]
ML_VERIFIERS = ["ml-fixtures.json", "ml-gate.mjs", "ml-browser.mjs", "fresh_extract.py"]
EXPLAIN_FIXED = ["EXPLAIN-CONTRACT.md", "ACCEPTANCE.md", "ui/explain.mjs",
                 "docs/explain-statistics.md", "docs/explain-linalg.md", "docs/explain-workbench.md",
                 "scripts/verify-explain.mjs", "evidence/root/final-grade.json",
                 "evidence/independent/explain-gate-latest.json", "evidence/independent/explain-browser-latest.json",
                 "evidence/independent/full-goal-audit.md"]
EXPLAIN_VERIFIERS = ["explain-fixtures.json", "explain-gate.mjs", "explain-browser.mjs"]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def selected_files(stage="foundation"):
    include_watch = stage in ("watch", "ml", "explain")
    include_ml = stage in ("ml", "explain")
    fixed = FIXED + (WATCH_FIXED if include_watch else []) + (ML_FIXED if include_ml else []) + (EXPLAIN_FIXED if stage == "explain" else [])
    families = FAMILIES + (["src/watches", "test/watches"] if include_watch else []) + (["src/ml", "test/ml"] if include_ml else []) + (["src/explain", "test/explain"] if stage == "explain" else [])
    verifiers = VERIFIERS + (WATCH_VERIFIERS if include_watch else []) + (ML_VERIFIERS if include_ml else []) + (EXPLAIN_VERIFIERS if stage == "explain" else [])
    paths = [PRODUCT / relative for relative in fixed if (PRODUCT / relative).is_file()]
    for family in families:
        paths.extend(path for path in (PRODUCT / family).rglob("*") if path.is_file())
    paths.extend(Path(__file__).parent / name for name in verifiers)
    paths = sorted(set(paths))
    if len(paths) > 200:
        raise ValueError("stage snapshot exceeds 200-file bound")
    for path in paths:
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError(f"unowned/symlink path: {path}")
        if path.stat().st_size > MAX_FILE:
            raise ValueError(f"file exceeds 4MiB bound: {path}")
    return paths


def stable_capture(stage="foundation", extra_pins=None):
    paths = selected_files(stage)
    payloads = {str(path.relative_to(ROOT)): path.read_bytes() for path in paths}
    if sum(map(len, payloads.values())) > MAX_TOTAL:
        raise ValueError("stage snapshot exceeds 24MiB bound")
    if paths != selected_files(stage):
        raise RuntimeError("stage file set changed during capture")
    for path in paths:
        if path.read_bytes() != payloads[str(path.relative_to(ROOT))]:
            raise RuntimeError(f"source changed during capture: {path.relative_to(ROOT)}")
    accepted = {}
    receipts = ["gate-latest.json", "browser-latest.json"]
    if stage in ("watch", "ml", "explain"):
        receipts += ["watch-gate-latest.json", "watch-browser-latest.json"]
    if stage in ("ml", "explain"):
        receipts += ["ml-gate-latest.json", "ml-browser-latest.json"]
    if stage == "explain":
        receipts += ["explain-gate-latest.json", "explain-browser-latest.json"]
    for receipt in receipts:
        data = json.loads(payloads[f"outputs/capability-lab/evidence/independent/{receipt}"])
        if data["summary"].get("fail") or data["summary"].get("blocked"):
            raise ValueError(f"latest stage receipt is not green: {receipt}")
        for record in data.get("sourceFiles", []):
            path = Path(record["path"]) if Path(record["path"]).is_absolute() else PRODUCT / record["path"]
            accepted[str(path.relative_to(ROOT))] = record["sha256"]
    accepted.update(extra_pins or {})
    mismatches = [name for name, expected in accepted.items() if name not in payloads or sha(payloads[name]) != expected]
    if mismatches:
        raise RuntimeError("source differs from independent stage evidence: " + ", ".join(mismatches))
    return paths, payloads, accepted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--stage", choices=["foundation", "watch", "ml", "explain"], default="foundation")
    parser.add_argument("--pin", action="append", default=[], help="additional owned relative-path=sha256 source pin")
    args = parser.parse_args()
    if not 1 <= args.attempts <= 3:
        raise ValueError("attempts must be 1 through 3")
    failures = []
    pins = {}
    for specification in args.pin:
        name, separator, digest = specification.partition("=")
        if not separator or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("pin must be relative-path=lowercase-sha256")
        path = (ROOT / name).resolve()
        if not path.is_relative_to(PRODUCT):
            raise ValueError("extra pin must target the owned product tree")
        pins[str(path.relative_to(ROOT))] = digest
    capture = None
    for attempt in range(args.attempts):
        try:
            capture = stable_capture(args.stage, pins)
            break
        except RuntimeError as error:
            failures.append({"attempt": attempt + 1, "error": str(error)})
            if attempt + 1 < args.attempts:
                time.sleep(0.2)
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%S%fZ")
    receipt = {"schema": "capability-lab.independent.stage-archive.v2", "generatedAt": now.isoformat(),
               "stage": args.stage, "futureStages": {**({"watches": "incomplete"} if args.stage == "foundation" else {}), **({"ML": "incomplete"} if args.stage in ("foundation", "watch") else {}), **({"AI": "incomplete"} if args.stage != "explain" else {})},
               "candidate": True, "freshExtractionReplay": "not performed", "wholeGoalStatusAtCapture": "root goal active; final delivered-archive reconstruction and goal closure pending", "attemptFailures": failures}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    if capture is None:
        receipt.update(status="refused", error="No stable snapshot matching independent stage sources could be captured")
        (EVIDENCE / f"archive-refused-{stamp}.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, indent=2))
        return 1
    paths, payloads, accepted = capture
    manifest = {**receipt, "status": "stable source candidate", "foundationAcceptance": "root accepted prior mathematical and browser gates",
                "watchEvidence": "independent watch mathematical/API and browser gates passed; root accepted watches" if args.stage in ("watch", "ml", "explain") else "incomplete",
                "MLEvidence": "independent math/leakage/retention and real-browser gates passed; root accepted ML" if args.stage in ("ml", "explain") else "incomplete",
                "ExplainEvidence": "current independent arithmetic/grounding/watch-context and all-track browser gates passed; final root acceptance and delivered-archive reconstruction remain distinct" if args.stage == "explain" else "incomplete",
                "archivePolicy": "source/test/catalog/docs/coordination plus latest small receipts; no screenshots, old evidence, dependencies or later-stage implementation",
                "acceptedSourceHashesMatched": len(accepted), "members": [
                    {"path": name, "bytes": len(data), "sha256": sha(data)} for name, data in sorted(payloads.items())]}
    payloads["SNAPSHOT-MANIFEST.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    payloads["README-SNAPSHOT.md"] = (
        f"# Capability Lab {args.stage} source candidate\n\n"
        f"Stage: {args.stage}. Root accepted foundations; " +
        ("Root accepted watches, ML and current Explain functionality; independent arithmetic/grounding/watch-state and all-track browser checks passed. The root goal remains active at capture; final delivered-archive reconstruction and goal closure are pending.\n\n" if args.stage == "explain" else
         "Root accepted watches; independent ML mathematical/leakage/retention and real-browser gates passed. Root's full grade remains distinct. AI is incomplete.\n\n" if args.stage == "ml" else
         "fresh independent watch mathematical and browser gates passed. Root's full grade remains distinct. ML and AI are incomplete.\n\n" if args.stage == "watch"
         else "watches, ML and AI remain incomplete.\n\n") +
        "This archive contains source, tests, catalogs, documentation, coordination files and latest small independent receipts. "
        "Node/browser dependencies, screenshots and historical evidence are excluded. Use an existing Node 20+ runtime.\n\n"
        "From the extracted root: `node outputs/capability-lab/scripts/verify-all.mjs`, then "
        "`node work/capability-lab/verification/gate.mjs outputs/capability-lab`. "
        "Serve with `node outputs/capability-lab/serve.mjs 4173`.\n\n" +
        ("Watch gate: `node work/capability-lab/verification/watch-gate.mjs outputs/capability-lab`.\n\n" if args.stage in ("watch", "ml", "explain") else "") +
        ("ML gate: `node work/capability-lab/verification/ml-gate.mjs outputs/capability-lab`.\n\n" if args.stage in ("ml", "explain") else "") +
        ("Explain gate: `node work/capability-lab/verification/explain-gate.mjs outputs/capability-lab`. Inspect `outputs/capability-lab/evidence/independent/full-goal-audit.md`.\n\n" if args.stage == "explain" else "") +
        "Manifest SHA-256 hashes verify captured bytes. Extraction/replay has not been performed on this candidate. "
        "Current source files matched the latest independent accepted-source snapshots and remained stable while read.\n"
    ).encode()
    ARCHIVES.mkdir(parents=True, exist_ok=True)
    final = ARCHIVES / f"capability-lab-{args.stage}-{stamp}-candidate.zip"
    temporary = final.with_suffix(".zip.partial")
    with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(payloads.items()):
            archive.writestr(name, data)
    # Refuse a concurrent source change rather than silently associating new files with old evidence.
    changed = [str(path.relative_to(ROOT)) for path in paths
               if path.read_bytes() != payloads[str(path.relative_to(ROOT))]]
    if changed or paths != selected_files(args.stage):
        temporary.unlink()
        receipt.update(status="refused", error="Source changed while writing candidate", changed=changed)
        (EVIDENCE / f"archive-refused-{stamp}.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, indent=2))
        return 1
    with zipfile.ZipFile(temporary) as archive:
        for name, data in payloads.items():
            if sha(archive.read(name)) != sha(data):
                raise ValueError(f"archive member hash mismatch: {name}")
    temporary.rename(final)
    receipt.update(status="created", archive=str(final), archiveBytes=final.stat().st_size,
                   archiveSha256=sha(final.read_bytes()), members=len(payloads), sourceBytes=sum(map(len, payloads.values())),
                   acceptedSourceHashesMatched=len(accepted), zipMemberHashVerification="passed")
    (EVIDENCE / f"archive-{stamp}.json").write_text(json.dumps(receipt, indent=2) + "\n")
    (EVIDENCE / "archive-latest.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
