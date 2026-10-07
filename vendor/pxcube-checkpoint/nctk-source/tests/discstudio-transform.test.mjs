import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '../vendor/discstudio/disc/node_modules/@napi-rs/canvas/index.js';
import { calculate as scale } from '../calculations/uniform-scale/calculate.mjs';
import { calculate as transform } from '../calculations/xy-transform/calculate.mjs';
import { calculate as preview } from '../calculations/preview-discstudio/calculate.mjs';

const WIDTH = 1080, HEIGHT = 1920;
function png(rect = { x: 400, y: 800, width: 280, height: 200 }) {
  const canvas = createCanvas(WIDTH, HEIGHT), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e42c56'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  return canvas.toBuffer('image/png');
}
function bounds(bytes) {
  return import('../vendor/discstudio/disc/node_modules/@napi-rs/canvas/index.js').then(async ({ loadImage }) => {
    const image = await loadImage(bytes), canvas = createCanvas(WIDTH, HEIGHT), ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
    let minX = WIDTH, minY = HEIGHT, maxX = -1, maxY = -1;
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (data[(y * WIDTH + x) * 4 + 3]) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return [minX, minY, maxX, maxY];
  });
}
async function inputFile(dir, name, bytes) { const path = join(dir, name); await writeFile(path, bytes); return path; }

test('default scale and XYTransform preserve card bytes exactly; smaller scale changes alpha bounds but keeps canvas', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'discstudio-transform-'));
  const original = png(), card = await inputFile(dir, 'card.png', original);
  const scaledDir = join(dir, 'scaled'); await import('node:fs/promises').then(fs => fs.mkdir(scaledDir));
  const scaled = await scale({ inputs: { 'parts/card/discstudio': { files: [card] } }, outputDir: scaledDir, args: { scale: 1 } });
  const scaledBytes = await readFile(scaled.files[0]); assert.deepEqual(scaledBytes, original);
  const positionedDir = join(dir, 'positioned'); await import('node:fs/promises').then(fs => fs.mkdir(positionedDir));
  const positioned = await transform({ inputs: { 'parts/scaled/discstudio': { files: [scaled.files[0]] } }, outputDir: positionedDir, args: { dx: 0, dy: 0 } });
  assert.deepEqual(await readFile(positioned.files[0]), original);
  const smallerDir = join(dir, 'smaller'); await import('node:fs/promises').then(fs => fs.mkdir(smallerDir));
  const smaller = await scale({ inputs: { 'parts/card/discstudio': { files: [card] } }, outputDir: smallerDir, args: { scale: 0.5 } });
  const { loadImage } = await import('../vendor/discstudio/disc/node_modules/@napi-rs/canvas/index.js');
  const smallImage = await loadImage(await readFile(smaller.files[0]));
  assert.equal(smallImage.width, WIDTH); assert.equal(smallImage.height, HEIGHT);
  assert.deepEqual(await bounds(await readFile(smaller.files[0])), [470, 850, 609, 949]);
});

test('scale and translation reject clipping without writing success artifacts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'discstudio-clipping-'));
  const edge = await inputFile(dir, 'edge.png', png({ x: 0, y: 0, width: WIDTH, height: HEIGHT }));
  const scaleDir = join(dir, 'scale'); await import('node:fs/promises').then(fs => fs.mkdir(scaleDir));
  await assert.rejects(scale({ inputs: { 'parts/card/discstudio': { files: [edge] } }, outputDir: scaleDir, args: { scale: 1.5 } }), /clip/);
  await assert.rejects(access(join(scaleDir, 'scale.json')));
  const source = await inputFile(dir, 'small.png', png());
  const translateDir = join(dir, 'translate'); await import('node:fs/promises').then(fs => fs.mkdir(translateDir));
  await assert.rejects(transform({ inputs: { 'parts/scaled/discstudio': { files: [source] } }, outputDir: translateDir, args: { dx: 0.7, dy: 0 } }), /clip/);
  await assert.rejects(access(join(translateDir, 'xy-transform.json')));
});

test('preview background byte changes alter receipt identity even at the same path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'discstudio-background-'));
  const card = await inputFile(dir, 'positioned.png', png());
  const background = join(dir, 'same-path.png');
  const bgCanvas = createCanvas(20, 20), ctx = bgCanvas.getContext('2d');
  ctx.fillStyle = '#21aa67'; ctx.fillRect(0, 0, 20, 20); await writeFile(background, bgCanvas.toBuffer('image/png'));
  const firstDir = join(dir, 'first'); await import('node:fs/promises').then(fs => fs.mkdir(firstDir));
  await preview({ inputs: { 'parts/positioned/discstudio': { files: [card] }, 'parts/source/discstudio-background': { files: [background] } }, outputDir: firstDir, runtime: { backgroundPath: background } });
  const first = JSON.parse(await readFile(join(firstDir, 'preview.json'), 'utf8'));
  ctx.fillStyle = '#e2334c'; ctx.fillRect(0, 0, 20, 20); await writeFile(background, bgCanvas.toBuffer('image/png'));
  const secondDir = join(dir, 'second'); await import('node:fs/promises').then(fs => fs.mkdir(secondDir));
  await preview({ inputs: { 'parts/positioned/discstudio': { files: [card] }, 'parts/source/discstudio-background': { files: [background] } }, outputDir: secondDir, runtime: { backgroundPath: background } });
  const second = JSON.parse(await readFile(join(secondDir, 'preview.json'), 'utf8'));
  assert.notEqual(first.backgroundSha256, second.backgroundSha256);
  assert.notEqual(first.identity, second.identity);
});
