"""Run the existing repository tests against fresh outputs from pagerouter_site."""

load(":build_rule.bzl", "PagerouterSiteInfo")

def _record(file, runfile):
    return {"path": file.short_path, "runfile": runfile}

def _short_path(file):
    return file.short_path

def _verify_impl(ctx):
    info = ctx.attr.build[PagerouterSiteInfo]
    symlinks = {}

    source_inputs = []
    for file in sorted(info.srcs, key = _short_path):
        runfile = "source/" + file.short_path
        symlinks[runfile] = file
        source_inputs.append(_record(file, runfile))

    dependency_inputs = []
    for file in sorted(info.deps, key = _short_path):
        short_path = file.short_path
        if not short_path.startswith(info.dependency_prefix):
            fail("Dependency is outside the pinned tool repository: " + short_path)
        runfile = "toolchain/" + short_path[len(info.dependency_prefix):]
        symlinks[runfile] = file
        dependency_inputs.append({"short_path": short_path, "runfile": runfile})

    recipe_inputs = []
    for file in sorted(info.recipe_files, key = _short_path):
        runfile = "recipe/" + file.short_path
        symlinks[runfile] = file
        recipe_inputs.append(_record(file, runfile))

    symlinks["metadata/source-manifest.json"] = info.source_manifest
    symlinks["driver/build_driver.mjs"] = info.driver
    symlinks["build/site"] = info.site
    symlinks["build/evidence"] = info.evidence
    symlinks["build/receipt.json"] = info.receipt
    symlinks["build/diagnostics.txt"] = info.diagnostics

    plan = {
        "schema": "pagerouter-verify-plan@1",
        "target": info.target,
        "dependency_prefix": info.dependency_prefix,
        "node": "toolchain/node/bin/node",
        "source_manifest": "metadata/source-manifest.json",
        "source_inputs": source_inputs,
        "dependency_inputs": dependency_inputs,
        "recipe_inputs": recipe_inputs,
        "site": "build/site",
        "evidence": "build/evidence",
        "receipt": "build/receipt.json",
        "diagnostics": "build/diagnostics.txt",
    }
    plan_file = ctx.actions.declare_file(ctx.label.name + ".plan.json")
    symlinks["plan/verify.json"] = plan_file
    ctx.actions.write(plan_file, json.encode(plan) + "\n")

    launcher = ctx.actions.declare_file(ctx.label.name + ".sh")
    ctx.actions.write(
        output = launcher,
        content = """#!/bin/sh
set -eu
runfiles_root="${TEST_SRCDIR}/${TEST_WORKSPACE}"
exec "${runfiles_root}/toolchain/node/bin/node" \
  "${runfiles_root}/driver/build_driver.mjs" verify \
  --plan "${runfiles_root}/plan/verify.json"
""",
        is_executable = True,
    )
    return [DefaultInfo(
        executable = launcher,
        runfiles = ctx.runfiles(symlinks = symlinks),
    )]

pagerouter_verify_test = rule(
    implementation = _verify_impl,
    attrs = {
        "build": attr.label(providers = [PagerouterSiteInfo], mandatory = True),
    },
    test = True,
)

def pagerouter_verify(name, build):
    pagerouter_verify_test(name = name, build = build)
