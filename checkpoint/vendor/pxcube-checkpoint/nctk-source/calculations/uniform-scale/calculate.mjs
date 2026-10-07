import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas, loadImage } from '../../vendor/discstudio/disc/node_modules/@napi-rs/canvas/index.js';

const WIDTH = 1080, HEIGHT = 1920;
export async function calculate({ inputs, outputDir, args }) {
  const scale = Number(args.scale);
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 1.5) throw Error('scale must be between 0.5 and 1.5.');
  const source = await readFile(inputs['parts/card/discstudio'].files[0]);
  const image = await loadImage(source);
  if (image.width !== WIDTH || image.height !== HEIGHT) throw Error(`Card canvas must be ${WIDTH}x${HEIGHT}.`);
  const alphaCanvas = createCanvas(WIDTH, HEIGHT), alphaCtx = alphaCanvas.getContext('2d');
  alphaCtx.drawImage(image, 0, 0);
  const { data } = alphaCtx.getImageData(0, 0, WIDTH, HEIGHT);
  let minX = WIDTH, minY = HEIGHT, maxX = -1, maxY = -1;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    if (data[(y * WIDTH + x) * 4 + 3] !== 0) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  if (maxX < 0) throw Error('Card image has no visible alpha content.');
  const centerX = (minX + maxX + 1) / 2, centerY = (minY + maxY + 1) / 2;
  const left = centerX + (minX - centerX) * scale;
  const top = centerY + (minY - centerY) * scale;
  const right = centerX + (maxX + 1 - centerX) * scale;
  const bottom = centerY + (maxY + 1 - centerY) * scale;
  if (left < 0 || top < 0 || right > WIDTH || bottom > HEIGHT) throw Error('UniformScale would clip nontransparent card pixels.');
  const path = join(outputDir, 'scaled-card.png');
  if (scale === 1) {
    await writeFile(path, source);
    const receipt = join(outputDir, 'scale.json');
    await writeFile(receipt, JSON.stringify({ schema: 'discstudio-uniform-scale@1', width: WIDTH, height: HEIGHT, scale, alphaContentOnly: true, identity: true }, null, 2) + '\n');
    return { files: [path, receipt], observation: { width: WIDTH, height: HEIGHT, scale, alphaContentOnly: true, identity: true } };
  }
  const canvas = createCanvas(WIDTH, HEIGHT), ctx = canvas.getContext('2d');
  ctx.translate(centerX, centerY);
  ctx.scale(scale, scale);
  ctx.drawImage(image, -centerX, -centerY, WIDTH, HEIGHT);
  const png = canvas.toBuffer('image/png');
  await writeFile(path, png);
  const receipt = join(outputDir, 'scale.json');
  await writeFile(receipt, JSON.stringify({ schema: 'discstudio-uniform-scale@1', width: WIDTH, height: HEIGHT, scale, alphaContentOnly: true }, null, 2) + '\n');
  return { files: [path, receipt], observation: { width: WIDTH, height: HEIGHT, scale, alphaContentOnly: true, alphaBounds: [minX, minY, maxX, maxY] } };
}
