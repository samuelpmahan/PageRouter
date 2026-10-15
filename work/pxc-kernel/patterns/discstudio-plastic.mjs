// Plastic is now free text that is printed on the card. Does any text a player might type stay inside every card layout?
// Matrix: every layout × plastic texts of growing length, rendered by DiscStudio's own native card renderer.
// Run with: node --experimental-strip-types patterns/discstudio-plastic.mjs   (DISCSTUDIO_SRC = the disc app folder)
import path from 'node:path';
import { matrix } from './matrix.mjs';
import { snap } from './flipbook.mjs';

const SRC = process.env.DISCSTUDIO_SRC ?? '/home/claude/ds657/source/vendor/discstudio/disc';
const { renderCard } = await import(path.join(SRC, 'card-renderer.ts'));
const { loadImage, createCanvas } = await import(path.join(SRC, 'node_modules/@napi-rs/canvas/index.js'));
const PHOTO = path.join(SRC, 'sample-discs/servo.jpg');
const LAYOUTS = [['vertical', 'u01'], ['vertical', 'u02'], ['vertical', 'u03-front'], ['vertical', 'u04'], ['vertical', 'u05'],
  ['horizontal', 'b01'], ['horizontal', 'b02'], ['horizontal', 'b03'], ['horizontal', 'b04'], ['horizontal', 'b05']];
const TEXTS = ['', 'Neutron', 'Unknown / not listed', 'Cosmic Neutron Tour Series 2026', 'Champion Glow Halo Star · Sam’s lucky backup from the 2026 worlds'];
const disc = (plastic) => ({ id: 'd1', mold: 'ds.px.seed.mvp--servo', nickname: 'Servo', plastic, weight: null, speed: 7, glide: 5, turn: -1, fade: 2,
  Color1: '#98d4ba', Color2: '#f8b393', paintMode: 'split', colorPainting: false, depiction: { kind: 'photo', src: PHOTO, name: 'servo.jpg' } });

async function measure(buf) { // bounding box of every drawn (alpha > 0) pixel
  const img = await loadImage(buf); const c = createCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data; let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { const p = (i - 3) / 4, x = p % img.width, y = (p - x) / img.width; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { box: [x0, y0, x1, y1], w: img.width, h: img.height };
}
const cards = {};
for (const [orientation, preset] of LAYOUTS) for (const text of TEXTS) {
  const buf = await renderCard(disc(text), orientation, preset);
  cards[`${preset}|${text}`] = { ...(await measure(buf)), url: `data:image/png;base64,${buf.toString('base64')}` };
}
const m = matrix({
  title: 'DiscStudio card layouts × plastic text the player types (native renderer, MVP Servo photo)',
  rows: { name: 'layout', values: LAYOUTS.map(([, p]) => p), label: (p) => p.toUpperCase() },
  cols: { name: 'plastic', values: TEXTS, label: (t) => (t ? `"${t}" (${t.length})` : '(none)') },
  run: (at) => ({ value: cards[`${at.layout}|${at.plastic}`] }),
  show: (v) => { const [x0, y0, x1, y1] = v.box; const s = 150 / Math.max(x1 - x0 + 1, y1 - y0 + 1);
    return { html: `<div style="width:${Math.round((x1 - x0 + 1) * s)}px;height:${Math.round((y1 - y0 + 1) * s)}px;margin:4px auto;overflow:hidden;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/10px 10px"><img src="${v.url}" style="width:${Math.round(v.w * s)}px;margin-left:${-Math.round(x0 * s)}px;margin-top:${-Math.round(y0 * s)}px"></div>` }; },
  shows: 'the card cropped to its drawn pixels',
  checks: { 'the plastic text stays inside the card (drawn area no wider or taller than with no plastic)': (v, at, get) => {
    const base = get({ plastic: '' }).box; return v.box[0] >= base[0] && v.box[1] >= base[1] && v.box[2] <= base[2] && v.box[3] <= base[3]; } },
  expect: () => undefined,
});
snap(m.html, 'patterns/out/discstudio-plastic-cards', { width: 1100 });
console.log(`${m.cells.length} cards, ${m.failures.length} where the plastic text spills outside the card`);
m.failures.forEach((c) => console.log(`  ${c.at.layout} × "${c.at.plastic}"`));
