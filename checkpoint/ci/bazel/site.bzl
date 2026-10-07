"""A source build in private staging, with declared site/evidence tree outputs."""
def _site_impl(ctx):
    site = ctx.actions.declare_directory(ctx.label.name + ".site")
    evidence = ctx.actions.declare_directory(ctx.label.name + ".evidence")
    receipt = ctx.actions.declare_file(ctx.label.name + ".receipt.json")
    log = ctx.actions.declare_file(ctx.label.name + ".log")
    args = ctx.actions.args()
    args.add_all([site.path, evidence.path, receipt.path, log.path])
    for source in ctx.files.srcs:
        args.add_all(["--source", source.short_path, source.path])
    for tool in ctx.files.deps:
        # All external files belong to the single declared build_tools repo.
        args.add_all(["--tool", tool.short_path[len("../build_tools/"): ], tool.path])
    args.set_param_file_format("multiline")
    args.use_param_file("@%s", use_always = True)
    ctx.actions.run(
        executable = ctx.executable.node,
        arguments = [ctx.file._driver.path, args],
        inputs = depset(ctx.files.srcs + ctx.files.deps + [ctx.file._driver, ctx.file._helpers]),
        tools = [ctx.attr.node[DefaultInfo].files_to_run],
        outputs = [site, evidence, receipt, log],
        env = {"LANG": "C.UTF-8", "TZ": "UTC"},
        mnemonic = "PageRouterSourceBuild",
        progress_message = "Building and verifying PageRouter from source",
    )
    return [DefaultInfo(files = depset([site, evidence, receipt, log]))]

pagerouter_site = rule(
    implementation = _site_impl,
    attrs = {
        "srcs": attr.label_list(allow_files = True),
        "deps": attr.label_list(allow_files = True),
        "node": attr.label(executable = True, cfg = "exec", allow_single_file = True),
        "_driver": attr.label(default = "//ci/bazel:build-driver.mjs", allow_single_file = True),
        "_helpers": attr.label(default = "//ci/bazel:build-helpers.mjs", allow_single_file = True),
    },
)
