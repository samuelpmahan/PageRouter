import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '../vendor/discstudio/disc/node_modules/@napi-rs/canvas/index.js';
import { planCardPlacement, selectShot } from './seek-plan.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

function alphaBoundsOf(image, width, height) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3]) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
  }
  if (right <= left) throw Error('Card has no visible pixels.');
  return [left, top, right, bottom];
}

export async function createCardSeek({ cardBytes, backgroundBytes, storyboard }) {
  if (storyboard?.schema !== 'discstudio-seek-storyboard@1' || storyboard.width !== 1080 || storyboard.height !== 1920 || !['cover', 'contain'].includes(storyboard.fit)) throw Error('Storyboard must declare a 1080x1920 frame and background fit.');
  const width = storyboard.width, height = storyboard.height;
  const card = await loadImage(cardBytes), background = await loadImage(backgroundBytes);
  if (card.width !== width || card.height !== height) throw Error('Card must be a native transparent 1080x1920 Card.');
  const alphaBounds = alphaBoundsOf(card, width, height);
  const cardSha256 = hash(cardBytes), backgroundSha256 = hash(backgroundBytes);
  return function seek(t) {
    const shot = selectShot(storyboard, t);
    const placement = planCardPlacement({ width, height, alphaBounds, shot });
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
    const fit = storyboard.fit === 'contain' ? Math.min(width / background.width, height / background.height) : Math.max(width / background.width, height / background.height);
    const w = background.width * fit, h = background.height * fit;
    ctx.drawImage(background, (width - w) / 2, (height - h) / 2, w, h);
    ctx.drawImage(card, placement.drawX, placement.drawY, width * placement.scale, height * placement.scale);
    const png = canvas.toBuffer('image/png');
    return { png, receipt: {
      schema: 'discstudio-seek-frame@1', t, shot: shot.id, width, height, fit: storyboard.fit,
      cardSha256, backgroundSha256, alphaBounds,
      placement: { anchor: shot.placement.anchor, scale: placement.scale, visibleBounds: placement.bounds },
      protectedRegionsChecked: placement.protectedIds, frameSha256: hash(png)
    } };
  };
}
