import { openDemo } from './model.mjs';
import { createExperience } from './studio/upload-disc-to-shelf/model.js';
import { restore } from './studio/upload-disc-to-shelf/persistence.js';
import { Part } from './studio/part-first-kernel/src/pxc.mjs';
import { calculations, allCardStudies } from './graphics.mjs';
import { competitionCalculations } from './competition.mjs';
import { validateBattleRule } from './renderer/src/constraints.js';
import { nativeBuild, isNativeStudy, nativeCardRequest, nativeStudy } from './native-cards.mjs';
import { openLockedArchive } from './locked-storage.mjs';
import { createWorkspaceCodec } from './archive-codec.mjs';
import { pack, unpack } from './archive-storage.mjs';

import { bad, unsupported, require, same, exactKeys, encoder, snapshotJson, digest, digestBytes, envelopeDigest, identity, rawBytes, DATA_SCHEMA, EDIT_PROFILE } from './transfer-contracts.mjs';
import { preflight, inspectWorkspacePackage, deriveRequirements } from './archive-inspection.mjs';
export { snapshotJson } from './transfer-contracts.mjs';
export { inspectWorkspacePackage } from './archive-inspection.mjs';

export async function createWorkspacePackage({ raw, identity: producerIdentity, provenance = {}, origin: retainedOrigin, extensions = {} }) {
  const metadata = snapshotJson({ origin: retainedOrigin ?? { identity: producerIdentity, provenance }, extensions });
  identity(metadata.origin.identity);
  require(encoder.encode(JSON.stringify(metadata)).byteLength <= 65536, 'Package metadata exceeds 64 KiB.');
  const byteLength = rawBytes(raw), data = preflight(raw);
  const compatibility = { dataSchema: DATA_SCHEMA, editProfile: EDIT_PROFILE, requiredCapabilities: deriveRequirements(data) };
  const envelope = { schema: 'thro-workspace-package@2', version: 2, compatibility, ...metadata,
    archive: { encoding: 'utf-8', byteLength, sha256: await digest(raw), raw } };
  envelope.integrity = { algorithm: 'sha256', sha256: await envelopeDigest(envelope) };
  return envelope;
}

async function validateWorld(raw, renderGraphic) {
  const known = createExperience(() => {});
  for (const [name, fn] of Object.entries({ ...calculations, ...competitionCalculations })) known.pxc.set(name, new Part(fn));
  const data = preflight(raw, new Set(known.pxc.entries().filter(([name]) => /^(fn|oc)\./.test(name)).map(([name]) => name)));
  // Frozen replay checks all recorded computed material before the ordinary
  // working-world loader is allowed to normalize anything in disposable memory.
  try { await restore(raw, known.pxc, { mode: 'frozen' }); } catch (error) { throw bad(`Package graph did not replay: ${error.message}`); }
  let scratch = raw;
  const model = await openDemo({ getItem: () => scratch, setItem: (_key, value) => { scratch = value; }, async flush() {} }, { renderGraphic });
  const value = address => { require(typeof address === 'string' && data.bindings.some(([name]) => name === address), 'Unbound package source.'); return model.value(address); };
  const shelf = model.experience.shelf(), shelfAddresses = new Set(shelf.map(row => row.address)), context = model.context;
  const disc = address => { const result = value(address); require(typeof result.id === 'string' && typeof result.mold === 'string' && result.depiction && ['photo', 'painted'].includes(result.depiction.kind), 'Invalid owning disc.'); return result; };
  const design = item => {
    require(item && typeof item === 'object' && ['portrait', 'landscape'].includes(item.orientation) && ['none', 'filled'].includes(item.frame)
      && ['bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-right'].includes(item.placement)
      && ['accent', 'background', 'foreground'].every(key => /^#[a-f0-9]{6}$/i.test(item[key])) && typeof item.title === 'string' && item.title.length <= 80, 'Invalid package design.');
    if (isNativeStudy(item.study)) {
      require(item.rendererBuild === nativeBuild && item.orientation === nativeStudy(item.study).orientation && item.frame === 'none', 'Unsupported native design build or canvas.');
      const defaults = nativeStudy(item.study);
      require(['left', 'right'].includes(item.nativeSide ?? defaults.side) && ['digits', 'tiles'].includes(item.nativeHighlight ?? defaults.highlight)
        && Number.isFinite(item.nativeScale ?? 0.66) && (item.nativeScale ?? 0.66) >= 0.5 && (item.nativeScale ?? 0.66) <= 1.5, 'Unsupported native appearance.');
    }
    else require(allCardStudies.some(study => study.id === item.study), 'Unsupported legacy design.');
  };
  require(shelf.length > 0 && new Set(shelf.map(row => row.disc.id)).size === shelf.length, 'A prepared shelf needs distinct physical copies.');
  for (const row of shelf) disc(row.address);
  require(shelfAddresses.has(context.selectedDisc) && Array.isArray(context.selection) && new Set(context.selection).size === context.selection.length && context.selection.every(address => shelfAddresses.has(address)), 'Invalid current shelf selection.');
  require(['single', 'battle', 'bag'].includes(context.throMode ?? 'single'), 'Unsupported workspace mode.');
  design(context.design); if (context.singleDesign) design(context.singleDesign); if (context.legacyDesign) { design(context.legacyDesign); require(!isNativeStudy(context.legacyDesign.study), 'The saved lineup design must be compatible with the legacy renderer.'); }
  require((context.throMode ?? 'single') === 'single' || !isNativeStudy(context.design.study), 'Native layouts cannot be active in Battle or Bag.');
  require(Array.isArray(context.graphics) && new Set(context.graphics).size === context.graphics.length && Array.isArray(context.exports)
    && Array.isArray(context.imported) && context.imported.length === 0, 'Imported or malformed capture collections are unsupported.');
  function competition(address) {
    const material = value(address); require(typeof material.name === 'string' && material.name.trim() && material.styles && typeof material.styles === 'object' && !Array.isArray(material.styles)
      && typeof material.emphasizeTurn === 'boolean' && Array.isArray(material.constraints) && Array.isArray(material.entries) && material.entries.length >= 2 && material.entries.length <= 4 && new Set(material.entries.map(entry => entry.address)).size === material.entries.length, 'Invalid lineup entries or styles.');
    for (const rule of material.constraints) { try { validateBattleRule(rule); } catch (error) { throw bad(`Invalid saved lineup constraint: ${error.message}`); } }
    for (const entry of material.entries) require(disc(entry.address).id === entry.discId && typeof entry.id === 'string', 'Invalid lineup specimen.');
    require(Array.isArray(material.states) && material.states.length === 1 && material.currentStateId === material.states[0].id, 'Unsupported lineup states.');
    const ids = material.entries.map(entry => entry.id), state = material.states[0];
    for (const [id, style] of Object.entries(material.styles)) require(ids.includes(id) && style && Number.isFinite(style.scale) && style.scale >= 0.45 && style.scale <= 1.5 && /^#[a-f0-9]{6}$/i.test(style.accent), 'Invalid lineup treatment.');
    require(new Set(ids).size === ids.length && state.scores && ids.every(id => Number.isFinite(state.scores[id])) && Object.keys(state.scores).length === ids.length
      && (state.highlight === null || ids.includes(state.highlight)) && Array.isArray(state.winners) && state.winners.every(id => ids.includes(id)), 'Invalid lineup state references.'); return material;
  }
  if (context.competitionAddress) competition(context.competitionAddress);
  const captures = new Map();
  for (const address of context.graphics) {
    const capture = value(address), source = capture.source;
    require(capture.schema === 'studio-graphic@1' && typeof capture.title === 'string' && capture.title.trim() && capture.title.length <= 512 && !/[\u0000-\u001f]/.test(capture.title)
      && source?.mount === 'thro.prepared-samples' && same(value(source.graphic), capture.graphic) && same(value(source.design), capture.design), 'Capture title, source or design does not match its owning Parts.');
    design(capture.design);
    require(capture.hash === await digest(capture.graphic.svg) && Number.isInteger(capture.graphic.width) && Number.isInteger(capture.graphic.height)
      && capture.graphic.width > 0 && capture.graphic.width <= 4096 && capture.graphic.height > 0 && capture.graphic.height <= 4096, 'Capture bytes or dimensions are invalid.');
    let regenerated;
    if (source.disc && !source.material) {
      const specimen = disc(source.disc), resolved = model.experience.resolve(specimen);
      require(same(capture.specimen, { disc: specimen, resolved }), 'Captured specimen facts differ from their owning version.');
      if (isNativeStudy(capture.design.study)) {
        const provenance = capture.graphic.provenance;
        const request = nativeCardRequest({ disc: specimen, resolved, design: capture.design });
        require(exactKeys(provenance, ['schema', 'renderer', 'rendererBuild', 'preset', 'physicalDiscId', 'discAddress', 'designAddress', 'resolvedAddress', 'preparedPhotoSha256', 'appearance', 'placement', 'rasterOnly'])
          && provenance.schema === 'thro-native-card@1' && provenance.renderer === 'discstudio-cards' && provenance.rasterOnly === true
          && provenance.preset === request.preset && provenance.rendererBuild === nativeBuild && provenance.discAddress === source.disc && provenance.physicalDiscId === specimen.id
          && provenance.designAddress === source.design && same(value(provenance.resolvedAddress), resolved), 'Native capture provenance is not bound to its owning version.');
        require(same(provenance.appearance, request.appearance) && exactKeys(provenance.placement, ['scale', 'dx', 'dy']) && provenance.placement.scale === request.scale
          && [provenance.placement.dx, provenance.placement.dy].every(value => Number.isFinite(value) && Math.abs(value) <= 1), 'Native capture treatment differs from its retained design.');
        const photo = Uint8Array.from(atob(specimen.depiction.src.split(',')[1]), value => value.charCodeAt(0));
        require(provenance.preparedPhotoSha256 === await digestBytes(photo), 'Native capture prepared-photo identity differs from its retained bytes.');
        const { width, height, svg } = capture.graphic, expectedWidth = capture.design.orientation === 'portrait' ? 1080 : 1920, expectedHeight = capture.design.orientation === 'portrait' ? 1920 : 1080;
        require(width === expectedWidth && height === expectedHeight, 'Native carrier canvas differs from its retained layout.');
        const carrier = new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="data:image/png;base64,([A-Za-z0-9+/]+={0,2})"/></svg>$`).exec(svg);
        require(carrier, 'Only the pinned single-PNG native SVG carrier is supported.');
        const png = atob(carrier[1]), uint32 = offset => [...png.slice(offset, offset + 4)].reduce((sum, character) => sum * 256 + character.charCodeAt(0), 0);
        require(png.startsWith('\x89PNG\r\n\x1a\n') && png.slice(12, 16) === 'IHDR' && uint32(16) === width && uint32(20) === height, 'Native PNG header dimensions differ from its carrier.');
        // These are the producer's saved pixels. Repainting on another browser
        // would change the retained asset; content hashes do not authenticate it.
        regenerated = capture.graphic;
      } else regenerated = (await model.render(source.disc, capture.design)).graphic;
    } else {
      require(source.material && !source.disc && !isNativeStudy(capture.design.study) && same(competition(source.material), capture.competition), 'Invalid owning lineup capture.');
      regenerated = (await model.renderCompetition(capture.design, source.material)).graphic;
    }
    require(same(regenerated, capture.graphic), 'Capture differs from the trusted renderer for its retained source and design.');
    captures.set(address, capture);
  }
  for (const address of context.exports) {
    const record = value(address), capture = captures.get(record.capture);
    require(capture && record.svgHash === capture.hash && ['png', 'svg'].includes(record.format), 'Export record is not bound to an owning capture.');
  }
  // A valid history must not hide a broken uncaptured startup state. Rendering
  // here is disposable and does not Keep, flush or repaint retained native PNGs.
  if ((context.throMode ?? 'single') === 'single') {
    if (isNativeStudy(context.design.study)) { const selected = disc(context.selectedDisc); nativeCardRequest({ disc: selected, resolved: model.experience.resolve(selected), design: context.design }); }
    else await model.render(context.selectedDisc, context.design);
  } else if (context.competitionAddress) await model.renderCompetition(context.design, context.competitionAddress);
  else require(context.selection.length >= 2 && context.selection.length <= 4, 'A lineup startup needs two to four selected copies.');
  return model;
}

/** Validate completely in disposable memory, then install once into empty CAS. */
export async function adoptWorkspacePackage({ storage, locks, key, package: input, legacyProfile, renderGraphic } = {}) {
  const envelope = snapshotJson(input);
  require(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'Package envelope must be an object.');
  if (!((envelope.schema === 'thro-workspace-package@1' && envelope.version === 1) || (envelope.schema === 'thro-workspace-package@2' && envelope.version === 2))) throw unsupported('Unknown package format; retain the original bytes.');
  const metadata = snapshotJson(envelope.version === 1 ? { origin: { identity: envelope.identity, provenance: envelope.provenance }, extensions: {} }
    : { origin: envelope.origin, extensions: envelope.extensions });
  // Read the held-empty value before the first await. Any later installer wins
  // the locked compare-and-swap; occupied or malformed values are never opened.
  require(typeof storage?.getItem === 'function' && storage.getItem(key) === null, 'Only an empty workspace namespace can adopt a package.');
  const codec = createWorkspaceCodec({ pack, unpack, metadata });
  const retained = await openLockedArchive(storage, key, { locks, pack: codec.packArchive, unpack: codec.unpackArchive });
  const report = await inspectWorkspacePackage({ package: envelope, legacyProfile });
  if (!report.editable) throw unsupported(`Workspace cannot be edited by this data profile: ${report.missing.join(', ')}. Original package was not changed.`);
  const archive = envelope.archive;
  require(retained.committedRaw === null, 'The destination workspace is occupied.');
  await validateWorld(archive.raw, renderGraphic);
  retained.setItem('', archive.raw); await retained.flush();
  return { key, origin: report.origin, extensions: report.extensions, compatibility: report.compatibility,
    archive: { byteLength: archive.byteLength, sha256: archive.sha256 } };
}
