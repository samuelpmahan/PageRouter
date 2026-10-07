"""Record execution identities; this metadata does not imply Proto acceptance."""
from pathlib import Path
import hashlib
import json
import os
import platform

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "verification"
OUT.mkdir(exist_ok=True)
receipt_path = ROOT / "bazel-bin/pagerouter_site.receipt.json"
receipt = json.loads(receipt_path.read_text())
validation = json.loads((OUT / "output-validation.json").read_text())
manifest = json.loads((ROOT / "ci/bazel/source-manifest.json").read_text())
baseline = {r["path"][5:]: r["sha256"] for r in manifest["canonical_files"] if r["path"].startswith("dist/")}
fresh = {r["path"]: r["sha256"] for r in receipt["site"]["files"]}
drift = {"baseline_file_count": len(baseline), "fresh_file_count": len(fresh), "added": sorted(fresh.keys() - baseline.keys()), "removed": sorted(baseline.keys() - fresh.keys()), "changed": [{"path": p, "before": baseline[p], "after": fresh[p]} for p in sorted(baseline.keys() & fresh.keys()) if baseline[p] != fresh[p]], "unchanged": sum(baseline[p] == fresh[p] for p in baseline.keys() & fresh.keys()), "normalization": "none"}
minted = []
for name in ["m", "c", "LossFunction"]:
    relative = f"FunctionalGuarantee/proto/none/{name}.pxc"
    data = (ROOT / relative).read_bytes()
    if data != f"{{FunctionalGuarantee|{{?}}|{name}|{{?}}}}\n".encode():
        raise SystemExit("Mint tuple differs from requested unresolved content: " + relative)
    minted.append({"path": relative, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "representation": "unresolved node, not an executable recipe"})
observation = {"schema": "parallel-compressing-bootstrap-observation@1", "source": receipt["source"], "recipe": receipt["recipe"], "receipt_sha256": hashlib.sha256(receipt_path.read_bytes()).hexdigest(), "validation": validation, "host": {"kernel": platform.release(), "architecture": platform.machine()}, "invocation": {k: os.environ.get(k) for k in ["GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_REPOSITORY", "GITHUB_WORKFLOW_REF", "ImageVersion"]}, "minted_nodes": minted, "dist_comparison": drift, "task_answer": "Full authoritative-source Bazel compilation and separate verification completed; no Proto semantic acceptance or deployment is implied"}
(OUT / "run-observation.json").write_text(json.dumps(observation, sort_keys=True, indent=2) + "\n")
(OUT / "narration.md").write_text(f"Full-source Bazel build and verification completed. The fresh site contains {len(fresh)} files. Compared with the historical {len(baseline)}-file dist, {len(drift['added'])} files were added, {len(drift['removed'])} removed and {len(drift['changed'])} changed; raw differences are retained in run-observation.json. Three unresolved mint nodes are preserved. No deployment or semantic acceptance occurred.\n")
print(json.dumps({"observation": "verification/run-observation.json", "site_tree_sha256": receipt["site"]["tree_sha256"], "fresh_files": len(fresh), "added": len(drift["added"]), "removed": len(drift["removed"]), "changed": len(drift["changed"])}))
