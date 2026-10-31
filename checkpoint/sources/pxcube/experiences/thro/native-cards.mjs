import { canonical, hashString } from './pxc/canonical.mjs';
import { span, here } from './gestures.mjs';
// Native card pixels are an optional Single treatment. The renderer/catalog
// module graph is imported only when one of these explicit studies is used.
export const nativeBuild = '28ac2b39fab85255';
// Thro card revisions (vendor/discstudio-cards/thro-card-core-r2.js and -r3.js). cardRevisions is each layout's latest:
// revision 3 for every layout (half flight numbers as a superscript; a dark plate that reaches every layout). Revision 2 (B01 upright disc, U04
// smaller manufacturer) stays drawable for designs saved with it. A design without nativeRevision draws exactly as
// DiscStudio 6.6.1. A saved design keeps its revision until a person chooses the fixed card; a layout picked fresh
// starts at the revision the site decides.
export const cardRevisions = Object.freeze(Object.fromEntries(['u01', 'u02', 'u03-front', 'u03-behind', 'u04', 'u05', 'b01', 'b02', 'b03', 'b04', 'b05'].map(preset => [preset, 3])));
export const savedRevisions = Object.freeze({ b01: Object.freeze([2]), u04: Object.freeze([2]) });
export const knownRevision = (preset, revision) => revision === cardRevisions[preset] || Boolean(savedRevisions[preset]?.includes(revision));
// The site decides which revision new cards start at (thro-world.mjs, 'thro.card.revision'): 1 draws every new card
// exactly as DiscStudio 6.6.1; 2 starts new B01 and U04 cards at revision 2; 3 starts every new card at revision 3.
// A saved design keeps its own either way.
let siteCardRevision = 3;
export function useSiteCardRevision(revision) {
  if (revision !== 1 && revision !== 2 && revision !== 3) throw Error(`Card revision ${revision} is not one the site can choose.`);
  siteCardRevision = revision;
}
export const latestCardRevision = study => {
  if (!isNativeStudy(study) || siteCardRevision < 2) return undefined;
  const preset = nativeStudy(study).preset;
  return siteCardRevision >= 3 ? cardRevisions[preset] : savedRevisions[preset]?.includes(2) ? 2 : undefined;
};
const definitions = [
  ['u01', 'Compact scorebug'], ['u02', 'Stacked poster'],
  ['u03-front', 'Disc in front'], ['u03-behind', 'Disc behind'],
  ['u04', 'Kinetic name'], ['u05', 'Glass drawer'],
  ['b01', 'Hero rail'], ['b02', 'Split nameplate'], ['b03', 'Framed hero'],
  ['b04', 'Peak mark'], ['b05', 'Stamp macro'],
];
export const nativeStudies = Object.freeze(definitions.map(([preset, name]) => Object.freeze({
  id: `discstudio:${preset}`, preset, name: `${preset.toUpperCase()} · ${name}`,
  orientation: preset.startsWith('u') ? 'portrait' : 'landscape',
  side: ['u02', 'u04', 'u05'].includes(preset) ? 'left' : 'right',
  highlight: 'digits', // every layout starts quiet (30 Oct): Tile blocks made the numbers louder than the name; it stays a choice
  accent: /^(u03|u04|b0)/.test(preset) ? '#c8f23d' : '#8fe3ae',
})));
// Lineups (Bag): 2–4 of the same DiscStudio cards in one frame. Portrait-family cards stay readable at 3–4 across; U04 is left
// out until it meets the hierarchy rule. B01 (revision 2, drawn from parts) joins them: its cards share one name size, and four of
// them sit in a 2 × 2 grid (the 4:5 frame, or 16:9 when a row would be too small to read).
const lineupDefinitions = [['u05', 'Glass drawer'], ['u02', 'Stacked poster'], ['u01', 'Compact scorebug'], ['u03-front', 'Disc in front'], ['u03-behind', 'Disc behind'], ['b01', 'Hero rail']];
export const lineupStudies = Object.freeze(lineupDefinitions.map(([preset, name]) => Object.freeze({
  id: `discstudio-lineup:${preset}`, preset, name: `${preset.toUpperCase()} ${name}`, cardStudy: `discstudio:${preset}` })));
export const isLineupStudy = study => typeof study === 'string' && study.startsWith('discstudio-lineup:');
// The lineup's frame: the video frame (16:9) or a feed post (4:5, where the cards sit in a grid of two columns).
export const lineupFrames = Object.freeze([Object.freeze({ id: '16:9', name: '16:9 · 1920 × 1080', width: 1920, height: 1080 }), Object.freeze({ id: '4:5', name: '4:5 · 1080 × 1350', width: 1080, height: 1350 })]);
export const lineupFrame = design => lineupFrames.find(frame => frame.id === design?.lineupFrame) ?? lineupFrames[0];
/** What sits behind the cards: nothing (a transparent PNG for video) or a solid colour (a post, where transparency turns black). */
export const lineupBackdrops = Object.freeze([Object.freeze({ id: 'none', name: 'Transparent' }), Object.freeze({ id: 'paper', name: 'Paper', fill: '#f3e8d2' }), Object.freeze({ id: 'ink', name: 'Ink', fill: '#2b2420' })]);
export const lineupBackdrop = design => lineupBackdrops.find(b => b.id === design?.lineupBackdrop) ?? lineupBackdrops[0];
// The backdrop is laid under the drawn lineup, outside its recipe: the cards' pixels (and their cache key) do not change.
const withBackdrop = (svg, backdrop) => (backdrop.fill ? svg.replace(/(<svg\b[^>]*>)/, `$1<rect width="100%" height="100%" fill="${backdrop.fill}"/>`) : svg);
export function lineupStudy(study) {
  const result = lineupStudies.find(item => item.id === study);
  if (!result) throw Error('Choose a known Thro lineup layout.');
  return result;
}
export const isNativeStudy = study => typeof study === 'string' && study.startsWith('discstudio:');
export function nativeStudy(study) {
  const result = nativeStudies.find(item => item.id === study);
  if (!result) throw Error('Choose a known Thro card layout.');
  return result;
}
export function nativeDesign(previous, study) {
  const selected = nativeStudy(study), wasNative = isNativeStudy(previous.study), same = previous.study === study;
  const design = { ...previous, study, rendererBuild: nativeBuild, orientation: selected.orientation, frame: 'none',
    accent: wasNative ? previous.accent : selected.accent,
    nativeScale: wasNative ? previous.nativeScale ?? 0.66 : 0.66,
    nativeSide: same ? previous.nativeSide ?? selected.side : selected.side,
    nativeHighlight: same ? previous.nativeHighlight ?? selected.highlight : selected.highlight,
    // Plate carries across layouts like the accent: see-through by default, dark when asked (Sam, 30 Oct: "keep it as it was.
    // We just make it simple to make the plate dark if you want to"). A nudge belongs to one layout's geometry.
    nativePlate: wasNative ? previous.nativePlate ?? 'see-through' : 'see-through',
    nativeNudge: same && previous.nativeNudge ? { ...previous.nativeNudge } : { x: 0, y: 0 } };
  delete design.nativeRevision; delete design.nativeParts; // pinned parts, like a nudge, belong to one layout's geometry
  if (same && previous.nativeParts && Object.keys(previous.nativeParts).length) design.nativeParts = { ...previous.nativeParts };
  const revision = same ? previous.nativeRevision : latestCardRevision(study);
  if (revision !== undefined) design.nativeRevision = revision;
  return design;
}
// Parts of a card a person has pinned with its handles (the first Constraint Lab, in the renderer): only B01 at revision 2 is
// drawn from parts and rules so far. The ranges are the renderer's own (B01_PARTS in thro-card-core-r2.js).
export const cardParts = Object.freeze({ b01: Object.freeze({
  plateW: [240, 1824], discD: [80, 900], discOX: [-1.6, 0.8], discOY: [-0.9, 1.6], tile: [24, 160], nameMax: [24, 220], row: [0, 1], maker: [0, 1], align: [0, 1] }) });
const wholeParts = new Set(['row', 'maker', 'align']); // choices, not measures: 0 or 1
export const partsLayout = design => (isNativeStudy(design?.study) && cardParts[nativeStudy(design.study).preset] && design.nativeRevision >= 2 && knownRevision(nativeStudy(design.study).preset, design.nativeRevision) ? nativeStudy(design.study).preset : null);
export function validParts(parts, preset) {
  const ranges = cardParts[preset];
  if (!ranges || !parts || typeof parts !== 'object' || Array.isArray(parts)) return false;
  return Object.entries(parts).every(([k, v]) => ranges[k] && Number.isFinite(v) && v >= ranges[k][0] && v <= ranges[k][1] && (!wholeParts.has(k) || Number.isInteger(v)));
}
const nudgeLimit = 1920;
export const validNudge = nudge => nudge && Number.isFinite(nudge.x) && Number.isFinite(nudge.y) && Math.abs(nudge.x) <= nudgeLimit && Math.abs(nudge.y) <= nudgeLimit;
export function nativeControlDesign(previous, controls) {
  const design = nativeDesign(previous, controls.study);
  if (isNativeStudy(previous.study)) {
    if (controls.scale !== undefined) design.nativeScale = controls.scale;
    if (controls.accent !== undefined) design.accent = controls.accent;
    if (controls.plate !== undefined) design.nativePlate = controls.plate === 'solid' ? 'solid' : 'see-through';
  }
  // A new layout takes its own side/highlight defaults. The controls still
  // belong to the previous layout until the next paint, so read them only
  // when editing that same layout.
  if (previous.study === controls.study) {
    if (controls.side !== undefined) design.nativeSide = controls.side;
    if (controls.highlight !== undefined) design.nativeHighlight = controls.highlight;
    if (controls.nudge !== undefined) design.nativeNudge = validNudge(controls.nudge) ? { x: Math.round(controls.nudge.x), y: Math.round(controls.nudge.y) } : { x: 0, y: 0 };
    // Moving a saved design to the fixed card is always an explicit choice.
    if (controls.revision !== undefined && controls.revision === cardRevisions[nativeStudy(controls.study).preset]) design.nativeRevision = controls.revision;
    // A handle pins parts; { parts: {} } lets them all go back to their rules.
    if (controls.parts !== undefined) {
      const preset = partsLayout(design);
      if (preset && validParts(controls.parts, preset) && Object.keys(controls.parts).length) design.nativeParts = { ...controls.parts };
      else delete design.nativeParts;
    }
  }
  return design;
}

// Design memories are committed in the same transaction as the mode change.
// Switching to a lineup never sends a raster-only card to the Battle renderer.
export function workspaceDesignChange(context, changes, fallback) {
  if (!Object.hasOwn(changes, 'design') && !Object.hasOwn(changes, 'throMode')) return changes;
  const beforeMode = context.throMode ?? 'single', mode = changes.throMode ?? beforeMode;
  let singleDesign = beforeMode === 'single' ? context.design : context.singleDesign;
  let legacyDesign = !isNativeStudy(context.design?.study) ? context.design : context.legacyDesign ?? fallback;
  let design = changes.design ?? (mode === 'single' && beforeMode !== 'single' ? singleDesign ?? legacyDesign : context.design);
  if (mode !== 'single' && isNativeStudy(design?.study)) design = legacyDesign;
  if (isNativeStudy(design?.study)) design = { ...design, orientation: nativeStudy(design.study).orientation, rendererBuild: design.rendererBuild ?? nativeBuild };
  else legacyDesign = design;
  if (mode === 'single') singleDesign = design;
  return { ...changes, design: structuredClone(design), singleDesign: structuredClone(singleDesign ?? design), legacyDesign: structuredClone(legacyDesign) };
}

/** What a card draws, without the photo bytes: the recipe. thro-world.mjs runs this same function as the
 *  implementation of the PxC contract thro.card.recipe, so the world and the renderer share one source of truth. */
export function nativeCardRecipe({ disc, resolved, design }) {
  const selected = nativeStudy(design.study);
  if (design.rendererBuild !== nativeBuild) throw Error('This native card design requires another renderer build.');
  const scale = design.nativeScale ?? 0.66;
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 1.5) throw Error('Choose a card size between 50% and 150%.');
  const nudge = design.nativeNudge ?? { x: 0, y: 0 };
  if (!validNudge(nudge)) throw Error('Card position is out of range.');
  const appearance = { discSide: design.nativeSide ?? selected.side, highlightTarget: design.nativeHighlight ?? selected.highlight, accentColor: design.accent ?? selected.accent };
  if (design.nativePlate === 'solid') appearance.plate = 'solid'; // 'solid' is the dark plate; see-through is the default
  const revision = design.nativeRevision;
  if (revision !== undefined && !knownRevision(selected.preset, revision)) throw Error('This card revision is not available for its layout.');
  const parts = design.nativeParts && Object.keys(design.nativeParts).length ? design.nativeParts : null;
  if (parts && (partsLayout(design) !== selected.preset || !validParts(parts, selected.preset))) throw Error('These card parts are not available for this layout.');
  return {
    disc: { id: disc.id, mold: disc.mold, name: resolved.name, manufacturer: resolved.manufacturer, plastic: disc.plastic ?? null, weight: disc.weight ?? null },
    flights: ['speed', 'glide', 'turn', 'fade'].map(field => resolved[field] ?? null),
    preset: selected.preset, placement: 'panel-default', scale, appearance,
    // The card keeps its own corner anchor; a nudge moves it from there (canvas pixels).
    ...(nudge.x || nudge.y ? { nudge: { x: nudge.x, y: nudge.y } } : {}),
    ...(revision !== undefined ? { revision } : {}),
    // Parts the person pinned; the renderer derives the rest. Sorted, so the same pins are the same recipe.
    ...(parts ? { parts: Object.fromEntries(Object.keys(parts).sort().map(k => [k, parts[k]])) } : {}),
  };
}
/** The renderer's request: the recipe plus the retained prepared photo. */
export function nativeCardRequest({ disc, resolved, design }) {
  nativeStudy(design.study);
  if (design.rendererBuild !== nativeBuild) throw Error('This native card design requires another renderer build.');
  if (disc?.depiction?.kind !== 'photo' || !/^data:image\/(?:png|jpeg|webp);base64,/.test(disc.depiction.src)) throw Error('A native card requires the retained prepared photo.');
  const { disc: facts, ...rest } = nativeCardRecipe({ disc, resolved, design });
  return { disc: { ...facts, depiction: { ...disc.depiction } }, photoSrc: disc.depiction.src, ...rest };
}
async function preparedPhotoDigest(source) {
  const bytes = Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), character => character.charCodeAt(0));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
}
// What each card drew and where (disc photo, mold name, flight numbers, everything else),
// kept beside the graphic rather than in it: the stored graphic contract stays exactly as it was.
// Keyed by the card's PNG data, which survives the SVG being re-serialised on screen.
const layouts = new Map(), pixelsOf = svg => /href=["'](data:image\/png;base64,[^"']+)/.exec(String(svg))?.[1] ?? String(svg);
export const cardLayout = svgOrHref => layouts.get(pixelsOf(svgOrHref)) ?? null;
/** A lineup: which card design each disc gets (its own accent if the lineup treatment set one) and which disc is featured.
 *  The lineup renderer and thro-world.mjs (thro.lineup.recipe) both start from this plan. */
export function nativeLineupPlan({ material, design, entries }) {
  const selected = lineupStudy(design.study), state = material.states?.[0];
  const cards = entries.map(entry => {
    const cardDesign = nativeDesign({ ...design, study: selected.cardStudy, rendererBuild: nativeBuild }, selected.cardStudy);
    // A lineup card starts at its layout's latest revision (B01: 2, drawn from parts), like a card picked fresh in Single.
    if (cardDesign.nativeRevision === undefined && latestCardRevision(selected.cardStudy) !== undefined) cardDesign.nativeRevision = latestCardRevision(selected.cardStudy);
    if (!cardParts[selected.preset]) delete cardDesign.nativeParts; // parts are B01's; another lineup layout ignores them
    // Numbers: the lineup may swap which part of the number tiles carries the accent (digits or tiles) for every card at once.
    if (design.lineupHighlight === 'digits' || design.lineupHighlight === 'tiles') cardDesign.nativeHighlight = design.lineupHighlight;
    const accent = material.styles?.[entry.id]?.accent ?? design.accent ?? cardDesign.accent;
    return { disc: entry.disc, resolved: entry.resolved, design: { ...cardDesign, accent, rendererBuild: nativeBuild } };
  });
  const featured = state?.highlight ? entries.findIndex(entry => entry.id === state.highlight) : -1;
  const frame = lineupFrame(design);
  return { preset: selected.preset, featured: featured >= 0 ? featured : null, cards, ...(frame.id !== '16:9' ? { frame: frame.id } : {}) };
}
/** What the lineup renderer draws from, without photo bytes: the lineup recipe Part. */
// A 16:9 lineup without card revisions or parts keeps exactly the recipe it had before frames and parts existed.
export const lineupRequestRecipe = (plan, requests, photos) => ({ preset: plan.preset, featured: plan.featured, ...(plan.frame ? { frame: plan.frame } : {}),
  cards: requests.map((request, i) => { const { depiction, ...disc } = request.disc; return { disc, flights: request.flights, appearance: request.appearance, photo: photos[i],
    ...(request.revision !== undefined ? { revision: request.revision } : {}), ...(request.parts ? { parts: request.parts } : {}) }; }) });
/** The recipe inside a renderer request (photo by SHA-256), and the hash the kernel gives that Part. */
export const requestRecipe = (request, photo) => { const { disc: { depiction, ...disc }, photoSrc, ...rest } = request; return { disc, ...rest, photo }; };
export const recipePartHash = recipe => hashString(canonical(recipe));
/** The accent palette, by name (the app's swatches and the world's definitions read this one list). */
export const accentPalette = Object.freeze([['#a6edda', 'Mint'], ['#c8f23d', 'Lime'], ['#ffd166', 'Gold'], ['#ff7a45', 'Orange'], ['#ff4d6d', 'Red'], ['#c77dff', 'Violet'], ['#4cc9f0', 'Sky'], ['#f6f3e9', 'Chalk']].map(pair => Object.freeze(pair)));
export const accentName = hex => accentPalette.find(([value]) => value.toLowerCase() === String(hex).toLowerCase())?.[1] ?? null;
export const pixelStats = { drawn: 0, reused: 0, byRecipe: new Map() }; // byRecipe: recipe Part hash → 'drawn' | 'reused', the latest outcome for it
const notePixels = (key, cached) => { pixelStats[cached ? 'reused' : 'drawn']++; pixelStats.byRecipe.delete(key); pixelStats.byRecipe.set(key, cached ? 'reused' : 'drawn'); if (pixelStats.byRecipe.size > 80) pixelStats.byRecipe.delete(pixelStats.byRecipe.keys().next().value); };
export function createNativeRenderer(renderCard = async request => {
  const adapter = await import('./vendor/discstudio-cards/thro-adapter.mjs');
  return adapter.renderDiscStudioCard(request);
}, renderLineup = async request => {
  const adapter = await import('./vendor/discstudio-cards/thro-adapter.mjs');
  return adapter.renderDiscStudioLineup(request);
}) {
  const pixels = new Map(), inflight = new Map(); // per renderer: a card enters pixels only after it passed every check below
  const single = async input => {
    if (!isNativeStudy(input.design?.study)) return null;
    if (input.purpose && input.purpose !== 'single') throw Error('Thro card layouts are available in Single. Choose a lineup composition for Battle or Bag.');
    const at = here(); // the stage this drawing belongs to, kept across the awaits below
    const request = nativeCardRequest(input), photo = await span('hash the disc photo', () => preparedPhotoDigest(request.photoSrc), at);
    // Same recipe, same pixels: the key is the hash the PxC kernel gives the recipe Part (thro.card.recipe's output).
    const key = recipePartHash(requestRecipe(request, photo));
    // A card being drawn is drawn once: a second request for the same recipe waits for the same drawing.
    const cached = pixels.get(key);
    let drawing = cached ? null : inflight.get(key);
    const mine = !cached && !drawing;
    if (mine) { drawing = span('draw the pixels', () => renderCard(request), at); inflight.set(key, drawing); drawing.finally(() => inflight.delete(key)).catch(() => {}); }
    // Waiting for a drawing another request started is a stage of its own, so it is not mistaken for this one's own work.
    const result = cached ?? await (mine ? drawing : span('wait for the same drawing, already in flight', () => drawing, at));
    const portrait = nativeStudy(input.design.study).orientation === 'portrait';
    if (result.build !== nativeBuild) throw Error('Native renderer build does not match this saved design.');
    // A renderer that does not report a revision drew revision 1; one that ignored the asked revision is refused.
    if ((result.revision ?? 1) !== (request.revision ?? 1)) throw Error('The card renderer drew another revision than this design asked for.');
    if (result.width !== (portrait ? 1080 : 1920) || result.height !== (portrait ? 1920 : 1080)) throw Error('Native card dimensions do not match its layout.');
    if (typeof result.svg !== 'string' || !/href=["']data:image\/png;base64,/.test(result.svg) || /href=["'](?:https?:|blob:)/i.test(result.svg)) throw Error('Native output must contain its retained PNG pixels.');
    // Explicit allowlist: the adapter's Blob and any browser objects never enter
    // the owning model or archive. Source addresses remain actual owning Parts.
    if (result.layout) { layouts.set(pixelsOf(result.svg), result.layout); if (layouts.size > 60) layouts.delete(layouts.keys().next().value); }
    notePixels(key, cached);
    if (!cached) { pixels.set(key, result); if (pixels.size > 40) pixels.delete(pixels.keys().next().value); }
    return { svg: result.svg, width: result.width, height: result.height, provenance: {
      schema: 'thro-native-card@1', renderer: 'discstudio-cards', rendererBuild: nativeBuild,
      preset: request.preset, physicalDiscId: input.disc.id, discAddress: input.discAddress,
      designAddress: input.designAddress, resolvedAddress: input.resolvedAddress,
      preparedPhotoSha256: photo,
      appearance: { ...request.appearance }, placement: { ...result.placement }, rasterOnly: true,
      // the nudge the design asked for, kept apart from the placement the adapter's clamp produced
      ...(request.nudge ? { nudge: { ...request.nudge } } : {}),
      ...(request.revision !== undefined ? { revision: request.revision } : {}),
      ...(request.parts ? { parts: { ...request.parts } } : {}),
    } };
  };
  // Bag: each entry is the exact request its Single card would make, set in one frame.
  // Per-entry accents from the lineup treatment carry over; the featured disc (whose turn)
  // stays full size while the rest step back. No points or turn text is drawn.
  // Bag: each entry is the exact request its Single card would make, set in one frame (nativeLineupPlan).
  // Pixels are cached per renderer by the hash the kernel gives the lineup recipe Part (thro.lineup.recipe).
  const lineupPixels = new Map();
  single.lineup = async ({ material, design, entries }) => {
    if (!isLineupStudy(design?.study)) return null;
    const plan = nativeLineupPlan({ material, design, entries });
    const requests = plan.cards.map(card => nativeCardRequest(card));
    const photos = [];
    for (const request of requests) photos.push(await preparedPhotoDigest(request.photoSrc));
    const key = recipePartHash(lineupRequestRecipe(plan, requests, photos));
    const cached = lineupPixels.get(key);
    const frame = lineupFrame(design);
    const result = cached ?? await renderLineup({ cards: requests.map(({ disc, photoSrc, flights, appearance, revision, parts }) => ({ disc, photoSrc, flights, appearance, ...(revision !== undefined ? { revision } : {}), ...(parts ? { parts } : {}) })),
      preset: plan.preset, emphasis: plan.featured, width: frame.width, height: frame.height });
    if (result.build !== nativeBuild) throw Error('Native renderer build does not match this saved lineup.');
    if (result.width !== frame.width || result.height !== frame.height || typeof result.svg !== 'string' || !/href=["']data:image\/png;base64,/.test(result.svg) || /href=["'](?:https?:|blob:)/i.test(result.svg)) throw Error('Native lineup must contain its retained PNG pixels.');
    if (result.layout) { layouts.set(pixelsOf(result.svg), result.layout); if (layouts.size > 60) layouts.delete(layouts.keys().next().value); }
    notePixels(key, cached);
    if (!cached) { lineupPixels.set(key, result); if (lineupPixels.size > 20) lineupPixels.delete(lineupPixels.keys().next().value); }
    const backdrop = lineupBackdrop(design);
    return { svg: withBackdrop(result.svg, backdrop), width: result.width, height: result.height, provenance: {
      schema: 'thro-native-lineup@1', renderer: 'discstudio-cards', rendererBuild: nativeBuild, preset: plan.preset,
      physicalDiscIds: entries.map(entry => entry.disc.id), preparedPhotoSha256: photos,
      appearances: requests.map(request => ({ ...request.appearance })), featured: plan.featured, scales: [...result.scales], rasterOnly: true,
      ...(plan.frame ? { frame: plan.frame, arrangement: result.arrangement } : {}),
      ...(backdrop.fill ? { backdrop: backdrop.id } : {}),
    } };
  };
  return single;
}
