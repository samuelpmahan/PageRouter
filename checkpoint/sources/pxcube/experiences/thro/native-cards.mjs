// Native card pixels are an optional Single treatment. The renderer/catalog
// module graph is imported only when one of these explicit studies is used.
export const nativeBuild = '28ac2b39fab85255';
const definitions = [
  ['u01', 'Compact scorebug'], ['u02', 'Stacked poster'],
  ['u03-front', 'Disc in front'], ['u03-behind', 'Disc behind'],
  ['u04', 'Kinetic name'], ['u05', 'Glass drawer'],
  ['b01', 'Hero rail'], ['b02', 'Split nameplate'], ['b03', 'Framed hero'],
  ['b04', 'Peak mark'], ['b05', 'Stamp macro'],
];
export const nativeStudies = Object.freeze(definitions.map(([preset, name]) => Object.freeze({
  id: `discstudio:${preset}`, preset, name: `DiscStudio ${preset.toUpperCase()} - ${name}`,
  orientation: preset.startsWith('u') ? 'portrait' : 'landscape',
  side: ['u02', 'u04', 'u05'].includes(preset) ? 'left' : 'right',
  highlight: preset === 'u01' || preset === 'u02' || preset.startsWith('b') ? 'digits' : 'tiles',
  accent: /^(u03|u04|b0)/.test(preset) ? '#c8f23d' : '#8fe3ae',
})));
export const isNativeStudy = study => typeof study === 'string' && study.startsWith('discstudio:');
export function nativeStudy(study) {
  const result = nativeStudies.find(item => item.id === study);
  if (!result) throw Error('Choose a known DiscStudio card layout.');
  return result;
}
export function nativeDesign(previous, study) {
  const selected = nativeStudy(study), wasNative = isNativeStudy(previous.study), same = previous.study === study;
  return { ...previous, study, rendererBuild: nativeBuild, orientation: selected.orientation, frame: 'none',
    accent: wasNative ? previous.accent : selected.accent,
    nativeScale: wasNative ? previous.nativeScale ?? 0.66 : 0.66,
    nativeSide: same ? previous.nativeSide ?? selected.side : selected.side,
    nativeHighlight: same ? previous.nativeHighlight ?? selected.highlight : selected.highlight };
}
export function nativeControlDesign(previous, controls) {
  const design = nativeDesign(previous, controls.study);
  if (isNativeStudy(previous.study)) {
    if (controls.scale !== undefined) design.nativeScale = controls.scale;
    if (controls.accent !== undefined) design.accent = controls.accent;
  }
  // A new layout takes its own side/highlight defaults. The controls still
  // belong to the previous layout until the next paint, so read them only
  // when editing that same layout.
  if (previous.study === controls.study) {
    if (controls.side !== undefined) design.nativeSide = controls.side;
    if (controls.highlight !== undefined) design.nativeHighlight = controls.highlight;
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

export function nativeCardRequest({ disc, resolved, design }) {
  const selected = nativeStudy(design.study);
  if (design.rendererBuild !== nativeBuild) throw Error('This native card design requires another renderer build.');
  if (disc?.depiction?.kind !== 'photo' || !/^data:image\/(?:png|jpeg|webp);base64,/.test(disc.depiction.src)) throw Error('A native card requires the retained prepared photo.');
  const scale = design.nativeScale ?? 0.66;
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 1.5) throw Error('Choose a native card size between 50% and 150%.');
  return {
    disc: { id: disc.id, mold: disc.mold, name: resolved.name, manufacturer: resolved.manufacturer,
      plastic: disc.plastic ?? null, weight: disc.weight ?? null, depiction: { ...disc.depiction } },
    photoSrc: disc.depiction.src,
    flights: ['speed', 'glide', 'turn', 'fade'].map(field => resolved[field] ?? null),
    preset: selected.preset, placement: 'panel-default', scale,
    appearance: { discSide: design.nativeSide ?? selected.side, highlightTarget: design.nativeHighlight ?? selected.highlight, accentColor: design.accent ?? selected.accent },
  };
}
async function preparedPhotoDigest(source) {
  const bytes = Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), character => character.charCodeAt(0));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
}
export function createNativeRenderer(renderCard = async request => {
  const adapter = await import('./vendor/discstudio-cards/thro-adapter.mjs');
  return adapter.renderDiscStudioCard(request);
}) {
  return async input => {
    if (!isNativeStudy(input.design?.study)) return null;
    if (input.purpose && input.purpose !== 'single') throw Error('DiscStudio card layouts are available in Single. Choose a lineup composition for Battle or Bag.');
    const request = nativeCardRequest(input), result = await renderCard(request);
    const portrait = nativeStudy(input.design.study).orientation === 'portrait';
    if (result.build !== nativeBuild) throw Error('Native renderer build does not match this saved design.');
    if (result.width !== (portrait ? 1080 : 1920) || result.height !== (portrait ? 1920 : 1080)) throw Error('Native card dimensions do not match its layout.');
    if (typeof result.svg !== 'string' || !/href=["']data:image\/png;base64,/.test(result.svg) || /href=["'](?:https?:|blob:)/i.test(result.svg)) throw Error('Native output must contain its retained PNG pixels.');
    // Explicit allowlist: the adapter's Blob and any browser objects never enter
    // the owning model or archive. Source addresses remain actual owning Parts.
    return { svg: result.svg, width: result.width, height: result.height, provenance: {
      schema: 'thro-native-card@1', renderer: 'discstudio-cards', rendererBuild: nativeBuild,
      preset: request.preset, physicalDiscId: input.disc.id, discAddress: input.discAddress,
      designAddress: input.designAddress, resolvedAddress: input.resolvedAddress,
      preparedPhotoSha256: await preparedPhotoDigest(request.photoSrc),
      appearance: { ...request.appearance }, placement: { ...result.placement }, rasterOnly: true,
    } };
  };
}
