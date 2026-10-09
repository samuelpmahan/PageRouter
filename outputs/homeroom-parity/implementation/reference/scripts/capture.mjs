import {captureConfig} from './runtime.mjs';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const {root,outputRoot:output,screenshotsDir:shotDir,playwrightPath,executable,referenceOrigin,previewBaseUrl,previewLeafUrl,integratedUrl}=captureConfig(import.meta.url);
const {chromium} = await import(pathToFileURL(playwrightPath));
await mkdir(shotDir, {recursive: true});
const routes = [
  ['home', `${referenceOrigin}/pages/homepage.html`],
  ['directory', `${referenceOrigin}/pages/index.html`],
  ['register', `${referenceOrigin}/pages/register.html`],
  ['about', `${referenceOrigin}/pages/about.html`],
  ['contact', `${referenceOrigin}/pages/contact.html`],
  ['partners', `${referenceOrigin}/pages/partners.html`],
];
const localRoutes = [
  ['local-register', `${previewLeafUrl}#/register`],
  ['local-login', `${previewLeafUrl}#/login`],
  ['local-teachers', `${previewLeafUrl}#/teachers`],
];
const viewports = [
  ['desktop', {width: 1440, height: 1000}],
  ['mobile', {width: 390, height: 844}],
];
const results = [];
const browser = await chromium.launch({headless: true, executablePath: executable, args: ['--no-sandbox']});
try {
  for (const [name, url] of [...routes, ...localRoutes]) {
    for (const [size, viewport] of viewports) {
      const page = await browser.newPage({viewport, deviceScaleFactor: 1});
      const errors = [];
      const failedRequests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('requestfailed', r => failedRequests.push({url: r.url(), error: r.failure()?.errorText}));
      let response = null;
      let navigationError = null;
      try {
        response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000});
        await page.waitForTimeout(1800);
        try { await page.waitForLoadState('networkidle', {timeout: 7000}); } catch {}
      } catch (e) { navigationError = e.message; }
      const dom = await page.evaluate(() => {
        const visible = e => {
          const r = e.getBoundingClientRect(), s = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        const labelFor = e => e.labels ? [...e.labels].map(x => x.innerText.trim()).join(' ') : '';
        return {
          url: location.href, title: document.title,
          headings: [...document.querySelectorAll('h1,h2,h3,h4')].filter(visible).map(e => ({level: e.tagName, text: e.innerText.trim()})),
          links: [...document.querySelectorAll('a[href]')].filter(visible).map(e => ({text: e.innerText.trim(), href: e.href, target: e.target || ''})),
          controls: [...document.querySelectorAll('input,select,textarea,button')].filter(visible).map(e => ({
            tag: e.tagName.toLowerCase(), type: e.type || '', name: e.name || '', id: e.id || '',
            text: e.innerText?.trim() || '', ariaLabel: e.getAttribute('aria-label') || '',
            placeholder: e.getAttribute('placeholder') || '', label: labelFor(e),
            required: !!e.required, disabled: !!e.disabled, value: e.value || '',
            options: e.tagName === 'SELECT' ? [...e.options].map(o => ({text: o.text, value: o.value, selected: o.selected})) : undefined,
          })),
          images: [...document.images].filter(visible).map(e => ({src: e.currentSrc || e.src, alt: e.alt, loaded: e.complete && e.naturalWidth > 0, width: e.naturalWidth, height: e.naturalHeight})),
          fonts: {body: getComputedStyle(document.body).fontFamily, h1: document.querySelector('h1') ? getComputedStyle(document.querySelector('h1')).fontFamily : null},
          palette: {body: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color},
          viewport: {width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight},
          visibleText: document.body.innerText.slice(0, 18000),
        };
      }).catch(error => ({inspectionError: error.message}));
      const screenshot = join(shotDir, name + '-' + size + '.png');
      if (!navigationError) await page.screenshot({path: screenshot, fullPage: true});
      results.push({
        name, size, requestedUrl: url, finalUrl: dom.url || null,
        status: response?.status() ?? null, navigationError, screenshot: navigationError ? null : screenshot,
        dom, errors, failedRequests,
      });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
const evidence = {
  schema: 'homeroom-reference-browser.v1',
  capturedAt: new Date().toISOString(),
  reference: referenceOrigin,
  browser: {name: 'Chromium headless shell', executable, version: browser.version()},
  viewports: viewports.map(([name, viewport]) => ({name, ...viewport})),
  actions: ['direct public route navigation', 'read-only DOM inspection'],
  excludedActions: ['no sign-in/authentication', 'no submit', 'no donation', 'no contact', 'no form entry'],
  results,
};
await writeFile(join(output, 'BROWSER-EVIDENCE.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({screenshots: results.map(({name, size, status, finalUrl, screenshot, navigationError}) => ({name, size, status, finalUrl, screenshot, navigationError})), evidence: join(output, 'BROWSER-EVIDENCE.json')}, null, 2));
