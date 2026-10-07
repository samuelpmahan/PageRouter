import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas, loadImage } from '../../vendor/discstudio/disc/node_modules/@napi-rs/canvas/index.js';
import { validateTransform } from '../../vendor/discstudio/disc/transform-geometry.mjs';

const WIDTH = 1080, HEIGHT = 1920;
export async function calculate({ inputs, outputDir, args }) {
  const dx = Number(args.dx), dy = Number(args.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw Error('dx and dy must be finite normalized deltas.');
  const image = await loadImage(await readFile(inputs['parts/scaled/discstudio'].files[0]));
  if (image.width !== WIDTH || image.height !== HEIGHT) throw Error(`Card canvas must be ${WIDTH}x${HEIGHT}.`);
  const source = await readFile(inputs['parts/scaled/discstudio'].files[0]);
  const alphaCanvas = createCanvas(WIDTH, HEIGHT), alphaCtx = alphaCanvas.getContext('2d');
  alphaCtx.drawImage(image, 0, 0);
  const { data } = alphaCtx.getImageData(0, 0, WIDTH, HEIGHT);
  let minX = WIDTH, minY = HEIGHT, maxX = -1, maxY = -1;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    if (data[(y * WIDTH + x) * 4 + 3] !== 0) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  if (maxX < 0) throw Error('Card image has no visible alpha content.');
  const px = dx * WIDTH, py = dy * HEIGHT;
  try { validateTransform({ width: WIDTH, height: HEIGHT, alphaBounds: [minX, minY, maxX + 1, maxY + 1], dx, dy }); }
  catch { throw Error('XYTransform would clip nontransparent card pixels.'); }
  const path = join(outputDir, 'positioned-card.png');
  if (dx === 0 && dy === 0) await writeFile(path, source);
  else {
    const canvas = createCanvas(WIDTH, HEIGHT), ctx = canvas.getContext('2d');
    ctx.drawImage(image, px, py, WIDTH, HEIGHT);
    await writeFile(path, canvas.toBuffer('image/png'));
  }
  const receipt = join(outputDir, 'xy-transform.json');
  await writeFile(receipt, JSON.stringify({ schema: 'discstudio-xy-transform@1', width: WIDTH, height: HEIGHT, dx, dy, normalizedDeltas: true, identity: dx === 0 && dy === 0 }, null, 2) + '\n');
  return { files: [path, receipt], observation: { width: WIDTH, height: HEIGHT, dx, dy, translatedBy: [px, py], alphaBounds: [minX, minY, maxX, maxY], identity: dx === 0 && dy === 0 } };
}
