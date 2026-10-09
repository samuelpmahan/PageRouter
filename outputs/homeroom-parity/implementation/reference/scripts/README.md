# Reusable reference capture scripts

These scripts use Node and the Playwright JavaScript API directly. Set `HH_REPO_ROOT` to the PageRouter repository root, and set the Playwright/Chromium/output/reference/preview overrides documented in `outputs/homeroom-parity/reference/CAPTURE-REPRODUCTION.md`. The local routes target the assembled `/compiled/hh/index.html` leaf. Forum capture scripts block non-GET and ad/analytics traffic.

Evidence is written to `outputs/homeroom-parity/reference/` unless `HH_OUTPUT_ROOT` is set. These scripts are investigation helpers; they do not alter the product.
