// Render a card from an already-made cutout PNG (for the quad/square Calculation prototype): node render-cut.mjs CUT.png OUTBASE "Mold" "Maker" "7,7,-3,2" "#accent"
import fs from 'node:fs';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const [cutPath, outBase, mold, maker, flightStr, accent, shape, cornerFrac] = process.argv.slice(2);
const outlineFile = cutPath.replace(/\.png$/, '-outline.json'), discOutline = shape === 'outline' && fs.existsSync(outlineFile) ? JSON.parse(fs.readFileSync(outlineFile, 'utf8')).points : null;
const cutSrc = 'data:image/png;base64,' + fs.readFileSync(cutPath).toString('base64');
const b = await chromium.launch(), p = await b.newPage(); p.on('pageerror', e => console.log('pageerror', String(e)));
await p.goto('http://localhost:8811/render.html'); await p.waitForFunction(() => window.ready, null, { timeout: 60000 });
const r = await p.evaluate(async ([cutSrc, mold, maker, flights, accent, shape, cornerFrac, discOutline]) => {
  const V = '?v=28ac2b39fab85255';
  const A = await import(`./vendor/discstudio-cards/thro-adapter.mjs${V}`), M = await import(`./vendor/discstudio-cards/mold-library.js${V}`);
  const toURL = b => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
  const hits = M.searchMolds(mold, 8), rec = hits.find(h => h.mold.toLowerCase() === mold.toLowerCase());
  const out = {};
  for (const [key, scale, type] of [['u02', 1, 'image/webp'], ['png2x', 1.5, 'image/png']]) {
    const r = await A.renderDiscStudioCard({ disc: { id: 'x', mold: rec?.id ?? 'unknown', name: mold, manufacturer: maker, plastic: null, weight: null }, photoSrc: cutSrc, flights, preset: 'u02', revision: A.cardRevisions?.['u02'], scale, appearance: { ...(accent ? { accentColor: accent } : {}), ...(discOutline ? { discOutline } : shape === 'square' ? { discShape: shape, discCornerRadius: cornerFrac } : {}) } });
    const b = r.layout.card, bm = await createImageBitmap(r.png), t = new OffscreenCanvas(Math.round(b.w), Math.round(b.h)); t.getContext('2d').drawImage(bm, b.x, b.y, b.w, b.h, 0, 0, t.width, t.height);
    out[key] = await toURL(await t.convertToBlob(type === 'image/webp' ? { type, quality: 0.9 } : { type }));
  }
  return out;
}, [cutSrc, mold, maker, flightStr.split(',').map(Number), accent, shape, Number(cornerFrac), discOutline]);
const save = (u, f) => fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64'));
save(r.u02, `${outBase}-u02.webp`); save(r.png2x, `${outBase}-card.png`); fs.copyFileSync(cutPath, `${outBase}-cut.png`);
console.log('wrote', outBase); await b.close();
