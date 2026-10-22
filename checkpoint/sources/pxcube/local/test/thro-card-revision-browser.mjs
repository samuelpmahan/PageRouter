// Card revisions in a real browser (Sam's rule: the disc photo is never rotated; U04's manufacturer sits below the
// flight numbers). For every disc, B01 and U04 are drawn at revision 1 and at revision 2, in both orders, in two pages.
// Fails unless: the two revisions differ; each (disc, layout, revision) gives the same pixels whichever was drawn first
// (DiscStudio's sticker cache is keyed by card identity, so a revision missing from it serves one revision for the other);
// B01 is tilted 12° at revision 1 and upright at revision 2; U04's manufacturer is below the numbers only at revision 2.
// Usage: node thro-card-revision-browser.mjs http://localhost:8766/index.html   (exits 1 on any failure)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const url = new URL(process.argv[2]); url.searchParams.set('debug', '1');
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function draw(reverse) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(url.href); await p.waitForFunction(() => window.throQA, null, { timeout: 60000 });
  const rows = await p.evaluate(async reverse => {
    const nc = await import(new URL('./native-cards.mjs', location.href).href);
    const adapter = await import(new URL('./vendor/discstudio-cards/thro-adapter.mjs', location.href).href);
    const model = window.throQA.workspace.model, out = [];
    // A 192 × 108 fingerprint: a card served from the wrong revision differs by far more than the rasteriser's ±1 rounding.
    const pixels = async png => { const bitmap = await createImageBitmap(png), canvas = new OffscreenCanvas(192, 108), context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, 192, 108); return Array.from(context.getImageData(0, 0, 192, 108).data); };
    for (const row of await model.shelfForDisplay()) {
      const disc = model.value(row.address), resolved = model.experience.resolve(disc);
      for (const preset of Object.keys(nc.cardRevisions)) {
        const revisions = [1, nc.cardRevisions[preset]]; if (reverse) revisions.reverse();
        for (const revision of revisions) {
          const design = nc.nativeDesign(model.context.design, `discstudio:${preset}`); delete design.nativeRevision; if (revision > 1) design.nativeRevision = revision;
          const result = await adapter.renderDiscStudioCard(nc.nativeCardRequest({ disc, resolved, design })), L = result.layout;
          out.push({ disc: disc.id, preset, revision, reported: result.revision, pixels: await pixels(result.png), tilt: Math.round(L.photo?.angle ?? 0),
            numbers: L.numbers?.size ?? 0, other: Math.max(0, ...L.other.map(x => x.size)) });
        }
      }
    }
    return out;
  }, reverse);
  await p.close(); return rows;
}
const forward = await draw(false), backward = await draw(true), fails = [];
const key = r => `${r.disc} ${r.preset} r${r.revision}`, back = new Map(backward.map(r => [key(r), r]));
const distance = (a, b) => a.reduce((most, value, index) => Math.max(most, Math.abs(value - b[index])), 0), TOLERANCE = 4;
for (const r of forward) {
  if (r.reported !== r.revision) fails.push(`${key(r)}: renderer reported revision ${r.reported}`);
  if (distance(back.get(key(r)).pixels, r.pixels) > TOLERANCE) fails.push(`${key(r)}: pixels depend on which revision was drawn first (differ by ${distance(back.get(key(r)).pixels, r.pixels)})`);
  if (r.revision > 1) { const old = forward.find(x => x.disc === r.disc && x.preset === r.preset && x.revision === 1); if (distance(old.pixels, r.pixels) <= TOLERANCE) fails.push(`${key(r)}: same pixels as revision 1`); }
  if (r.preset === 'b01' && r.tilt !== (r.revision === 1 ? 12 : 0)) fails.push(`${key(r)}: disc tilt ${r.tilt}°`);
  if (r.preset === 'u04' && (r.numbers > r.other) !== (r.revision > 1)) fails.push(`${key(r)}: numbers ${r.numbers}px vs manufacturer ${r.other}px`);
}
console.table(forward.map(({ pixels, ...r }) => ({ ...r, orderDrift: distance(back.get(key(r)).pixels, pixels) })));
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : `${forward.length} cards: revisions differ, order-independent, B01 upright and U04 manufacturer below the numbers at revision 2.`);
await b.close();
process.exitCode = fails.length ? 1 : 0;
