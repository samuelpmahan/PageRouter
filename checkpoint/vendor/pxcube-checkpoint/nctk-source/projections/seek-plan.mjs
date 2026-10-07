// Browser-safe storyboard and screen-space geometry. No rendering or source mutation.
const finite = value => typeof value === 'number' && Number.isFinite(value);

function box(rect, width, height, name) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(finite)) throw Error(`Invalid ${name} box.`);
  const [x, y, w, h] = rect;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) throw Error(`Invalid ${name} box.`);
  return { left: x * width, top: y * height, right: (x + w) * width, bottom: (y + h) * height };
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function selectShot(storyboard, t) {
  if (storyboard?.schema !== 'discstudio-seek-storyboard@1' || !finite(t) || t < 0) throw Error('Invalid storyboard or time.');
  if (!Array.isArray(storyboard.shots) || !storyboard.shots.length) throw Error('Storyboard needs shots.');
  let previousEnd = 0, selected = null;
  for (const shot of storyboard.shots) {
    if (typeof shot.id !== 'string' || !shot.id || !finite(shot.start) || !finite(shot.end) || shot.start < previousEnd || shot.end <= shot.start) throw Error('Shots must have IDs and ordered, nonoverlapping intervals.');
    previousEnd = shot.end;
    if (t >= shot.start && t < shot.end) selected = shot;
  }
  if (!selected) throw Error(`No storyboard shot at t=${t}.`);
  return selected;
}

export function planCardPlacement({ width, height, alphaBounds, shot }) {
  const { anchor, scale } = shot.placement ?? {};
  if (![width, height, scale].every(finite) || width <= 0 || height <= 0 || scale <= 0 || !Array.isArray(anchor) || anchor.length !== 2 || !anchor.every(finite)) throw Error('Invalid card placement.');
  const [left, top, right, bottom] = alphaBounds;
  if (![left, top, right, bottom].every(finite) || left >= right || top >= bottom) throw Error('Invalid card alpha bounds.');
  const drawX = anchor[0] * width - (left + right) * scale / 2;
  const drawY = anchor[1] * height - (top + bottom) * scale / 2;
  const bounds = { left: drawX + left * scale, top: drawY + top * scale, right: drawX + right * scale, bottom: drawY + bottom * scale };
  if (bounds.left < 0 || bounds.top < 0 || bounds.right > width || bounds.bottom > height) throw Error('Card visible pixels leave the frame.');
  const protectedIds = [];
  for (const region of shot.protected ?? []) {
    if (typeof region.id !== 'string' || !region.id) throw Error('Protected region needs an ID.');
    const protectedBox = box(region.box, width, height, region.id);
    if (intersects(bounds, protectedBox)) protectedIds.push(region.id);
  }
  if (protectedIds.length) throw Error(`Card overlaps protected screen region: ${protectedIds.join(', ')}.`);
  return { drawX, drawY, scale, bounds, protectedIds: (shot.protected ?? []).map(region => region.id) };
}
