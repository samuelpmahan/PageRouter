// The hand-off from the photos page (raw photo → live crop → mold) to the editor. The photos page writes the cropped discs here;
// the editor, opened with ?bag=photos, reads them as its shelf instead of the three prepared samples, in a workspace of its own
// (so the saved prepared-sample workspace is never touched). Each hand-off starts that workspace fresh.
export const handoffKey = 'thro.photos:handoff';
export const workspaceKey = 'thro.photos:bag';

export function saveBag(discs, { session = sessionStorage, local = localStorage } = {}) {
  session.setItem(handoffKey, JSON.stringify({ schema: 'thro-photo-handoff@1', discs }));
  local.removeItem(workspaceKey);
}

export function loadBag({ session = sessionStorage } = {}) {
  const raw = session.getItem(handoffKey);
  if (!raw) throw Error('No cropped photos yet. Open photos.html, crop a disc, then press Make cards.');
  const bag = JSON.parse(raw);
  if (bag?.schema !== 'thro-photo-handoff@1' || !Array.isArray(bag.discs) || !bag.discs.length) throw Error('The cropped photo hand-off is unreadable.');
  return bag.discs.map(d => {
    if (!/^[a-z0-9-]+$/.test(d.mold) || !/^[A-Za-z0-9_-]+$/.test(d.id) || !/^data:image\/(?:png|webp);base64,/.test(d.src)) throw Error('A cropped photo in the hand-off is malformed.');
    return Object.freeze({ id: d.id, mold: d.mold, name: String(d.name), manufacturer: String(d.manufacturer), plastic: d.plastic ?? null, weight: null,
      depiction: Object.freeze({ kind: 'photo', src: d.src, name: String(d.name) }) });
  });
}
