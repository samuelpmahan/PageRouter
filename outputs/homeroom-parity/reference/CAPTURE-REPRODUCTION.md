# Reproducing the reference captures

The scripts are reusable for a fresh PageRouter clone. They use Playwright’s JavaScript library directly from Node; they do not invoke the Playwright CLI or an MCP browser. No npm install or browser download is needed when the Playwright module, Chromium executable, and shared libraries are already available in an external cache.

## Required settings

From the PageRouter repository root, set these variables for the current workspace’s cached runtime. `HH_OUTPUT_ROOT` may be absolute or relative to `HH_REPO_ROOT`.

```bash
export HH_REPO_ROOT="$PWD"
export HH_PLAYWRIGHT_MODULE="$PWD/work/toolteam/browser/node_modules/playwright/index.mjs"
export HH_CHROMIUM_EXECUTABLE="$PWD/work/toolteam/browser/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell"
export HH_OUTPUT_ROOT="outputs/homeroom-parity/reference"
export HH_REFERENCE_ORIGIN="https://www.helpteachers.net"
export HH_PREVIEW_BASE_URL="http://127.0.0.1:4188"
export HH_PREVIEW_LEAF_URL="$HH_PREVIEW_BASE_URL/compiled/hh/index.html"
export HH_INTEGRATED_URL="$HH_PREVIEW_BASE_URL/#/hh/run"
export LD_LIBRARY_PATH="$PWD/work/toolteam/browser/deps/usr/lib/x86_64-linux-gnu:$PWD/work/toolteam/browser/deps/lib/x86_64-linux-gnu:$PWD/work/toolteam/browser/deps/usr/lib:$PWD/work/toolteam/browser/deps/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
NODE="$PWD/work/toolteam/inventory/runtime-cache/node-v24.19.0-linux-x64/bin/node"
```

For a fresh clone, point `HH_PLAYWRIGHT_MODULE` and `HH_CHROMIUM_EXECUTABLE` at the already available external browser cache. `HH_PREVIEW_BASE_URL` must serve the whole assembled `checkpoint/dist` tree; the leaf defaults to `/compiled/hh/index.html` and the integrated route defaults to `/#/hh/run`. If the server uses another URL/path, set `HH_PREVIEW_LEAF_URL` and/or `HH_INTEGRATED_URL`. `HH_REFERENCE_ORIGIN` can select another explicitly authorized reference host. `HH_OUTPUT_ROOT` changes where screenshots and JSON evidence are written.

The Node binary and Linux shared libraries are runtime dependencies, separate from the PageRouter clone. Use a compatible Node runtime and set `LD_LIBRARY_PATH` to the supplied browser cache’s library directories. Do not install or download them as part of capture.

## Commands

The focused scripts are independent. Run only the evidence set needed; the first script includes six live pages and three assembled local routes at desktop/mobile sizes.

```bash
"$NODE" work/homeroom-parity/reference/capture.mjs
"$NODE" work/homeroom-parity/reference/capture-interactions.mjs
"$NODE" work/homeroom-parity/reference/capture-public-journeys.mjs
"$NODE" work/homeroom-parity/reference/capture-discoverability.mjs
"$NODE" work/homeroom-parity/reference/capture-local.mjs
"$NODE" work/homeroom-parity/reference/capture-local-flow.mjs
"$NODE" work/homeroom-parity/reference/capture-integrated.mjs
```

`capture.mjs` now compares against `http://127.0.0.1:4188/compiled/hh/index.html#/register`, `/login`, and `/teachers` by default. This corrects its earlier source-root hash routes. The initially failed source-only capture remains preserved in its existing evidence file and is not overwritten by this script.

Live scripts perform public read-only navigation and the small documented UI interactions only. They must not submit forms, authenticate, contact, donate, or activate external transactions. `capture-local-flow.mjs` drives only the explicit browser-session fixture and checks that requests remain on `HH_PREVIEW_BASE_URL`.
