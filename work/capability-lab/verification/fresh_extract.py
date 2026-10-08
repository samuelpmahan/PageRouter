#!/usr/bin/env python3
"""Replay an immutable source ZIP from fresh D staging, without installations/builds."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import socket
import subprocess
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
EVIDENCE = ROOT / "outputs/capability-lab/evidence/independent"
DROOT = Path("/mnt/d/somefile/capability-lab")
NODE = ROOT / "work/toolteam/inventory/runtime-cache/node-v24.19.0-linux-x64/bin/node"


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--node", default=os.environ.get("CAPABILITY_NODE", str(NODE) if NODE.is_file() else "node"))
    parser.add_argument("--skip-browser", action="store_true")
    args = parser.parse_args()
    prior = {} if args.archive and args.expected_sha256 else json.loads((EVIDENCE / "archive-latest.json").read_text())
    archive = Path(args.archive or prior["archive"]).resolve()
    expected = args.expected_sha256 or prior["archiveSha256"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    staging = DROOT / "fresh-extractions" / stamp
    output = EVIDENCE / f"fresh-extraction-{stamp}.json"
    report = {"schema": "capability-lab.independent.fresh-extraction.v1", "generatedAt": datetime.now(timezone.utc).isoformat(),
              "archive": str(archive), "expectedSha256": expected, "staging": str(staging), "node": args.node,
              "checks": [], "stage": "manifest pending", "futureStages": {"AI": "incomplete"},
              "installations": False, "builds": False}
    server = None
    original_archive_stat = archive.stat()
    try:
        if sha(archive) != expected:
            raise ValueError("immutable ZIP checksum mismatch")
        report["checks"].append({"name": "immutable candidate checksum", "status": "pass"})
        staging.mkdir(parents=True, exist_ok=False)
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if len(members) > 200 or sum(item.file_size for item in members) > 24 * 1024 * 1024:
                raise ValueError("ZIP exceeds bounded extraction policy")
            manifest = json.loads(bundle.read("SNAPSHOT-MANIFEST.json"))
            report["stage"] = manifest["stage"]
            report["futureStages"] = manifest.get("futureStages", {"Explain": "incomplete"})
            if report["stage"] not in ("foundation", "watch", "ml", "explain", "explain-wip"):
                raise ValueError("unsupported snapshot stage")
            declared = {item["path"]: item for item in manifest["members"]}
            expected_names = set(declared) | {"SNAPSHOT-MANIFEST.json", "README-SNAPSHOT.md"}
            if set(bundle.namelist()) != expected_names or len(expected_names) != len(members):
                raise ValueError("ZIP members differ from manifest or contain duplicates")
            for item in members:
                name = PurePosixPath(item.filename)
                if name.is_absolute() or ".." in name.parts or item.file_size > 4 * 1024 * 1024:
                    raise ValueError("invalid ZIP member path/size")
                if (item.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("ZIP symbolic link refused")
                payload = bundle.read(item)
                if item.filename in declared:
                    record = declared[item.filename]
                    if len(payload) != record["bytes"] or hashlib.sha256(payload).hexdigest() != record["sha256"]:
                        raise ValueError(f"manifest checksum mismatch: {item.filename}")
                destination = staging.joinpath(*name.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(payload)
        product = staging / "outputs/capability-lab"
        runtime_evidence = staging / "verification-evidence"
        runtime_evidence.mkdir()
        def verify_manifest(allow_generated_receipt=False):
            for name, record in declared.items():
                actual = sha(staging / name)
                if actual != record["sha256"]:
                    permitted_receipts = {
                        "outputs/capability-lab/evidence/independent/gate-latest.json": "capability-lab.independent.gate.v1",
                        "outputs/capability-lab/evidence/independent/watch-gate-latest.json": "capability-lab.independent.watch-gate.v1",
                    }
                    if allow_generated_receipt and name in permitted_receipts:
                        generated_data = json.loads((staging / name).read_text())
                        if generated_data.get("schema") != permitted_receipts[name] or generated_data.get("summary", {}).get("fail") or generated_data.get("summary", {}).get("blocked"):
                            raise ValueError(f"unexpected regenerated verification receipt: {name}")
                        generated = runtime_evidence / f"delivered-generated-{Path(name).name}"
                        generated.write_bytes((staging / name).read_bytes())
                        report.setdefault("regeneratedVerificationReceipts", []).append({
                            "path": name, "capturedSha256": record["sha256"], "generatedSha256": actual,
                            "retainedGeneratedReceipt": str(generated),
                            "reason": "Delivered foundation verifier writes its own output directory; this snapshot receipt is a regenerated diagnostic, not product source."
                        })
                        continue
                    raise ValueError(f"extracted member changed: {name}")
        verify_manifest()
        report["checks"].append({"name": "fresh extraction and all manifest hashes", "status": "pass", "members": len(members), "declaredHashes": len(declared), "stage": manifest["stage"]})
        def command(name, argv, environment=None, timeout=60, allow_failure=False):
            process = subprocess.run(argv, cwd=product, env=environment, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
            if len(process.stdout) + len(process.stderr) > 2 * 1024 * 1024:
                raise ValueError("verification output exceeded 2MiB bound")
            stdout = runtime_evidence / f"{name}.stdout.txt"
            stderr = runtime_evidence / f"{name}.stderr.txt"
            stdout.write_bytes(process.stdout)
            stderr.write_bytes(process.stderr)
            report["checks"].append({"name": name, "status": "pass" if process.returncode == 0 else "fail",
                                     "argv": argv, "exit": process.returncode, "stdout": str(stdout), "stderr": str(stderr),
                                     "tail": process.stdout.decode(errors="replace")[-1200:]})
            if process.returncode and not allow_failure:
                raise RuntimeError(f"{name} exited {process.returncode}; retained evidence: {stderr}")
        command("zero-dependency-nested-Node-tests", [args.node, str(product / "scripts/verify-all.mjs")], allow_failure=report["stage"] == "explain-wip")
        env = dict(os.environ, CAPABILITY_PRODUCT_ROOT=str(product), CAPABILITY_EVIDENCE_ROOT=str(runtime_evidence))
        delivered_verifiers = staging / "work/capability-lab/verification"
        if report["stage"] == "explain":
            for gate in ['gate', 'watch-gate', 'explain-gate']:
                command(f"fresh-source-independent-{gate}", [args.node, str(delivered_verifiers / f"{gate}.mjs")], env, 60)
        if report["stage"] in ("ml", "explain", "explain-wip"):
            command("fresh-source-independent-ML-mathematics", [args.node, str((delivered_verifiers if report["stage"] == "explain" else HERE) / "ml-gate.mjs")], env, 60)
            report["mlMathematics"] = json.loads((runtime_evidence / "ml-gate-latest.json").read_text())
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        url = f"http://127.0.0.1:{port}"
        server = subprocess.Popen([args.node, str(product / "serve.mjs"), str(port)], cwd=product,
                                  stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        ready = False
        for _ in range(100):
            if server.poll() is not None:
                raise RuntimeError("fresh extracted HTTP server exited before ready")
            try:
                with urllib.request.urlopen(url + "/index.html", timeout=1) as response:
                    ready = response.status == 200
                if ready:
                    break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.05)
        if not ready:
            raise RuntimeError("fresh extracted HTTP server did not become ready")
        served = []
        prefix = "outputs/capability-lab/"
        for name, record in declared.items():
            relative = name.removeprefix(prefix)
            if not name.startswith(prefix) or not (relative.startswith(("src/", "ui/", "catalog/")) or relative == "index.html"):
                continue
            with urllib.request.urlopen(url + "/" + relative, timeout=3) as response:
                payload = response.read(4 * 1024 * 1024 + 1)
                if response.status != 200 or hashlib.sha256(payload).hexdigest() != record["sha256"]:
                    raise ValueError(f"served bytes differ from archive: {relative}")
            served.append(relative)
        report["checks"].append({"name": "fresh HTTP source/UI/catalog bytes", "status": "pass", "url": url, "servicePid": server.pid, "files": served})
        if not args.skip_browser:
            env = dict(os.environ, CAPABILITY_PRODUCT_ROOT=str(product), CAPABILITY_EVIDENCE_ROOT=str(runtime_evidence),
                       CAPABILITY_PREVIEW_URL=url, CAPABILITY_SERVICE_PID=str(server.pid), CAPABILITY_NODE=args.node,
                       CAPABILITY_BROWSER_CACHE=os.environ.get("CAPABILITY_BROWSER_CACHE", str(ROOT / "work/toolteam/browser")))
            if report["stage"] == "explain":
                command("fresh-delivered-foundation-browser", [args.node, str(delivered_verifiers / "browser.mjs")], env, 60)
            command("fresh-source-browser-import-and-watch-controls", [args.node, str((delivered_verifiers if report["stage"] == "explain" else HERE) / "watch-browser.mjs")], env, 60)
            report["browser"] = json.loads((runtime_evidence / "watch-browser-latest.json").read_text())
            if report["stage"] in ("ml", "explain"):
                command("fresh-source-browser-ML-fit-edit-predict-evaluate", [args.node, str((delivered_verifiers if report["stage"] == "explain" else HERE) / "ml-browser.mjs")], env, 60)
                report["mlBrowser"] = json.loads((runtime_evidence / "ml-browser-latest.json").read_text())
            if report["stage"] == "explain":
                command("fresh-delivered-explain-browser", [args.node, str(delivered_verifiers / "explain-browser.mjs")], env, 60)
                report["explainBrowser"] = json.loads((runtime_evidence / "explain-browser-latest.json").read_text())
        else:
            report["browserNotPerformed"] = "Explicitly skipped; inspect missing imports and retained grade failures for incomplete WIP integration."
        verify_manifest(allow_generated_receipt=report["stage"] == "explain")
        if sha(archive) != expected or archive.stat().st_mtime_ns != original_archive_stat.st_mtime_ns:
            raise ValueError("immutable original ZIP changed during verification")
        report["checks"].append({"name": "all immutable extracted source/test/catalog/docs hashes and original ZIP unchanged after replay", "status": "pass", "permittedGeneratedReceipt": report.get("regeneratedVerificationReceipts", [])})
    except Exception as error:
        report["checks"].append({"name": "fresh extraction verification", "status": "fail", "error": str(error)})
    finally:
        if server:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=3)
        report["summary"] = {"pass": sum(c["status"] == "pass" for c in report["checks"]),
                             "fail": sum(c["status"] == "fail" for c in report["checks"]),
                             "freshReplayPassed": all(c["status"] == "pass" for c in report["checks"])}
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        (EVIDENCE / "fresh-extraction-latest.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"summary": report["summary"], "archive": str(archive), "staging": str(staging), "receipt": str(output),
                          "failures": [c for c in report["checks"] if c["status"] == "fail"]}, indent=2))
    return 0 if report["summary"]["freshReplayPassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
