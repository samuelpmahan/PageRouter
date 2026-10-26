// thro's registered Calculations (Argon's WitnessedPxC root guarantee: entry MUST be through a registered Calculation).
// Every step of photos.html — the live rim fit, the unwarp, the cutout, the hand-off to the editor — runs only via enter(id, corpus),
// which goes through Argon's runWitnessedCalculation and returns its WitnessReport. Reports are kept in window.__throWitness so the
// page (and a test) can read every guarantee that ran. Calling these functions any other way is an unregistered hotspot.
import { runWitnessedCalculation } from './witness-pattern.mjs';
import { runThroDiscItem, forgetRimfit } from './rimfit.mjs';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const every = (items, test, label) => {
  const fails = items.filter(x => !test(x)).map(x => x.name);
  return { passed: !fails.length, passCount: items.length - fails.length, totalCount: items.length, metric: `${items.length - fails.length}/${items.length} ${label}`, failures: fails };
};

// The affine map sending ellipse e to a circle of radius R centred at (X, Y), as canvas setTransform arguments.
export function unwarpMatrix(e, R, X, Y) {
  const a = e.angle * DEG, c = Math.cos(a), s = Math.sin(a), ix = R / e.rx, iy = R / e.ry;
  const m11 = c * c * ix + s * s * iy, m12 = c * s * (ix - iy), m22 = s * s * ix + c * c * iy;
  return [m11, m12, m12, m22, X - (m11 * e.cx + m12 * e.cy), Y - (m12 * e.cx + m22 * e.cy)];
}

const registry = new Map();
export function register(def) { if (registry.has(def.id)) throw Error(`Calculation registered twice: ${def.id}`); registry.set(def.id, Object.freeze(def)); }

// 1. The live rim fit: Argon's runThroDiscItem, unchanged, with Argon's own live guarantees plus the distance from his witness run.
register({
  id: 'thro/crop/live', description: "Argon's CoarseRimBand + FineRimForkJoin on one photo's pixels, in the browser",
  calculate: photo => { try { return runThroDiscItem(photo); } finally { forgetRimfit(photo.name); } },
  witnessItem: (photo, produced, ms) => {
    const e = produced.output, s = Math.min(photo.width, photo.height), R1 = Math.max(e.rx, e.ry), R2 = Math.min(e.rx, e.ry), ref = photo.reference;
    return { name: photo.name, ms, output: e, coarse: produced.coarse, innerRimRing: produced.innerRimRing, branches: produced.branches, pickedPerArc: produced.pickedPerArc,
      liveWitness: produced.liveWitness, assumptions: produced.assumptions,
      inPriorBounds: e.cx / photo.width >= 0.24 && e.cx / photo.width <= 0.76 && e.cy / photo.height >= 0.2 && e.cy / photo.height <= 0.8 && R1 / s >= 0.15 && R1 / s <= 0.55 && R2 / R1 >= 0.85,
      offReferencePct: ref ? +(Math.max(...['cx', 'cy', 'rx', 'ry'].map(k => Math.abs(e[k] - ref[k]))) / ref.rx * 100).toFixed(2) : null,
      metrics: { maxRelExcursion: +(produced.liveWitness.maxBandUsagePct / 100).toFixed(4) } };
  },
  guarantees: [
    { id: 'G1_LivePriorBounds', description: 'fit inside the prior bounds (centre in the middle half, R1/s in [0.15, 0.55], R2/R1 >= 0.85)', check: items => every(items, x => x.inPriorBounds, 'in bounds') },
    { id: 'G2_LiveZeroBandClip', description: 'fine fit stays inside the ±8.5% coarse band', check: items => every(items, x => x.assumptions.zeroBandClip, 'unclipped') },
    { id: 'G3_LiveOctantSupport', description: '>= 6 of 8 octants agree', check: items => every(items, x => x.liveWitness.octantSupport >= 0.75, '>=6/8 octants') },
    { id: 'G4_NearArgonWitness', description: "within 1.5% of the radius of Argon's own run on this photo", check: items => every(items, x => x.offReferencePct == null || x.offReferencePct <= 1.5, 'within 1.5% R') },
  ],
});

// 2. The unwarp: one affine map, ellipse -> circle. Witness: map 72 boundary points and measure how far they land off the circle.
register({
  id: 'thro/crop/unwarp', description: 'affine map from the fitted ellipse to a face-on circle (the animation and the cutout share it)',
  calculate: ({ ellipse, size }) => ({ matrix: unwarpMatrix(ellipse, size / 2, size / 2, size / 2) }),
  witnessItem: ({ name, ellipse: e, size }, { matrix: [a, b, c, d, tx, ty] }, ms) => {
    let worst = 0; const ca = Math.cos(e.angle * DEG), sa = Math.sin(e.angle * DEG);
    for (let i = 0; i < 72; i++) {
      const t = i / 72 * TAU, x = e.cx + e.rx * Math.cos(t) * ca - e.ry * Math.sin(t) * sa, y = e.cy + e.rx * Math.cos(t) * sa + e.ry * Math.sin(t) * ca;
      worst = Math.max(worst, Math.abs(Math.hypot(a * x + c * y + tx - size / 2, b * x + d * y + ty - size / 2) - size / 2));
    }
    return { name, ms, matrix: [a, b, c, d, tx, ty], boundaryErrorPx: +worst.toFixed(4), metrics: { maxRelExcursion: worst / (size / 2) } };
  },
  guarantees: [{ id: 'G1_BoundaryOnCircle', description: 'ellipse boundary lands on the circle within 0.5 px', check: items => every(items, x => x.boundaryErrorPx <= 0.5, 'on the circle') }],
});

// 3. The cutout: the photo through that map, clipped to the disc. Witness: alpha just outside and just inside the rim on 32 rays.
register({
  id: 'thro/crop/cutout', description: 'the disc face-on on transparency, 800 px',
  calculate: ({ img, ellipse: e, size, matrix }) => {
    const c = new OffscreenCanvas(size, size), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.setTransform(...matrix); x.beginPath(); x.ellipse(e.cx, e.cy, e.rx, e.ry, e.angle * DEG, 0, TAU); x.clip(); x.drawImage(img, 0, 0);
    return { canvas: c };
  },
  witnessItem: ({ name, size }, { canvas }, ms) => {
    const px = canvas.getContext('2d').getImageData(0, 0, size, size).data, h = size / 2;
    const at = (r, t) => { const x = Math.round(h + r * Math.cos(t)), y = Math.round(h + r * Math.sin(t)); return x < 0 || y < 0 || x >= size || y >= size ? null : px[(y * size + x) * 4 + 3]; };
    let leak = 0, hole = 0; // outside the rim only exists toward the corners; rays that leave the canvas first are skipped
    for (let i = 0; i < 32; i++) { const t = (i + 0.5) / 32 * TAU, out = at(h + 3, t); if (out != null && out > 0) leak++; if (at(h - 4, t) < 255) hole++; }
    return { name, ms, canvas, leaksOutside: leak, holesInside: hole, metrics: { maxRelExcursion: (leak + hole) / 64 } };
  },
  guarantees: [{ id: 'G1_CleanEdge', description: 'transparent 3 px outside the rim, opaque 4 px inside it, on 32 rays', check: items => every(items, x => !x.leaksOutside && !x.holesInside, 'clean edge') }],
});

// 4. The hand-off: cropped discs -> the editor's shelf. Witness: every disc has a catalog mold and an image the card renderer accepts.
register({
  id: 'thro/bag/handoff', description: 'cropped discs with a mold become the editor shelf (?bag=photos)',
  calculate: ({ discs, save }) => { save(discs); return { count: discs.length }; },
  witnessItem: ({ name, discs, moldRecord }, { count }, ms) => ({ name, ms, count,
    badMolds: discs.filter(d => !moldRecord(d.mold)).map(d => d.id), badImages: discs.filter(d => !/^data:image\/(?:png|webp);base64,/.test(d.src)).map(d => d.id), metrics: { maxRelExcursion: 0 } }),
  guarantees: [
    { id: 'G1_CatalogMolds', description: 'every disc has a catalog mold', check: items => every(items, x => !x.badMolds.length, 'all molds in catalog') },
    { id: 'G2_RendererImages', description: 'every cutout is a PNG or WebP data URL the native renderer accepts', check: items => every(items, x => !x.badImages.length, 'renderable') },
  ],
});

// The only way in.
export function enter(id, corpus) {
  const def = registry.get(id);
  if (!def) throw Error(`Unregistered Calculation: ${id}`);
  return record(runWitnessedCalculation(def, corpus));
}
// The same way in for a Calculation whose calculate is async (a canvas render): every item is computed first, then Argon's runner
// witnesses those outputs exactly as it would a synchronous Calculation.
export async function enterAsync(id, corpus) {
  const def = registry.get(id);
  if (!def) throw Error(`Unregistered Calculation: ${id}`);
  const out = new Map();
  for (const item of corpus) out.set(item, await def.calculate(item));
  return record(runWitnessedCalculation({ ...def, calculate: item => out.get(item) }, corpus));
}
// Keep a report where the page and tests can read it (a worker's report is recorded when it reaches the page).
export function record(report) {
  if (typeof window !== 'undefined') (window.__throWitness ??= []).push({ id: report.calculationId, status: report.selfGuaranteeStatus, items: report.items.map(i => i.name), guarantees: report.guarantees, at: new Date().toISOString() });
  return report;
}
export const registered = () => [...registry.values()].map(({ id, description, guarantees }) => ({ id, description, guarantees: guarantees.map(({ id, description }) => ({ id, description })) }));
