"""Declared Bazel action for the full pinned PageRouter source build."""

PagerouterSiteInfo = provider(fields = {
    "site": "Fresh assembled static-site tree artifact",
    "evidence": "Fresh build evidence tree artifact",
    "receipt": "Canonical site-content receipt",
    "diagnostics": "Human-readable build-stage transcript",
    "srcs": "Exact compiler source inputs",
    "deps": "Pinned Node/npm dependency closure",
    "dependency_prefix": "External repository prefix in File.short_path",
    "node": "Pinned Node executable",
    "driver": "Node build driver",
    "source_manifest": "Source archive/input manifest",
    "recipe_files": "Bazel recipe files included in the action identity",
    "bazel_version": "Pinned Bazel version",
    "target": "Canonical main-repository target label",
})

def _short_path(file):
    return file.short_path

def _add_file_pairs(args, flag, files):
    for file in sorted(files, key = _short_path):
        args.add(flag)
        args.add(file.short_path)
        args.add(file.path)

def _pagerouter_site_impl(ctx):
    site = ctx.actions.declare_directory(ctx.label.name + ".site")
    evidence = ctx.actions.declare_directory(ctx.label.name + ".evidence")
    receipt = ctx.actions.declare_file(ctx.label.name + ".receipt.json")
    diagnostics = ctx.actions.declare_file(ctx.label.name + ".diagnostics.txt")

    args = ctx.actions.args()
    args.add("build")
    args.add("--source-manifest")
    args.add(ctx.file.source_manifest.path)
    args.add("--dependency-prefix")
    args.add(ctx.attr.dependency_prefix)
    args.add("--node-binary")
    args.add(ctx.executable.node.path)
    args.add("--bazel-version")
    args.add(ctx.attr.bazel_version)
    args.add("--target")
    target = "//%s:%s" % (ctx.label.package, ctx.label.name)
    args.add(target)
    args.add("--site-output")
    args.add(site.path)
    args.add("--evidence-output")
    args.add(evidence.path)
    args.add("--receipt-output")
    args.add(receipt.path)
    args.add("--diagnostics-output")
    args.add(diagnostics.path)
    _add_file_pairs(args, "--source-input", ctx.files.srcs)
    _add_file_pairs(args, "--dependency-input", ctx.files.deps)
    _add_file_pairs(args, "--recipe-input", ctx.files.recipe_files)
    args.set_param_file_format("multiline")
    args.use_param_file("@%s", use_always = True)

    action_inputs = depset(
        ctx.files.srcs +
        ctx.files.deps +
        ctx.files.recipe_files +
        [ctx.file.source_manifest, ctx.file._driver, ctx.file._rule, ctx.executable.node],
    )
    ctx.actions.run(
        executable = ctx.executable.node,
        arguments = [ctx.file._driver.path, args],
        inputs = action_inputs,
        tools = [ctx.attr.node[DefaultInfo].files_to_run],
        outputs = [site, evidence, receipt, diagnostics],
        env = {
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "TZ": "UTC",
        },
        use_default_shell_env = False,
        mnemonic = "PageRouterSourceBuild",
        progress_message = "Compiling full PageRouter source with declared Bazel inputs",
    )

    return [
        DefaultInfo(files = depset([site, evidence, receipt, diagnostics])),
        PagerouterSiteInfo(
            site = site,
            evidence = evidence,
            receipt = receipt,
            diagnostics = diagnostics,
            srcs = ctx.files.srcs,
            deps = ctx.files.deps,
            dependency_prefix = ctx.attr.dependency_prefix,
            node = ctx.executable.node,
            driver = ctx.file._driver,
            source_manifest = ctx.file.source_manifest,
            recipe_files = ctx.files.recipe_files,
            bazel_version = ctx.attr.bazel_version,
            target = target,
        ),
    ]

pagerouter_site = rule(
    implementation = _pagerouter_site_impl,
    attrs = {
        "srcs": attr.label_list(allow_files = True, mandatory = True),
        "deps": attr.label_list(allow_files = True, mandatory = True),
        "dependency_prefix": attr.string(mandatory = True),
        "node": attr.label(executable = True, cfg = "exec", allow_files = True, mandatory = True),
        "source_manifest": attr.label(allow_single_file = True, mandatory = True),
        "recipe_files": attr.label_list(allow_files = True, mandatory = True),
        "bazel_version": attr.string(default = "7.4.1"),
        "_driver": attr.label(
            default = Label("//ci/bazel:build_driver.mjs"),
            allow_single_file = True,
        ),
        "_rule": attr.label(
            default = Label("//ci/bazel:build_rule.bzl"),
            allow_single_file = True,
        ),
    },
)
