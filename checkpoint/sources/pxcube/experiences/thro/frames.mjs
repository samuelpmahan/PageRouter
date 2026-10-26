// Argon's acceptance frames (Brook thro #34, D:/HomeServer/lanes/thro-chainspot/ACCEPTANCE-FRAMES.json), built end to end through
// registered Calculations: raw photo -> thro/crop/live (worker) -> thro/crop/unwarp -> thro/crop/cutout -> thro/card/bar.
// The disc is Argon's option A, Sam's photo shelf: frame 1 Stag (IMG_6081), frame 2 Servo (IMG_6165).
import { enter, record } from './thro-calculations.mjs';
import { renderThroBar } from './thro-bar.mjs';
const V = '?v=28ac2b39fab85255';
const molds = await import(`./vendor/discstudio-cards/mold-library.js${V}`);
const $ = id => document.getElementById(id);
const image = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error(src)); i.src = src; });

const FRAMES = [
  { frameId: 'frame-1-h15-wysocki-eagle-throw-in', hole: 15, par: 5, holeLengthFeet: 1129, throwIndex: 2, player: 'Richard Wysocki', throwDistanceFeet: 678, distanceToTargetFeet: 0, zoneLabel: 'BULLSEYE · EAGLE 3 (-2)', argonDisc: 'Star Destroyer [12, 5, -1, 3]', photo: 'IMG_6081' },
  { frameId: 'frame-2-h17-balodis-stance-violation', hole: 17, par: 4, holeLengthFeet: 846, throwIndex: 2, throwId: 16691353, player: 'Rainers Balodis', throwDistanceFeet: 413, distanceToTargetFeet: 65, zoneLabel: 'ZONE 2 ROUGH -> C2 (65 FT) · STANCE_VIOLATION (+1 PENALTY)', argonDisc: 'C-Line FD3 [9, 4, 0, 3]', photo: 'IMG_6165',
    manifold: 'L 51.7% · R 48.3% · Narnia 20.8% · 6 ft into Right Rough (25 ft off centre)' },
];
const manifest = await (await fetch('./assets/photos/photos.json')).json();
const worker = new Worker(new URL('./rimfit-worker.mjs', import.meta.url), { type: 'module' });
const fit = (img, meta) => new Promise((ok, no) => {
  const k = 1024 / Math.max(img.naturalWidth, img.naturalHeight), c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height); const data = x.getImageData(0, 0, c.width, c.height).data;
  worker.onmessage = ({ data: d }) => d.error ? no(Error(d.error)) : ok(record(d.report));
  worker.postMessage({ name: meta.name, width: img.naturalWidth, height: img.naturalHeight, reference: meta.argon, working: { width: c.width, height: c.height, data } }, [data.buffer]);
});
const tee = await image('./assets/tee-shot-original.jpg');
window.__frameReports = [];
for (const f of FRAMES) {
  const fig = document.createElement('figure'), c = Object.assign(document.createElement('canvas'), { width: 1920, height: 1080 }), cap = document.createElement('figcaption');
  cap.innerHTML = `<b>Hole ${f.hole} · throw ${f.throwIndex} · ${f.player}</b><span>cropping ${f.photo}…</span>`; fig.append(c, cap); $('main').append(fig);
  try {
    const meta = manifest.photos.find(p => p.name === f.photo), img = await image(meta.file), mold = molds.moldRecord(meta.mold);
    const live = await fit(img, meta), e = live.items[0].output;
    const unwarp = enter('thro/crop/unwarp', [{ name: meta.name, ellipse: e, size: 800 }]);
    const cut = enter('thro/crop/cutout', [{ name: meta.name, img, ellipse: e, size: 800, matrix: unwarp.items[0].matrix }]);
    const blob = await cut.items[0].canvas.convertToBlob({ type: 'image/webp', quality: 0.88 });
    const src = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
    const bar = await renderThroBar({ disc: { mold: mold.id, name: mold.mold, manufacturer: mold.manufacturer }, flights: mold.flight, cutoutSrc: src.startsWith('data:image/webp') ? src : src.replace(/^data:[^;]+/, 'data:image/png') });
    const x = c.getContext('2d'), s = Math.max(1920 / tee.width, 1080 / tee.height);
    x.drawImage(tee, (1920 - tee.width * s) / 2, (1080 - tee.height * s) / 2, tee.width * s, tee.height * s); x.drawImage(await createImageBitmap(bar.frame.png), 0, 0);
    const reports = [live, unwarp, cut, bar.report]; window.__frameReports.push({ frameId: f.frameId, statuses: reports.map(r => `${r.calculationId} ${r.selfGuaranteeStatus}`) });
    cap.innerHTML = `<b>Hole ${f.hole} · par ${f.par} · ${f.holeLengthFeet} ft · throw ${f.throwIndex}${f.throwId ? ` (#${f.throwId})` : ''} · ${f.player}</b>
      <span>${f.throwDistanceFeet} ft throw → ${f.distanceToTargetFeet} ft · ${f.zoneLabel}</span>${f.manifold ? `<span>manifold: ${f.manifold}</span>` : ''}
      <span>bar disc: <b style="font:inherit;color:var(--ink)">${mold.manufacturer} ${mold.mold} ${mold.flight.join(' | ')}</b>, cropped live from ${f.photo} · <span class="warn">Argon's catalog stand-in would be ${f.argonDisc}, a guess from the throw's distance, not the disc ${f.player.split(' ')[0]} threw</span></span>
      <span>${reports.map(r => `${r.calculationId} <span class="ok">${r.selfGuaranteeStatus}</span>`).join(' · ')}</span>`;
  } catch (error) { cap.innerHTML += `<span>failed: ${error.message}</span>`; console.error(error); }
}
$('main').setAttribute('aria-busy', 'false');
