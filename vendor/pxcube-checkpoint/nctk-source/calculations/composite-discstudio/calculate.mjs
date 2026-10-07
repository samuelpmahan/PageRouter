import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas, loadImage } from '../../vendor/discstudio/disc/node_modules/@napi-rs/canvas/index.js';

const WIDTH = 1080, HEIGHT = 1920;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function calculate({ inputs, outputDir, runtime = {} }) {
  const cardBytes = await readFile(inputs['parts/positioned/discstudio'].files[0]);
  const backgroundPath = runtime.backgroundPath ?? inputs['parts/source/discstudio-background'].files[0];
  const backgroundBytes = await readFile(backgroundPath);
  const card = await loadImage(cardBytes), background = await loadImage(backgroundBytes);
  if (card.width !== WIDTH || card.height !== HEIGHT) throw Error(`Positioned card must be ${WIDTH}x${HEIGHT}.`);
  const canvas = createCanvas(WIDTH, HEIGHT), ctx = canvas.getContext('2d');
  const cover = Math.max(WIDTH / background.width, HEIGHT / background.height), w = background.width * cover, h = background.height * cover;
  ctx.drawImage(background, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
  ctx.drawImage(card, 0, 0);
  const combined = join(outputDir, 'combined.png'), bytes = canvas.toBuffer('image/png');
  await writeFile(combined, bytes);
  const receipt = join(outputDir, 'composite.json');
  const record = { schema: 'discstudio-background-composite@1', mode: 'explicit-composite-export', backgroundPath, backgroundSha256: hash(backgroundBytes), positionedCardSha256: hash(cardBytes), combinedSha256: hash(bytes), width: WIDTH, height: HEIGHT };
  record.identity = hash(JSON.stringify(record));
  await writeFile(receipt, JSON.stringify(record, null, 2) + '\n');
  return { files: [combined, receipt], observation: { mode: record.mode, backgroundSha256: record.backgroundSha256, combinedSha256: record.combinedSha256, identity: record.identity } };
}
