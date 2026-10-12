# Kernels

Small pure functions that several PageRouter modules shared as copies. Each
was extracted here only after a control: the trusted library that defines the
job (an RFC implementation, a widely used package) passes its own test suite
in the extraction harness, then every copy in PageRouter runs the same suite,
and the behavior classes that result decide how many kernels there are.

Rules, enforced by `layout.test.mjs`:

- A kernel module imports only other kernel modules. It ships to the browser
  under `exp/kernel/` and runs in Node, unchanged, in both.
- Every kernel module has a `<name>.test.mjs` beside it.

From an `exp/<folder>/` module, import `../kernel/<name>.mjs`. From a `src/`
module, import `../exp/kernel/<name>.mjs`; the site build rewrites it to
`./exp/kernel/<name>.mjs`, because `src/` ships at the site root.
