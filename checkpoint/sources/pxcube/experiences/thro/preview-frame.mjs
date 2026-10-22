// Display-only geometry. These values never enter a design, capture or export.
export function alphaBounds({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data?.length !== width * height * 4) throw Error('Invalid preview pixel dimensions.');
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[(y * width + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function fitArtwork({ canvasWidth, canvasHeight, bounds, width, height, padding = 12 }) {
  const values = [canvasWidth, canvasHeight, width, height, padding, bounds?.x, bounds?.y, bounds?.width, bounds?.height];
  if (!values.every(Number.isFinite) || canvasWidth <= 0 || canvasHeight <= 0 || padding < 0 || width <= padding * 2 || height <= padding * 2 || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 || bounds.x + bounds.width > canvasWidth || bounds.y + bounds.height > canvasHeight) throw Error('Invalid preview framing bounds.');
  const scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height);
  return { scale, x: (width - bounds.width * scale) / 2 - bounds.x * scale, y: (height - bounds.height * scale) / 2 - bounds.y * scale };
}
