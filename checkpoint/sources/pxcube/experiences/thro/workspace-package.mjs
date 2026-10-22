import { openDemo } from './model.mjs';
import { createExperience, paintings } from './studio/upload-disc-to-shelf/model.js';
import { restore } from './studio/upload-disc-to-shelf/persistence.js';
import { Part } from './studio/part-first-kernel/src/pxc.mjs';
import { calculations, allCardStudies } from './graphics.mjs';
import { competitionCalculations } from './competition.mjs';
import { validateBattleRule } from './renderer/src/constraints.js';
import { nativeBuild, isNativeStudy, nativeCardRequest, nativeStudy } from './native-cards.mjs';
import { openLockedArchive } from './locked-storage.mjs';
import { createArchiveCodec, MAX_ARCHIVE_BYTES } from './archive-codec.mjs';
import { pack, unpack } from './archive-storage.mjs';

const encoder = new TextEncoder();
const bad = message => Object.assign(Error(message), { code: 'THRO_PACKAGE_INVALID' });
const require = (condition, message) => { if (!condition) throw bad(message); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const dangerous = key => ['__proto__', 'constructor', 'prototype'].includes(key);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const codec = createArchiveCodec({ pack, unpack });

/** Data only: reject accessors, exotic prototypes and cycles before any await. */
export function snapshotJson(value) {
  let count = 0, bytes = 0;
  const ancestors = new Set();
  function copy(item, depth) {
    require(depth <= 64 && ++count <= 500000, 'Package data is too deeply nested or contains too many values.');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') { require(Number.isFinite(item), 'Package numbers must be finite.'); return item; }
    if (typeof item === 'string') { bytes += encoder.encode(item).byteLength; require(bytes <= MAX_ARCHIVE_BYTES + 65536, 'Package data exceeds its byte budget.'); return item; }
    require(item && typeof item === 'object' && !ancestors.has(item), 'Package inputs must be acyclic plain JSON data.');
    require(Object.getPrototypeOf(item) === (Array.isArray(item) ? Array.prototype : Object.prototype), 'Package inputs must be plain JSON objects and arrays.');
    ancestors.add(item);
    const out = Array.isArray(item) ? [] : {};
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      require(typeof key === 'string' && !dangerous(key) && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'Package fields must be ordinary JSON values.');
      require(key.length <= MAX_ARCHIVE_BYTES + 65536, 'Package field names exceed their byte budget.');
      bytes += encoder.encode(key).byteLength;
      require(bytes <= MAX_ARCHIVE_BYTES + 65536, 'Package field names exceed their byte budget.');
      require(!Array.isArray(item) || /^(0|[1-9][0-9]*)$/.test(key), 'Package arrays cannot contain named properties.');
      out[key] = copy(descriptor.value, depth + 1);
    }
    require(!Array.isArray(item) || out.length === item.length && Object.keys(out).length === item.length, 'Package arrays cannot contain holes.');
    ancestors.delete(item); return out;
  }
  return copy(value, 0);
}

function identity(value) {
  require(exactKeys(value, ['sourceId', 'artifactId', 'nativeRendererBuild']) && /^[a-f0-9]{64}$/.test(value.sourceId)
    && /^[a-f0-9]{64}$/.test(value.artifactId) && value.nativeRendererBuild === nativeBuild, 'An explicit compatible source, artifact and native renderer identity is required.');
  return value;
}
async function digestBytes(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
const digest = text => digestBytes(encoder.encode(text));
function rawBytes(raw) {
  require(typeof raw === 'string' && raw.length <= MAX_ARCHIVE_BYTES, 'Raw package archive exceeds the 64 MiB limit.');
  const bytes = encoder.encode(raw).byteLength;
  require(bytes <= MAX_ARCHIVE_BYTES, 'Raw package archive exceeds the 64 MiB UTF-8 limit.'); return bytes;
}

export async function createWorkspacePackage({ raw, identity: sourceIdentity, provenance = {} }) {
  const metadata = snapshotJson({ identity: sourceIdentity, provenance });
  identity(metadata.identity);
  require(encoder.encode(JSON.stringify(metadata)).byteLength <= 65536, 'Package metadata exceeds 64 KiB.');
  const byteLength = rawBytes(raw);
  return { schema: 'thro-workspace-package@1', version: 1, ...metadata,
    archive: { encoding: 'utf-8', byteLength, sha256: await digest(raw), raw } };
}

// A closed check for this creator's generated SVG/data-URL carriers. This is
// deliberately not a general SVG sanitizer or an arbitrary document importer.
function mediaChecker() {
  const checked = new Set();
  const tags = new Set(['svg', 'title', 'g', 'rect', 'circle', 'ellipse', 'path', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'image', 'style', 'filter', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feColorMatrix', 'feOffset', 'feComposite', 'feFlood', 'feBlend']);
  function scan(text, depth = 0) {
    require(depth <= 8, 'Nested generated images exceed the supported depth.');
    if (checked.has(text)) return;
    checked.add(text);
    if (/^data:/i.test(text)) {
      const svg = /^data:image\/svg\+xml(?:;charset=utf-8)?,(.*)$/s.exec(text);
      if (svg) { let decoded; try { decoded = decodeURIComponent(svg[1]); } catch { throw bad('Invalid generated SVG data URL.'); } scan(decoded, depth + 1); return; }
      const image = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(text);
      require(image && image[2].length % 4 === 0, 'Only retained PNG, JPEG and WebP image data is supported.');
      let bytes; try { bytes = atob(image[2]); } catch { throw bad('Invalid retained image bytes.'); }
      require(btoa(bytes) === image[2], 'Image data must use canonical base64.');
      if (image[1] === 'png') require(bytes.startsWith('\x89PNG\r\n\x1a\n') && bytes.length >= 33 && bytes.slice(12, 16) === 'IHDR', 'Invalid retained PNG header.');
      if (image[1] === 'jpeg') require(bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9'), 'Invalid retained JPEG header.');
      if (image[1] === 'webp') {
        const size = bytes.length >= 12 ? [...bytes.slice(4, 8)].reduce((sum, char, index) => sum + char.charCodeAt(0) * 256 ** index, 0) : 0;
        require(bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP' && size + 8 === bytes.length && /^VP8[ LX]$/.test(bytes.slice(12, 16)), 'Invalid retained WebP container.');
      }
      return;
    }
    if (!/<svg\b/i.test(text)) return;
    text = text.replace(/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*/, '');
    require(/^\s*<svg\b/.test(text) && !/<[!?]|\bon[\w:-]*\s*=|\bxml:base\s*=|@import|expression\s*\(/i.test(text), 'Unsupported active or external generated SVG.');
    require(!/<style\b[^>]*>[\s\S]*?\\[\s\S]*?<\/style\s*>|<[^>]*\\[^>]*>/i.test(text), 'Escaped SVG styles and attributes are outside the generated format.');
    for (const tag of text.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g)) require(tags.has(tag[1]), 'Unsupported generated SVG element.');
    require(!/\b(?:href|src)\s*=\s*[^\s"']/i.test(text), 'Generated image references must be quoted.');
    for (const match of text.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gis)) {
      require(!match[2].includes('&') && (/^#[A-Za-z_][\w:.-]*$/.test(match[2]) || /^data:image\//.test(match[2])), 'External generated image references are unsupported.');
      if (match[2].startsWith('data:')) scan(match[2], depth + 1);
    }
    for (const match of text.matchAll(/url\(\s*["']?([^\s)'"\u0000-\u001f]+)["']?\s*\)/gi)) require(/^#[A-Za-z_][\w:.-]*$/.test(match[1]), 'External SVG style resources are unsupported.');
  }
  return scan;
}

function preflight(raw, known) {
  let data; try { data = JSON.parse(raw); } catch { throw bad('The package archive is not JSON.'); }
  require(exactKeys(data, ['version', 'serial', 'shelfAddress', 'currentSeeds', 'nodes', 'bindings', ...(Object.hasOwn(data ?? {}, 'bagsAddress') ? ['bagsAddress'] : [])])
    && data.version === 1 && Number.isSafeInteger(data.serial) && data.serial >= 0 && data.serial < Number.MAX_SAFE_INTEGER - 100000
    && Array.isArray(data.nodes) && data.nodes.length <= 100000 && Array.isArray(data.bindings) && data.bindings.length <= 100000 && Array.isArray(data.currentSeeds), 'Unsupported archive structure or serial budget.');
  const ids = new Set(), names = new Set(), scan = mediaChecker(); let highestVendorSerial = 0;
  const pairs = (list, accept, message) => {
    require(Array.isArray(list), message); const keys = new Set();
    for (const pair of list) { require(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && !dangerous(pair[0]) && !keys.has(pair[0]), message); keys.add(pair[0]); accept(pair[0], pair[1]); }
  };
  function material(value, depth = 0, field = '') {
    require(depth <= 64 && value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1, 'Invalid tagged archive material.');
    if (Object.hasOwn(value, 'scalar')) {
      require(value.scalar === null || ['string', 'boolean'].includes(typeof value.scalar) || typeof value.scalar === 'number' && Number.isFinite(value.scalar), 'Invalid archive scalar.');
      if (typeof value.scalar === 'string') {
        if (/^(src|href|photoSrc)$/i.test(field)) require(/^data:image\//.test(value.scalar) || paintings.some(item => item.src === value.scalar), 'External or unknown media fields are unsupported.');
        scan(value.scalar);
      }
      return;
    }
    if (Object.hasOwn(value, 'part')) { require(ids.has(value.part), 'Unread material Part link.'); return; }
    if (Object.hasOwn(value, 'array')) { require(Array.isArray(value.array), 'Invalid archive array.'); value.array.forEach(item => material(item, depth + 1)); return; }
    if (Object.hasOwn(value, 'object')) { pairs(value.object, (key, item) => material(item, depth + 1, key), 'Invalid or duplicate material field.'); return; }
    throw bad('Unknown archive material tag.');
  }
  for (const node of data.nodes) {
    require(node && Number.isSafeInteger(node.id) && node.id >= 0 && !ids.has(node.id), 'Invalid Part identity.');
    if (Object.hasOwn(node, 'function')) require(exactKeys(node, ['id', 'function']) && known.has(node.function), 'Unknown package Calculation.');
    else {
      const computed = Object.hasOwn(node, 'calculation');
      require(exactKeys(node, computed ? ['id', 'material', 'calculation', 'inputs'] : ['id', 'material']), 'Unsupported archive node fields.');
      material(node.material);
      if (computed) { require(ids.has(node.calculation), 'Unread Calculation link.'); pairs(node.inputs, (_key, id) => require(ids.has(id), 'Unread Calculation input.'), 'Invalid or duplicate Calculation input.'); }
    }
    ids.add(node.id);
  }
  for (const pair of data.bindings) {
    require(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && /^ds\.px\.[\w.-]+$/.test(pair[0]) && !names.has(pair[0]) && ids.has(pair[1]), 'Invalid archive binding.');
    const counter = /^ds\.px\.studio\.demo\.(\d+)\./.exec(pair[0]);
    require(!counter || Number.isSafeInteger(Number(counter[1])) && Number(counter[1]) < Number.MAX_SAFE_INTEGER - 100000, 'Unsafe studio address serial.');
    const vendorCounter = /(?:^|\.)(?:save|query|bag|depict|edit|keep|review)-(\d+)(?:\.|$)/.exec(pair[0]) ?? /^ds\.px\.painting\.(\d+)$/.exec(pair[0]);
    if (vendorCounter) { require(Number.isSafeInteger(Number(vendorCounter[1])), 'Unsafe disc allocator address.'); highestVendorSerial = Math.max(highestVendorSerial, Number(vendorCounter[1])); }
    names.add(pair[0]);
  }
  require(data.serial >= highestVendorSerial, 'Archive disc allocator was rewound behind retained physical identities.');
  require(names.has(data.shelfAddress) && (data.bagsAddress === undefined || names.has(data.bagsAddress)), 'Missing collection head.');
  pairs(data.currentSeeds, (_id, address) => require(names.has(address), 'Missing current mold.'), 'Invalid current mold list.');
  return data;
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
export async function adoptWorkspacePackage({ storage, locks, key, package: input, expectedIdentity, renderGraphic } = {}) {
  const envelope = snapshotJson(input), expected = snapshotJson(expectedIdentity);
  require(exactKeys(envelope, ['schema', 'version', 'identity', 'provenance', 'archive']) && envelope.schema === 'thro-workspace-package@1' && envelope.version === 1, 'Unknown workspace package envelope.');
  identity(envelope.identity); identity(expected); require(Object.keys(expected).every(key => envelope.identity[key] === expected[key]), 'Package build identity differs from the explicitly expected build.');
  const archive = envelope.archive;
  require(exactKeys(archive, ['encoding', 'byteLength', 'sha256', 'raw']) && archive.encoding === 'utf-8' && /^[a-f0-9]{64}$/.test(archive.sha256)
    && Number.isSafeInteger(archive.byteLength) && archive.byteLength === rawBytes(archive.raw), 'Package UTF-8 byte count or archive format is invalid.');
  require(encoder.encode(JSON.stringify({ identity: envelope.identity, provenance: envelope.provenance })).byteLength <= 65536, 'Package metadata exceeds 64 KiB.');
  // Read the held-empty value before the first await. Any later installer wins
  // the locked compare-and-swap; occupied or malformed values are never opened.
  require(typeof storage?.getItem === 'function' && storage.getItem(key) === null, 'Only an empty workspace namespace can adopt a package.');
  const retained = await openLockedArchive(storage, key, { locks, pack: codec.packArchive, unpack: codec.unpackArchive });
  require(archive.sha256 === await digest(archive.raw), 'Package archive SHA-256 differs from its bytes.');
  require(retained.committedRaw === null, 'The destination workspace is occupied.');
  await validateWorld(archive.raw, renderGraphic);
  retained.setItem('', archive.raw); await retained.flush();
  return { key, identity: envelope.identity, provenance: envelope.provenance, archive: { byteLength: archive.byteLength, sha256: archive.sha256 } };
}
