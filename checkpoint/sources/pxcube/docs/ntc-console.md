# NTC stays above the Experiences

The launcher is now a persistent workspace shell. Its navigation and neat →
tidy → crisp strip stay visible when an Experience is open. An Experience frame
occupies the workspace inside that shell; opening the work, manifest, build or
mount view hides the frame without removing it. Reopening uses the same iframe
and the same owning runtime. No new domain store is introduced in the parent.

The build program supplies a retained `ntc-state.json` to the launcher. It holds
the actual neat work items, tidy type definitions, package results and measured
build durations for this artifact. The launcher embeds that snapshot in the
page. Its resource inspectors read that snapshot rather than mixing it with a
later build. The header names the artifact and its working-tree snapshot digest.
The recorded Git base is ancestry provenance only: neat can package and verify
staged, unstaged, and relevant untracked owned inputs before a promotion commit.

The Mounts view reads the APIs already exposed by opened sandboxes:
`pxCubeExperience`, `pxCubeScaffold`, or `pxCubeMocks`. It lists real owner names
and interactive/test identities. Inspect owner reads that owner's current value
on demand. Counts refresh every two seconds; full domain snapshots are read only
when inspection is requested. A frame without an exposed inspector is labelled
unavailable, not reported as an empty or healthy store.

Packaged and opened are separate states. Hidden contexts keep running; this is
not a pause API, CPU scheduler, hostile-code boundary, or Kubernetes controller.
The operations currently available from NTC are opening/resuming a frame,
switching the control view, inspecting work/manifests/builds/owners, refreshing
mounts, and deliberately loading a newer artifact. Build invocation stays with
the shared Node program; no pretend browser build button is added.

A new build shows a reload offer. It does not replace a loaded Experience or
rewrite its displayed manifest/build identity until the user reloads.

Implementation:

- `local/run.mjs`: supplies the retained control-layer snapshot.
- `launcher/build-launcher.mjs`: assembles the shell around packaged Experiences.
- `launcher/shell.html`, `shell.css`, `shell.mjs`: the persistent NTC workspace.
- `local/test/ntc-browser.mjs`: real-data checks and exact iframe-identity witness
  across all control views, draft retention, mobile layout, and newer-build notice.

The E2E test normally uses the local preview. `NTC_FIXTURE=1` instead creates an
empty temporary workspace, generates BuildBag through crisp and starts an
isolated artifact server. CI uses that path before building the real deployment.
