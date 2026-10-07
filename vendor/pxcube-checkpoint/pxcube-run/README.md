# PxCube

The PxC hypervisor. Any PxC app slots in: declared in a manifest, built however it wants, sandboxed, deployed, and reviewable on one Page.

Like minikube for Kubernetes: full fidelity, zero special-casing. An app cannot tell whether it runs against a mock or a real backend, on Pages or local. The manifest plus the PxC facade are the entire contract.

## The contract

A PxC app addresses the world only through mounts:

```
{MOUNT}.{px|fn|oc|sc}.*
```

`px` values, `fn` pure calculations, `oc` effectful calculations, `sc` scratch.

The mount prefix resolves at the hypervisor seam and never persists into the address. Inside a world the address keeps one meaning everywhere. Mock vs real is decided behind the seam, where the app cannot see it.

## Lanes

- **neat** owns the work. Every exp THING is a neat item: the climb, the spec, the evidence.
- **tidy** owns the registry. Every app registered; milestone state; registered tests. Deployment reads tidy. Manifest proposes, tidy disposes.
- **crisp** owns execution. The only thing that acts across boundaries: builds, tests, packages, deploys. Same binary locally and in CI, so the workflow stays a thin wrapper.

## The Page

One GitHub Page, the review surface:

- **Clean** tab: what tidy baselined. The trunk.
- **Exp** tab: the jungle. Ninja builds and beautiful failures.
- **Manifests** accordion: every manifest key, with wired-in extras surfacing automatically. Tests and receipts per app.

Each THING runs sandboxed in its own frame. A crashing experiment cannot sink the shelf.

## Layout

- `spec/` — the app/hypervisor contract
- `launcher/` — the Pages launcher generator
- `experiences/` — the apps. Each ships its own THING via `experience.json`
- `.github/workflows/` — the Actions workflow (thin crisp wrapper)
- `package/` — crisp's build+package pipeline (arriving)
- `mock-pxc/` and `fixtures/` — mock backend and smoke tests (arriving)

## Local candidate

`node local/run.mjs dev` builds through the pinned neat/tidy tools and Muse's crisp,
then serves the launcher at http://127.0.0.1:4321/. See [local execution, retained
MockPxC iterations, evidence and limits](docs/local-pages.md).

Pages and local assembly share a dependency-aware package cache; see the
[NTC release path](docs/ntc-release.md) for the affected-target graph and the
complete-site deployment rule.
