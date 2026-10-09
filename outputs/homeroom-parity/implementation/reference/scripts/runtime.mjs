import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Shared runtime settings for the reference-capture scripts. Absolute overrides
// let the same scripts work from a clean PageRouter clone with browser caches
// stored elsewhere; relative output overrides resolve from the repository root.
export function captureConfig(moduleUrl) {
  const scriptDir = dirname(fileURLToPath(moduleUrl));
  const root = resolve(process.env.HH_REPO_ROOT || resolve(scriptDir, '../../..'));
  const outputRoot = resolve(root, process.env.HH_OUTPUT_ROOT || 'outputs/homeroom-parity/reference');
  const playwrightPath = resolve(process.env.HH_PLAYWRIGHT_MODULE || resolve(root, 'work/toolteam/browser/node_modules/playwright/index.mjs'));
  const executable = resolve(process.env.HH_CHROMIUM_EXECUTABLE || resolve(root, 'work/toolteam/browser/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell'));
  const referenceOrigin = (process.env.HH_REFERENCE_ORIGIN || 'https://www.helpteachers.net').replace(/\/$/, '');
  const previewBaseUrl = (process.env.HH_PREVIEW_BASE_URL || 'http://127.0.0.1:4188').replace(/\/$/, '');
  const previewLeafUrl = process.env.HH_PREVIEW_LEAF_URL || `${previewBaseUrl}/compiled/hh/index.html`;
  return {
    root,
    outputRoot,
    screenshotsDir: resolve(outputRoot, 'screenshots'),
    playwrightPath,
    executable,
    referenceOrigin,
    previewBaseUrl,
    previewLeafUrl,
    integratedUrl: process.env.HH_INTEGRATED_URL || `${previewBaseUrl}/#/hh/run`,
  };
}
