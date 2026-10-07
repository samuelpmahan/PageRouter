#!/usr/bin/env python3
"""Validate the declared Bazel site tree against source and tool receipts."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SOURCE_MANIFEST = ROOT / "ci" / "bazel" / "source-manifest.json"
TOOLCHAIN_RECEIPT = ROOT / ".bootstrap" / "toolchain" / "toolchain-receipt.json"
BOOTSTRAP = ROOT / "ci" / "bazel" / "bootstrap.py"
BUILD_DRIVER = ROOT / "ci" / "bazel" / "build_driver.mjs"
BUILD_RULE = ROOT / "ci" / "bazel" / "build_rule.bzl"
PACKAGE_LOCK = ROOT / "package-lock.json"
PINNED_BAZEL_VERSION = "7.4.1"
PINNED_BUSYBOX_VERSION = "1.35.0"
PINNED_BUSYBOX_SHA256 = "6e123e7f3202a8c1e9b1f94d8941580a25135382b99e8d3e34fb858bba311348"
AUTHORIZED_ARCHIVE_SHA256 = "2d58add7477bc1b9cb18cce9297f6851f21fcf4d051afcd9bda5e849f6e8ce3b"
AUTHORIZED_CHECKPOINT_BUILD_ID = "f300f36921420180b22cf20670700a08adaf3c523ac332f1c93653c4143aa765"
EXPECTED_RECIPE_FILES = (
    ".bazelversion",
    ".gitignore",
    "BUILD.bazel",
    "WORKSPACE",
    "ci/bazel/BUILD.bazel",
    "ci/bazel/README.md",
    "ci/bazel/bootstrap.py",
    "ci/bazel/build_driver.mjs",
    "ci/bazel/build_rule.bzl",
    "ci/bazel/run.sh",
    "ci/bazel/run_observation.py",
    "ci/bazel/source-manifest.json",
    "ci/bazel/source_files.bzl",
    "ci/bazel/verify_outputs.py",
    "ci/bazel/verify_rule.bzl",
)


class ValidationError(ValueError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        raise ValidationError(f"cannot read JSON file {path.name}: {error}") from error
    if not isinstance(value, dict):
        raise ValidationError(f"JSON file {path.name} must contain an object")
    return value, raw


def safe_relative_path(value: Any) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValidationError("file records need non-empty POSIX relative paths")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or re.match(r"^[A-Za-z]:", value)
        or path.as_posix() != value
        or any(part in ("", ".", "..") for part in path.parts)
    ):
        raise ValidationError(f"unsafe relative path in file record: {value!r}")
    return path


def check_no_symlink(root: Path, relative: PurePosixPath) -> Path:
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValidationError(f"symlink is not allowed in an input or output tree: {relative.as_posix()}")
    return current


def declared_output_path(value: Path, expected_relative: str, label: str) -> Path:
    candidate = value if value.is_absolute() else ROOT / value
    try:
        relative = candidate.relative_to(ROOT)
    except ValueError as error:
        raise ValidationError(f"{label} must remain inside the workspace") from error
    if relative.as_posix() != expected_relative:
        raise ValidationError(f"{label} must be the declared Bazel output {expected_relative}")
    current = ROOT
    for index, part in enumerate(PurePosixPath(expected_relative).parts):
        current = current / part
        if current.is_symlink() and not (index == 0 and part == "bazel-bin"):
            raise ValidationError(f"{label} path contains a symlink")
    try:
        resolved = candidate.resolve(strict=True)
        output_root = ROOT / ".bazel-cache"
        if output_root.is_symlink():
            raise ValidationError("Bazel output user root must not be a symlink")
        resolved_output_root = output_root.resolve(strict=True)
        output_relative = resolved.relative_to(resolved_output_root)
    except (OSError, ValueError) as error:
        raise ValidationError(f"{label} does not resolve beneath the pinned Bazel output root") from error
    parts = output_relative.parts
    try:
        execroot_index = parts.index("execroot")
    except ValueError as error:
        raise ValidationError(f"{label} is not in the Bazel workspace output tree") from error
    expected_leaf = PurePosixPath(expected_relative).name
    if (
        parts[execroot_index + 1:execroot_index + 3] != ("pagerouter", "bazel-out")
        or len(parts) != execroot_index + 6
        or parts[execroot_index + 4] != "bin"
        or parts[execroot_index + 5] != expected_leaf
    ):
        raise ValidationError(f"{label} does not resolve to its declared Bazel workspace output")
    return resolved


def file_records(root: Path) -> list[dict[str, Any]]:
    if root.is_symlink() or not root.is_dir():
        raise ValidationError(f"expected a directory tree: {root.name}")
    records: list[dict[str, Any]] = []
    for path in root.rglob("*"):
        relative = PurePosixPath(path.relative_to(root).as_posix())
        if path.is_symlink():
            raise ValidationError(f"symlink is not allowed in a declared tree: {relative.as_posix()}")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValidationError(f"non-regular file in a declared tree: {relative.as_posix()}")
        data = path.read_bytes()
        records.append({"path": relative.as_posix(), "bytes": len(data), "sha256": sha256(data)})
    records.sort(key=lambda record: record["path"].encode("utf-16-be", "surrogatepass"))
    return records


def record_set_digest(records: list[dict[str, Any]]) -> str:
    # Match the build driver's UTF-8 JSON.stringify(records) byte contract.
    body = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return sha256(body)


def check_recipe_files(recipe: dict[str, Any]) -> list[dict[str, Any]]:
    rows = recipe.get("recipe_files")
    if not isinstance(rows, list):
        raise ValidationError("site receipt is missing its recipe-file inventory")
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "bytes", "sha256"}:
            raise ValidationError("site receipt contains a malformed recipe-file record")
        relative = safe_relative_path(row.get("path")).as_posix()
        if relative in seen:
            raise ValidationError(f"duplicate recipe-file path: {relative}")
        seen.add(relative)
        expected_bytes = row.get("bytes")
        expected_hash = row.get("sha256")
        if type(expected_bytes) is not int or expected_bytes < 0:
            raise ValidationError(f"invalid byte count in recipe-file record: {relative}")
        if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            raise ValidationError(f"invalid SHA-256 in recipe-file record: {relative}")
        path = check_no_symlink(ROOT, PurePosixPath(relative))
        if not path.is_file():
            raise ValidationError(f"recipe file is missing: {relative}")
        content = path.read_bytes()
        if len(content) != expected_bytes or sha256(content) != expected_hash:
            raise ValidationError(f"recipe file differs from the site receipt: {relative}")
        records.append({"path": relative, "bytes": expected_bytes, "sha256": expected_hash})

    records.sort(key=lambda record: record["path"].encode("utf-16-be", "surrogatepass"))
    if tuple(record["path"] for record in records) != EXPECTED_RECIPE_FILES:
        raise ValidationError("recipe-file inventory differs from the reviewed Bazel recipe closure")
    if recipe.get("recipe_files_sha256") != record_set_digest(records):
        raise ValidationError("recipe-file inventory digest differs from the site receipt")
    return records


def check_manifest(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    if manifest.get("schema") != "pagerouter-source-inputs@1":
        raise ValidationError("unsupported source-manifest schema")
    canonical_files = manifest.get("canonical_files")
    if not isinstance(canonical_files, list) or not canonical_files:
        raise ValidationError("source manifest has no canonical archive records")
    canonical_by_path: dict[str, dict[str, Any]] = {}
    for row in canonical_files:
        if not isinstance(row, dict) or set(row) != {"path", "bytes", "sha256"}:
            raise ValidationError("source manifest contains a malformed canonical archive record")
        relative = safe_relative_path(row.get("path")).as_posix()
        if relative in canonical_by_path:
            raise ValidationError(f"duplicate canonical archive path: {relative}")
        if type(row.get("bytes")) is not int or row["bytes"] < 0:
            raise ValidationError(f"invalid byte count in canonical archive record: {relative}")
        if not isinstance(row.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]):
            raise ValidationError(f"invalid SHA-256 in canonical archive record: {relative}")
        canonical_by_path[relative] = row

    compiler_inputs = manifest.get("compiler_inputs")
    if not isinstance(compiler_inputs, list) or not compiler_inputs:
        raise ValidationError("source manifest has no compiler input records")

    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in compiler_inputs:
        if not isinstance(row, dict):
            raise ValidationError("source compiler input record must be an object")
        relative = safe_relative_path(row.get("path")).as_posix()
        if relative in seen:
            raise ValidationError(f"duplicate compiler input path: {relative}")
        seen.add(relative)
        if set(row) != {"path", "bytes", "sha256"}:
            raise ValidationError(f"unexpected fields in source compiler record: {relative}")
        expected_bytes = row.get("bytes")
        expected_hash = row.get("sha256")
        if type(expected_bytes) is not int or expected_bytes < 0:
            raise ValidationError(f"invalid byte count in source compiler record: {relative}")
        if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            raise ValidationError(f"invalid SHA-256 in source compiler record: {relative}")
        canonical = canonical_by_path.get(relative)
        if canonical is None or canonical["bytes"] != expected_bytes or canonical["sha256"] != expected_hash:
            raise ValidationError(f"compiler input differs from its authorized archive record: {relative}")

        path = check_no_symlink(ROOT, PurePosixPath(relative))
        if not path.is_file():
            raise ValidationError(f"compiler input is missing: {relative}")
        content = path.read_bytes()
        if len(content) != expected_bytes or sha256(content) != expected_hash:
            raise ValidationError(f"compiler input differs from its canonical source record: {relative}")
        records.append({"path": relative, "bytes": expected_bytes, "sha256": expected_hash})

    records.sort(key=lambda record: record["path"].encode("utf-16-be", "surrogatepass"))
    return records


def check_toolchain(recipe: dict[str, Any]) -> None:
    toolchain, toolchain_bytes = read_json(TOOLCHAIN_RECEIPT)
    if toolchain.get("schema") != "pagerouter-toolchain@1":
        raise ValidationError("unsupported toolchain receipt schema")
    if sha256(toolchain_bytes) != recipe.get("toolchain_receipt_sha256"):
        raise ValidationError("toolchain receipt digest does not match the site receipt")

    host_python = toolchain.get("host_python")
    if not isinstance(host_python, dict):
        raise ValidationError("toolchain receipt is missing host Python identity")
    if host_python.get("version") != "3.14.4":
        raise ValidationError("host Python version differs from the pinned acquisition runtime")
    if host_python.get("role") != "bootstrap-only; compilation uses declared Node":
        raise ValidationError("toolchain receipt assigns an unexpected role to host Python")
    executable = Path(sys.executable).resolve(strict=True)
    if host_python.get("executable_sha256") != sha256(executable.read_bytes()):
        raise ValidationError("host Python executable differs from the bootstrap observation")
    if recipe.get("bootstrap_host_python") != host_python:
        raise ValidationError("site receipt host Python identity differs from the bootstrap observation")
    check_recipe_files(recipe)

    if toolchain.get("busybox_version") != PINNED_BUSYBOX_VERSION:
        raise ValidationError("toolchain receipt has the wrong BusyBox version")
    if toolchain.get("busybox_sha256") != PINNED_BUSYBOX_SHA256:
        raise ValidationError("toolchain receipt has the wrong BusyBox binary digest")
    if recipe.get("busybox_version") != PINNED_BUSYBOX_VERSION:
        raise ValidationError("site receipt has the wrong BusyBox version")
    if recipe.get("shell_path") != "shell/bin/sh" or recipe.get("shell_sha256") != PINNED_BUSYBOX_SHA256:
        raise ValidationError("site receipt does not bind the pinned BusyBox shell")
    tool_files = toolchain.get("files")
    if not isinstance(tool_files, list):
        raise ValidationError("toolchain receipt has no declared file inventory")
    tool_records: dict[str, dict[str, Any]] = {}
    for row in tool_files:
        if not isinstance(row, dict) or set(row) != {"path", "bytes", "sha256"}:
            raise ValidationError("toolchain receipt contains a malformed file record")
        relative = safe_relative_path(row.get("path")).as_posix()
        if relative in tool_records:
            raise ValidationError(f"duplicate toolchain file record: {relative}")
        tool_records[relative] = row
    for applet in ("sh", "mkdir", "cp"):
        relative = f"shell/bin/{applet}"
        record = tool_records.get(relative)
        binary = ROOT / ".bootstrap" / "toolchain" / "shell" / "bin" / applet
        if (
            not isinstance(record, dict)
            or record.get("sha256") != PINNED_BUSYBOX_SHA256
            or type(record.get("bytes")) is not int
            or not binary.is_file()
            or record.get("bytes") != binary.stat().st_size
        ):
            raise ValidationError(f"toolchain receipt does not bind the pinned BusyBox {applet} applet")
        if binary.is_symlink() or not binary.is_file() or sha256(binary.read_bytes()) != PINNED_BUSYBOX_SHA256:
            raise ValidationError(f"pinned BusyBox {applet} applet is missing or differs from its digest")

    bootstrap_text = BOOTSTRAP.read_text(encoding="utf-8")
    expected = {
        "node_version": re.search(r'^NODE_VERSION = "([^"]+)"$', bootstrap_text, re.MULTILINE),
        "node_archive_sha256": re.search(r'^NODE_SHA = "([0-9a-f]{64})"$', bootstrap_text, re.MULTILINE),
        "bazel_sha256": re.search(r'^BAZEL_SHA = "([0-9a-f]{64})"$', bootstrap_text, re.MULTILINE),
    }
    if any(match is None for match in expected.values()):
        raise ValidationError("pinned tool identities are missing from bootstrap.py")
    expected_values = {key: match.group(1) for key, match in expected.items() if match is not None}
    if recipe.get("node_version") != expected_values["node_version"]:
        raise ValidationError("Node version differs from the pinned bootstrap recipe")
    if recipe.get("node_archive_sha256") != expected_values["node_archive_sha256"]:
        raise ValidationError("Node archive digest differs from the pinned bootstrap recipe")
    if toolchain.get("node_version") != expected_values["node_version"]:
        raise ValidationError("toolchain receipt has the wrong Node version")
    if toolchain.get("node_archive_sha256") != expected_values["node_archive_sha256"]:
        raise ValidationError("toolchain receipt has the wrong Node archive digest")
    if toolchain.get("bazel_version") != recipe.get("bazel_version"):
        raise ValidationError("Bazel version differs between receipts")
    if recipe.get("bazel_version") != PINNED_BAZEL_VERSION:
        raise ValidationError("Bazel version differs from the pinned recipe")
    if recipe.get("bazel_sha256") != expected_values["bazel_sha256"]:
        raise ValidationError("Bazel binary digest differs from the site receipt")
    if toolchain.get("bazel_sha256") != expected_values["bazel_sha256"]:
        raise ValidationError("Bazel digest differs from the pinned bootstrap recipe")
    if recipe.get("npm_version") != toolchain.get("npm_version"):
        raise ValidationError("npm version differs between receipts")
    if recipe.get("package_lock_sha256") != toolchain.get("lock_sha256"):
        raise ValidationError("npm lock identity differs between receipts")

    bazel = ROOT / ".bootstrap" / "bazel"
    node = ROOT / ".bootstrap" / "toolchain" / "node" / "bin" / "node"
    if not bazel.is_file() or sha256(bazel.read_bytes()) != expected_values["bazel_sha256"]:
        raise ValidationError("downloaded Bazel binary does not match its pinned digest")
    if not node.is_file() or sha256(node.read_bytes()) != recipe.get("node_sha256"):
        raise ValidationError("downloaded Node binary does not match the site receipt")
    if recipe.get("package_lock_sha256") != sha256(PACKAGE_LOCK.read_bytes()):
        raise ValidationError("package-lock.json differs from the site receipt")
    if recipe.get("build_driver_sha256") != sha256(BUILD_DRIVER.read_bytes()):
        raise ValidationError("build driver differs from the site receipt")
    if recipe.get("build_rule_sha256") != sha256(BUILD_RULE.read_bytes()):
        raise ValidationError("Bazel build rule differs from the site receipt")


def validate_inventory(actual: list[dict[str, Any]], expected: Any) -> None:
    if not isinstance(expected, list):
        raise ValidationError("site receipt is missing its per-file list")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in expected:
        if not isinstance(row, dict) or set(row) != {"path", "bytes", "sha256"}:
            raise ValidationError("site receipt contains a malformed file record")
        relative = safe_relative_path(row.get("path")).as_posix()
        if relative in seen:
            raise ValidationError(f"duplicate site receipt path: {relative}")
        seen.add(relative)
        if type(row.get("bytes")) is not int or row["bytes"] < 0:
            raise ValidationError(f"invalid byte count in site receipt: {relative}")
        if not isinstance(row.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]):
            raise ValidationError(f"invalid SHA-256 in site receipt: {relative}")
        normalized.append({"path": relative, "bytes": row["bytes"], "sha256": row["sha256"]})
    normalized.sort(key=lambda record: record["path"].encode("utf-16-be", "surrogatepass"))
    if actual != normalized:
        raise ValidationError("Bazel site file paths, sizes, or hashes differ from the receipt")


def validate(site: Path, receipt_path: Path) -> dict[str, Any]:
    site = declared_output_path(site, "bazel-bin/pagerouter_site.site", "site output")
    receipt_path = declared_output_path(receipt_path, "bazel-bin/pagerouter_site.receipt.json", "receipt output")
    receipt, receipt_bytes = read_json(receipt_path)
    if receipt.get("schema") != "pagerouter-site-content@1":
        raise ValidationError("unsupported site receipt schema")

    manifest, manifest_bytes = read_json(SOURCE_MANIFEST)
    input_records = check_manifest(manifest)
    if manifest.get("archive_sha256") != AUTHORIZED_ARCHIVE_SHA256:
        raise ValidationError("source manifest does not name the authorized full-source archive")
    if manifest.get("checkpoint_build_id") != AUTHORIZED_CHECKPOINT_BUILD_ID:
        raise ValidationError("source manifest does not name the authorized checkpoint build")
    source = receipt.get("source")
    recipe = receipt.get("recipe")
    site_receipt = receipt.get("site")
    if not all(isinstance(value, dict) for value in (source, recipe, site_receipt)):
        raise ValidationError("site receipt is missing source, recipe, or site identity")
    assert isinstance(source, dict) and isinstance(recipe, dict) and isinstance(site_receipt, dict)

    manifest_hash = sha256(manifest_bytes)
    if source.get("source_manifest_sha256") != manifest_hash:
        raise ValidationError("source-manifest digest differs from the site receipt")
    if source.get("archive_sha256") != manifest.get("archive_sha256"):
        raise ValidationError("canonical source archive identity differs from the site receipt")
    if source.get("checkpoint_build_id") != manifest.get("checkpoint_build_id"):
        raise ValidationError("canonical checkpoint identity differs from the site receipt")
    if source.get("compiler_input_count") != len(input_records):
        raise ValidationError("compiler input count differs from the source manifest")
    if source.get("compiler_input_set_sha256") != record_set_digest(input_records):
        raise ValidationError("compiler input set digest differs from the source manifest")
    if recipe.get("target") != "//:pagerouter_site":
        raise ValidationError("site receipt names an unexpected Bazel target")
    check_toolchain(recipe)

    actual_site = file_records(site)
    expected_files = site_receipt.get("files")
    validate_inventory(actual_site, expected_files)
    total_bytes = sum(record["bytes"] for record in actual_site)
    tree_hash = record_set_digest(actual_site)
    if site_receipt.get("path") != "pagerouter_site.site":
        raise ValidationError("site receipt names an unexpected Bazel output")
    if site_receipt.get("file_count") != len(actual_site):
        raise ValidationError("site file count differs from the receipt")
    if site_receipt.get("total_bytes") != total_bytes:
        raise ValidationError("site byte count differs from the receipt")
    if site_receipt.get("tree_sha256") != tree_hash:
        raise ValidationError("site tree digest differs from its file records")

    # Prove that the validator rejects a changed digest without changing files.
    if not actual_site:
        raise ValidationError("site output tree is empty")
    corrupted = [dict(record) for record in actual_site]
    first_hash = corrupted[0]["sha256"]
    corrupted[0]["sha256"] = ("0" if first_hash[0] != "0" else "1") + first_hash[1:]
    try:
        validate_inventory(actual_site, corrupted)
    except ValidationError:
        negative_hash_proof = "PASS: one-byte digest mutation rejected"
    else:  # pragma: no cover - validate_inventory must reject the mutated record
        raise ValidationError("negative hash proof failed to reject a changed digest")

    evidence = site.parent / "pagerouter_site.evidence"
    evidence_records = file_records(evidence)
    diagnostics = site.parent / "pagerouter_site.diagnostics.txt"
    if not diagnostics.is_file() or diagnostics.is_symlink():
        raise ValidationError("declared Bazel diagnostics output is missing or unsafe")

    return {
        "schema": "pagerouter-output-validation@1",
        "source_manifest_sha256": manifest_hash,
        "source_archive_sha256": source["archive_sha256"],
        "checkpoint_build_id": source["checkpoint_build_id"],
        "compiler_input_count": len(input_records),
        "compiler_input_set_sha256": source["compiler_input_set_sha256"],
        "receipt_sha256": sha256(receipt_bytes),
        "site_file_count": len(actual_site),
        "site_total_bytes": total_bytes,
        "site_tree_sha256": tree_hash,
        "evidence_file_count": len(evidence_records),
        "evidence_observation_sha256": record_set_digest(evidence_records),
        "diagnostics_bytes": diagnostics.stat().st_size,
        "negative_hash_proof": negative_hash_proof,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, required=True, help="declared Bazel site tree")
    parser.add_argument("--receipt", type=Path, required=True, help="declared Bazel content receipt")
    args = parser.parse_args()
    try:
        result = validate(args.site, args.receipt)
    except (OSError, KeyError, TypeError, ValidationError) as error:
        print(f"Bazel output validation failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
