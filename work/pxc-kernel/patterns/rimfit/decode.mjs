import { WORK, cases } from './paths.mjs';
// Decode every truth-set photo the way DiscStudio's upload step does (createImageBitmap -> canvas getImageData), plus the
// 720 px working raster it draws for the circle candidates, and store the raw RGBA bytes so Node implementations see
// exactly the browser's pixels.
import { chromium } from 'playwright';
import fs from 'node:fs'; import crypto from 'node:crypto';
const cases = cases;
const OUT = `${WORK}/raw`;
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent('<html><body></body></html>');
const index = [];
for (const c of cases) {
  const bytes = fs.readFileSync(c.file);
  const r = await p.evaluate(async (b64) => {
    const blob = await (await fetch('data:image/jpeg;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const full = new OffscreenCanvas(bmp.width, bmp.height); full.getContext('2d').drawImage(bmp, 0, 0);
    const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
    const ww = Math.max(1, Math.round(bmp.width * scale)), wh = Math.max(1, Math.round(bmp.height * scale));
    const work = new OffscreenCanvas(ww, wh); work.getContext('2d').drawImage(bmp, 0, 0, ww, wh);
    const enc = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
    return { w: bmp.width, h: bmp.height, ww, wh, full: enc(full.getContext('2d').getImageData(0, 0, bmp.width, bmp.height).data), work: enc(work.getContext('2d').getImageData(0, 0, ww, wh).data) };
  }, bytes.toString('base64'));
  const full = Buffer.from(r.full, 'base64'), work = Buffer.from(r.work, 'base64');
  fs.writeFileSync(`${OUT}/${c.name}.rgba`, full); fs.writeFileSync(`${OUT}/${c.name}.work.rgba`, work);
  index.push({ name: c.name, path: `${OUT}/${c.name}.rgba`, width: r.w, height: r.h, working: { path: `${OUT}/${c.name}.work.rgba`, width: r.ww, height: r.wh },
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), rgbaSha256: crypto.createHash('sha256').update(full).digest('hex') });
  process.stdout.write('.');
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1)); await b.close(); console.log('\n', index.length);
