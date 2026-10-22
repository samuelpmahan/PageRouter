# E2303 post-RED checkpoint — proposed green validation

## What changed

The only production edit is one renderer attribute on the existing `hh-public-nav-toggle` button: `aria-label="Toggle account and site navigation"`. The new test file remains exactly at SHA-256 `264f67b21ad165aab85e71c48d48d9d898ca30725418d7b2eb350f9cc98c74c5`. All existing button structure, visible `☰`, `aria-expanded`, `aria-controls`, event binding, and mobile-navigation target remain untouched.

## Actual flow

1. `header(route, journey)` computes the existing `open` value from `journey.navOpen`.
2. It constructs the existing button and adds the stable label in the attributes object; no state, event, or target changes.
3. `renderPublicSite` emits the tree. The focused regression checks the label and the existing button/navigation properties across anonymous/authenticated and closed/open synthetic states.
4. The proposed validation runs the named regression, the complete public-site test file, then the public-controller test file. The latter is expected to report 61 tests based on prior captured coverage; each actual count is authoritative. Outputs, stderr, timestamps, and exit codes are captured independently under this packet.

This is renderer-tree evidence only. It does not simulate a browser, keyboard, screen reader, accessibility tree, human, backend, or deployment. The earlier RED proved the attribute was absent from the emitted renderer tree before this one-attribute edit; no broader accessibility defect is claimed.

## Exact proposed actions

From `/workspace/scratch/8528bb251845/PageRouter`, run once:

```sh
bash /workspace/scratch/8528bb251845/hh-cycle17/H1/E2303/run-green-checks.sh
```

The runner executes these commands in order and stops after the first nonzero result:

1. `node --test --test-name-pattern=public mobile navigation toggle keeps a stable descriptive label across menu and session states checkpoint/vendor/hh/src/public-site.test.mjs`
2. `node --test checkpoint/vendor/hh/src/public-site.test.mjs`
3. `node --test checkpoint/vendor/hh/src/public-controller.test.mjs`

No command has been run from this proposal. Root review and separate validation GO are required before execution. No source/test/build/Git changes are proposed beyond the one renderer attribute already made under the implementation GO.
