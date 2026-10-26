// Where the card's own controls (the strip of Side / Colour / Plate, and the recipe with its sliders) sit around the preview.
// On a laptop they sit directly under the card inside the preview panel. On a phone the Download bar goes straight under the card
// (so the card and Download share the first screen and nothing floats over the card), and the strip and recipe follow the bar.
export const onPhone = () => matchMedia('(max-width:760px)').matches;

/** The element the strip should follow: the Download bar on a phone, otherwise the preview itself. */
export function chromeAnchor(holder) {
  const bar = holder.closest('.preview-column')?.querySelector(':scope > .export-bar');
  return onPhone() && bar ? bar : holder;
}

/** Remove the strip and recipe wherever they were put (inside the panel, or after the Download bar). */
export function clearChrome(holder) {
  for (const scope of new Set([holder.parentElement, holder.closest('.preview-column')])) scope?.querySelectorAll(':scope > .ce-strip, :scope > .cp-recipe').forEach(node => node.remove());
}
