import { WORK, cases } from './paths.mjs';
// Parity: run v3 + refinement inside the real page on canvas pixels (the app's own path) and compare with Node on the same photo.
import { chromium } from 'playwright'; import fs from 'node:fs'; import crypto from 'node:crypto';
const idx = JSON.parse(fs.readFileSync(`${WORK}/raw/index.json`,'utf8'));
const cases = cases;
const b = await chromium.launch(); const p = await b.newPage(); await p.goto('http://localhost:4173/');
const out = [];
for (const n of (process.argv[2] || 'servo-01-original,servo-05-tight,anchor-01-original').split(',')) {
  const c = cases.find(x => x.name === n);
  const r = await p.evaluate(async (b64) => {
    const blob = await (await fetch('data:image/jpeg;base64,' + b64)).blob(); const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const { recoverRimEllipseV3 } = await import('./rimfit-v3/recover.mjs');
    const { runEllipseFitReview } = await import('./experimental/ellipse-fit-fix/ellipse-review-flow.mjs');
    const worker = { recover: async (img, opt) => recoverRimEllipseV3(img, opt) };
    const review = await runEllipseFitReview({ worker, image: { width: bmp.width, height: bmp.height, data } });
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).map(x => x.toString(16).padStart(2, '0')).join('');
    const pr = review.proposal ?? {};
    return { digest, status: pr.status, refinement: pr.refinement?.status ?? null, ellipse: pr.ellipse ?? null };
  }, fs.readFileSync(c.file).toString('base64'));
  const rec = idx.find(x => x.name === n);
  out.push({ name: n, browserPixelsSha: r.digest, nodePixelsSha: rec.rgbaSha256, samePixels: r.digest === rec.rgbaSha256, browser: r });
  console.log(n, 'same pixels', r.digest === rec.rgbaSha256, JSON.stringify(r));
}
fs.writeFileSync(`${WORK}/parity-browser.json`, JSON.stringify(out, null, 1)); await b.close();
