import fs from 'node:fs';
import { chromium } from '/Users/samuelmahan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
const evidence = { errors: [], requests: [] };
page.on('pageerror', e => evidence.errors.push(e.message));
page.on('requestfailed', r => evidence.requests.push({ url: r.url(), failure: r.failure() }));
try {
  await page.goto('https://samuelpmahan.github.io/PxCube/');
  await page.locator('button.card[data-id="mock-smoke"]').click();
  await page.frameLocator('#thing').locator('#smoke').waitFor();
  const inspect = () => page.locator('#thing').evaluate(f => ({
    ownerReady: Boolean(f.contentWindow.pxCubeMocks), handlerReady: typeof f.contentDocument.getElementById('smoke').onclick === 'function',
    status: f.contentDocument.getElementById('status').textContent, smoke: f.contentWindow.pxCubeSmoke ?? null,
  }));
  evidence.beforeClick = await inspect();
  await page.frameLocator('#thing').locator('#smoke').click();
  evidence.afterClick = await inspect();
  await page.waitForFunction(() => !!document.querySelector('#thing')?.contentWindow?.pxCubeMocks);
  evidence.whenReady = await inspect();
  if (!evidence.whenReady.smoke) await page.frameLocator('#thing').locator('#smoke').click();
  await page.waitForFunction(() => !!document.querySelector('#thing')?.contentWindow?.pxCubeSmoke);
  evidence.finished = await inspect();
} catch (e) { evidence.failure = e.stack; }
finally {
  fs.writeFileSync(new URL('./mock-probe.json', import.meta.url), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2)); await browser.close();
}
