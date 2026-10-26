// The thro bar: B01 revision 2 in one row (a thin black plate the width of the frame, mold name and flight numbers on the left, the
// disc inside the right end), as one call another app can make. ChainSpot's broadcast lower-third uses it (Argon's design thread,
// Brook thro #27, Subagent 2). It draws through the same renderer call the editor makes, so the same disc, flights and parts give the
// same pixels. Entry is the registered Calculation thro/card/bar (Argon's WitnessedPxC root guarantee).
import { register, enterAsync } from './thro-calculations.mjs';
const V = '?v=28ac2b39fab85255';
const adapterUrl = new URL(`./vendor/discstudio-cards/thro-adapter.mjs${V}`, import.meta.url).href;

// The bar Sam drew in the editor on 24 Oct: one row, plate 1824 px, disc 120 px pushed into the right end, card size 100%.
export const BAR_PARTS = Object.freeze({ row: 1, plateW: 1824, discD: 120, discOX: -0.6, discOY: 0.5 });
const blobBytes = async blob => new Uint8Array(await blob.arrayBuffer());
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

register({
  id: 'thro/card/bar', description: 'one-row B01 bar for a broadcast lower-third, drawn by the same renderer call as the editor',
  calculate: async ({ disc, flights, cutoutSrc, parts, appearance }) => {
    const A = await import(adapterUrl), t = performance.now();
    const request = { disc: { id: disc.id ?? 'bar', mold: disc.mold, name: disc.name, manufacturer: disc.manufacturer ?? null, plastic: disc.plastic ?? null, weight: null },
      photoSrc: cutoutSrc, flights, preset: 'b01', revision: 2, scale: 1, parts: { ...parts }, ...(appearance ? { appearance } : {}) };
    const first = await A.renderDiscStudioCard(request), again = await A.renderDiscStudioCard(request);
    const ms = Math.round(performance.now() - t);
    // The bar itself, cut out of the 1920 × 1080 frame at the card's visible pixels.
    const box = first.layout.card, frame = await createImageBitmap(first.png), c = new OffscreenCanvas(Math.round(box.w), Math.round(box.h));
    c.getContext('2d').drawImage(frame, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
    return { frame: first, bar: await c.convertToBlob({ type: 'image/png' }), repeatable: same(await blobBytes(first.png), await blobBytes(again.png)), ms };
  },
  witnessItem: ({ disc }, produced) => {
    const { layout, width } = produced.frame, card = layout.card, photo = layout.photo;
    return { name: disc.name, ms: produced.ms, frame: produced.frame, bar: produced.bar, card, photo, repeatable: produced.repeatable,
      metrics: { maxRelExcursion: 0 } };
  },
  guarantees: [
    { id: 'G1_ThinBar', description: 'the bar is at most 140 px tall in a 1920 × 1080 frame', check: items => tally(items, x => x.card.h <= 140, x => `${Math.round(x.card.h)} px tall`) },
    { id: 'G2_FullWidth', description: 'the bar spans at least 90% of the frame width', check: items => tally(items, x => x.card.w >= 0.9 * 1920, x => `${Math.round(x.card.w)} px wide`) },
    { id: 'G3_DiscInRightEnd', description: "the disc sits inside the bar's right end (its centre in the last 15%, its top and bottom inside the bar ± 8 px)",
      check: items => tally(items, x => x.photo && x.photo.cx >= x.card.x + 0.85 * x.card.w && x.photo.cx <= x.card.x + x.card.w && x.photo.y >= x.card.y - 8 && x.photo.y + x.photo.h <= x.card.y + x.card.h + 8, x => x.photo ? `disc at ${Math.round(x.photo.cx - x.card.x)}/${Math.round(x.card.w)}` : 'no disc') },
    { id: 'G4_SamePixels', description: 'the same request draws byte-identical pixels twice', check: items => tally(items, x => x.repeatable, x => x.repeatable ? 'identical' : 'differs') },
  ],
});
function tally(items, test, show) {
  const fails = items.filter(x => !test(x));
  return { passed: !fails.length, passCount: items.length - fails.length, totalCount: items.length, metric: items.map(x => `${x.name} ${show(x)}`).join(', '), failures: fails.map(x => x.name) };
}

/** renderThroBar({ disc: { mold, name, manufacturer?, plastic? }, flights: [speed, glide, turn, fade], cutoutSrc, parts?, appearance? })
 *  -> { bar: PNG Blob of just the bar, frame: the renderer's 1920 × 1080 result (png, svg, layout), report: the WitnessReport } */
export async function renderThroBar({ disc, flights, cutoutSrc, parts = BAR_PARTS, appearance = null }) {
  const report = await enterAsync('thro/card/bar', [{ name: disc.name, disc, flights, cutoutSrc, parts, appearance }]);
  const item = report.items[0];
  return { bar: item.bar, frame: item.frame, report };
}
