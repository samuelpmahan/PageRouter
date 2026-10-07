import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { root } from '../run.mjs';
import { criticalJourneyPlans, requiredViewports } from '../critical-journeys.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const latest = JSON.parse(fs.readFileSync(path.join(root, '.pxcube/latest.json')));
const site = path.join(root, latest.site);
const evidence = path.join(root, 'evidence', 'critical-journeys');
fs.mkdirSync(evidence, { recursive: true });
const errors = [], checks = [], viewportReport = [];
const server = http.createServer((request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/PxCube/')) throw Error('prefix');
    const file = path.resolve(site, decodeURIComponent(pathname.slice('/PxCube/'.length)) || 'index.html');
    if (!file.startsWith(site + path.sep)) throw Error('outside artifact');
    const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });

async function nativeAndUncovered(frame, selector) {
  return frame.locator(selector).evaluate(node => {
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute('role');
    const native = ['button', 'a', 'input', 'select', 'textarea'].includes(tag) || ['button', 'tab', 'link'].includes(role);
    const box = node.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { native, disabled: node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true', uncovered: top === node || node.contains(top), box: { width: box.width, height: box.height } };
  });
}

async function assertChecklistPlacement(page, viewportName, viewport) {
  const checklist = page.locator('tick-part-checklist');
  await checklist.waitFor();
  const state = await checklist.evaluate(host => {
    const open = host.shadowRoot.querySelector('#open');
    const shell = host.shadowRoot.querySelector('.w');
    const hostBox = host.getBoundingClientRect(), openBox = open?.getBoundingClientRect();
    return {
      hostBox: { right: hostBox.right, bottom: hostBox.bottom },
      openBox: openBox && { right: openBox.right, bottom: openBox.bottom },
      hostPointerEvents: getComputedStyle(host).pointerEvents,
      wrapperPointerEvents: getComputedStyle(shell).pointerEvents,
      triggerPointerEvents: open && getComputedStyle(open).pointerEvents,
    };
  });
  assert.equal(state.hostPointerEvents, 'none', `${viewportName}: checklist host must not intercept Experience input`);
  assert.equal(state.wrapperPointerEvents, 'none', `${viewportName}: checklist wrapper must not intercept Experience input`);
  assert.equal(state.triggerPointerEvents, 'auto', `${viewportName}: checklist trigger must remain accessible`);
  assert.ok(state.openBox && state.openBox.right >= viewport.width - 28 && state.openBox.bottom >= viewport.height - 28, `${viewportName}: collapsed Checklist trigger must be bottom-right`);
}

try {
  const base = `http://127.0.0.1:${server.address().port}/PxCube/`;
  for (const { id, journey } of criticalJourneyPlans(root)) {
    for (const viewportName of journey.viewports) {
      const viewport = requiredViewports[viewportName];
      // A new isolated context proves the declared start state instead of
      // accidentally inheriting a prior selection or retained local storage.
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(`${id}/${viewportName}: ${error.message}`));
      await page.goto(base);
      await assertChecklistPlacement(page, viewportName, viewport);
      await page.locator('[data-tab="exp"]').click();
      await page.locator(`button.card[data-id="${id}"]`).click();
      const frame = page.frameLocator('#thing');
      await frame.locator('#status').filter({ hasText: 'Ready' }).waitFor();
      const iframeViewport = await page.locator('#thing').evaluate(node => ({ width: node.clientWidth, height: node.clientHeight }));
      viewportReport.push({ experience: id, viewport: viewportName, requested: viewport, iframe: iframeViewport });
      assert.ok(iframeViewport.width > 0 && iframeViewport.height > 0, `${id}/${viewportName}: shell supplied an empty iframe`);

      const start = await nativeAndUncovered(frame, journey.start.selector);
      assert.ok(start.native && !start.disabled && start.uncovered, `${id}/${viewportName}: start control is not a live, uncovered native/ARIA action`);
      await frame.locator(journey.start.selector).click();
      assert.equal(await frame.locator(journey.initial.selector).getAttribute(journey.initial.attribute), journey.initial.value, `${id}/${viewportName}: fresh journey did not start in its declared state`);
      assert.equal(await frame.locator(journey.activePanelSelector).count(), 1, `${id}/${viewportName}: more than one task panel is active`);
      for (const step of journey.actions[viewportName]) {
        const control = await nativeAndUncovered(frame, step.selector);
        assert.ok(control.native && !control.disabled && control.uncovered, `${id}/${viewportName}: ${step.selector} is not a live, uncovered native/ARIA action`);
        await frame.locator(step.selector).click();
        if (step.expect) await frame.locator(step.expect).waitFor();
        if (step.attribute) assert.equal(await frame.locator(step.selector).getAttribute(step.attribute), step.value, `${id}/${viewportName}: ${step.selector} did not execute`);
        assert.equal(await frame.locator(journey.activePanelSelector).count(), 1, `${id}/${viewportName}: action left more than one task panel active`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${id}/${viewportName}: shell overflows horizontally`);
      assert.equal(await page.locator('#thing').evaluate(frameNode => frameNode.contentDocument.documentElement.scrollWidth <= frameNode.contentWindow.innerWidth), true, `${id}/${viewportName}: Experience overflows horizontally`);
      await page.screenshot({ path: path.join(evidence, `${id}-${viewportName}.png`) });
      checks.push(`${id}: ${viewportName} declared journey executed through live controls in ${iframeViewport.width}×${iframeViewport.height} iframe`);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ runId: latest.runId, checks, viewportReport, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ checks, viewportReport, errors }));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'browser-failure.json'), JSON.stringify({ runId: latest.runId, checks, viewportReport, errors, error: error.stack }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
