#!/usr/bin/env python3
"""Independent current-file readback for a PageRouter native build receipt.

Run with RECEIPT CHECKPOINT_ROOT OUTPUT_JSON. This checks bytes, not saved flags.
Publication additionally checks the Git commit through the publisher's separate tool.
"""
import datetime
import hashlib
import json
from pathlib import Path
import sys

if len(sys.argv) != 4:
    raise SystemExit("usage: verify-native-inputs.py RECEIPT CHECKPOINT_ROOT OUTPUT_JSON")
receipt_path, source_root, output_path = map(Path, sys.argv[1:])
source_root = source_root.resolve()
receipt = json.loads(receipt_path.read_text())
build = receipt["buildReceipt"]
entries = build["sourceInputs"]
errors, checked, names = [], [], set()
if receipt.get("exitStatus") != 0 or receipt.get("sourceUnchangedDuringBuild") is not True:
    errors.append("Build did not pass on unchanged source")
if not entries:
    errors.append("Empty source manifest")
for entry in entries:
    name = entry["path"]
    if name in names:
        errors.append("Duplicate manifest path: " + name)
        continue
    names.add(name)
    path = source_root / name
    if Path(name).is_absolute() or ".." in Path(name).parts or not path.resolve().is_relative_to(source_root):
        errors.append("Unsafe manifest path: " + name)
        continue
    if not path.is_file() or path.is_symlink():
        errors.append("Missing or symlinked source: " + name)
        continue
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if len(data) != entry["bytes"] or actual != entry["sha256"]:
        errors.append("Changed source: " + name)
    checked.append({"path": name, "bytes": len(data), "sha256": actual})
for key, name in (("driverSha256", "ci/bazel/build-driver.mjs"), ("helpersSha256", "ci/bazel/build-helpers.mjs")):
    path = source_root / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != build["recipe"].get(key):
        errors.append("Changed build recipe: " + name)
manifest_digest = hashlib.sha256(json.dumps(entries, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
if manifest_digest != build["sourceDigest"]:
    errors.append("Manifest digest does not match receipt")
record = {
    "schema": "hh-root-native-input-readback.v1",
    "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "receiptSha256": hashlib.sha256(receipt_path.read_bytes()).hexdigest(),
    "sourceDigest": manifest_digest,
    "siteBuildId": build["siteBuildId"],
    "passed": not errors,
    "errors": errors,
    "files": checked,
    "boundary": "Current source bytes and recipe only; Git commit and deployed artifact require separate readback.",
}
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({"passed": record["passed"], "errors": errors, "sourceDigest": manifest_digest, "siteBuildId": build["siteBuildId"]}))
raise SystemExit(0 if record["passed"] else 1)
