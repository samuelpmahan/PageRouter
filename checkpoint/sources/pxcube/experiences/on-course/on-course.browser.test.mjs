import test from 'node:test';
import assert from 'node:assert/strict';

// Run against the local PxCube server (PXCUBE_ON_COURSE_URL may point at a
// Pages-style mounted build). This catches DOM-order regressions that syntax
// and packaging checks cannot see.
test('On Course mounts both view tabs without runtime errors', async (t) => {
  let chromium;
  try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')); }
  catch { t.skip('Playwright is not installed in this workspace'); return; }
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(process.env.PXCUBE_ON_COURSE_URL ?? 'http://127.0.0.1:4324/experiences/on-course/index.html');
    await page.locator('#course-create').waitFor();
    await page.locator('#course-export').click();
    await page.locator('#course-export[aria-pressed="true"]').waitFor();
    await page.locator('#course-create').click();
    await page.locator('#course-create[aria-pressed="true"]').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
