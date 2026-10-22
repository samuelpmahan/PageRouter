import { MAX_ARCHIVE_BYTES } from './archive-codec.mjs';
import { bad, require, same, dangerous, exactKeys, encoder, snapshotJson, digest, envelopeDigest, identity, rawBytes, DATA_SCHEMA, EDIT_PROFILE, LEGACY_V1_PROFILE, supportsCapability, supportsLegacyProducer, calculationNames, usesCardAppearance, revisionCapability } from './transfer-contracts.mjs';
const paintings = ['pressed-fern', 'chevron-run', 'contour-basin'].map(name => ({ src: `./art/${name}.svg` }));

// A closed check for this creator's generated SVG/data-URL carriers. This is
// deliberately not a general SVG sanitizer or an arbitrary document importer.
export function mediaChecker() {
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

export function preflight(raw, known = null) {
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
    if (Object.hasOwn(node, 'function')) require(exactKeys(node, ['id', 'function']) && typeof node.function === 'string' && /^(fn|oc)\.[\w.]+$/.test(node.function) && (!known || known.has(node.function)), 'Unknown package Calculation.');
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

function graphReader(data) {
  const nodes = new Map(data.nodes.map(node => [node.id, node])), bindings = new Map(data.bindings), cache = new Map();
  function decode(tag) {
    if (Object.hasOwn(tag, 'scalar')) return tag.scalar;
    if (tag.array) return tag.array.map(decode);
    if (tag.object) return Object.fromEntries(tag.object.map(([key, item]) => [key, decode(item)]));
    return { part: tag.part };
  }
  const nodeValue = id => {
    const node = nodes.get(id); require(node && Object.hasOwn(node, 'material'), 'A retained source is not material.');
    if (!cache.has(id)) cache.set(id, decode(node.material));
    return cache.get(id);
  };
  const value = address => { require(typeof address === 'string' && bindings.has(address), 'Unbound retained capture source.'); return nodeValue(bindings.get(address)); };
  const contexts = data.bindings.filter(([name]) => /^ds\.px\.studio\.demo\.\d+\.context$/.test(name))
    .sort(([left], [right]) => Number(left.split('.')[4]) - Number(right.split('.')[4]));
  require(contexts.length > 0, 'Missing workspace context.');
  return { nodes, bindings, nodeValue, value, context: value(contexts.at(-1)[0]) };
}

/** Content witnesses, never producer app hashes, determine the requirements. */
export function deriveRequirements(data) {
  const requirements = new Set(['parts-archive@1', 'prepared-disc@1']);
  if (data.bagsAddress) requirements.add('versioned-bags@1');
  const reader = graphReader(data);
  for (const node of data.nodes) {
    if (node.function?.startsWith('fn.studio.competition') || node.function?.startsWith('fn.battle.')) requirements.add('studio-lineup-svg@1');
    if (node.function === 'fn.studio.exportRecord') requirements.add('export-record@1');
    if (!Object.hasOwn(node, 'material')) continue;
    const item = reader.nodeValue(node.id);
    for (const design of [item, item?.design, item?.singleDesign, item?.legacyDesign]) if (design?.study?.startsWith('discstudio:')) {
      requirements.add('discstudio-card-png@1'); requirements.add(`discstudio-recipe@${design.rendererBuild}/${design.study.slice('discstudio:'.length)}`);
      if (usesCardAppearance(design)) requirements.add('thro-card-appearance@1');
      if (Object.hasOwn(design, 'nativeRevision')) requirements.add(revisionCapability(design.study.slice('discstudio:'.length), design.nativeRevision));
    }
    const provenance = item?.graphic?.provenance;
    if (provenance?.schema === 'thro-native-card@1' && (provenance.appearance?.plate === 'solid' || Object.hasOwn(provenance, 'nudge'))) requirements.add('thro-card-appearance@1');
    if (provenance?.schema === 'thro-native-card@1' && Object.hasOwn(provenance, 'revision')) requirements.add(revisionCapability(provenance.preset, provenance.revision));
    if (item?.schema === 'studio-graphic@1') requirements.add(item.source?.material ? 'studio-lineup-svg@1' : item.graphic?.provenance?.rasterOnly ? 'discstudio-card-png@1' : 'studio-single-svg@1');
  }
  if (!reader.context.design?.study?.startsWith('discstudio:')) requirements.add('studio-single-svg@1');
  return [...requirements].sort();
}

/** Static only: no model, Calculation, renderer, DOM or storage is imported. */
export async function inspectWorkspacePackage({ package: input, legacyProfile } = {}) {
  const envelope = snapshotJson(input);
  require(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'Package envelope must be an object.');
  if (!((envelope.schema === 'thro-workspace-package@1' && envelope.version === 1) || (envelope.schema === 'thro-workspace-package@2' && envelope.version === 2))) {
    return { status: 'unsupported', editable: false, validation: 'opaque', captures: [], missing: ['package-schema:unknown'], original: envelope };
  }
  let compatibility, origin, extensions;
  if (envelope.schema === 'thro-workspace-package@1' && envelope.version === 1) {
    require(exactKeys(envelope, ['schema', 'version', 'identity', 'provenance', 'archive']), 'Unknown v1 package fields.');
    identity(envelope.identity);
    origin = { identity: envelope.identity, provenance: envelope.provenance };
    extensions = {};
    compatibility = { dataSchema: DATA_SCHEMA, editProfile: legacyProfile === LEGACY_V1_PROFILE ? EDIT_PROFILE : null, requiredCapabilities: [] };
  } else {
    require(exactKeys(envelope, ['schema', 'version', 'compatibility', 'origin', 'extensions', 'archive', 'integrity']) && envelope.schema === 'thro-workspace-package@2' && envelope.version === 2, 'Unknown workspace package envelope.');
    ({ compatibility, origin, extensions } = envelope);
    require(exactKeys(compatibility, ['dataSchema', 'editProfile', 'requiredCapabilities']) && typeof compatibility.dataSchema === 'string' && typeof compatibility.editProfile === 'string'
      && Array.isArray(compatibility.requiredCapabilities) && compatibility.requiredCapabilities.length <= 100 && compatibility.requiredCapabilities.every(item => typeof item === 'string' && item.length <= 160)
      && new Set(compatibility.requiredCapabilities).size === compatibility.requiredCapabilities.length, 'Invalid compatibility declaration.');
    require(origin && typeof origin === 'object' && !Array.isArray(origin) && extensions && typeof extensions === 'object' && !Array.isArray(extensions), 'Origin and optional extensions must be JSON objects.');
    identity(origin.identity);
  }
  require(encoder.encode(JSON.stringify({ compatibility, origin, extensions })).byteLength <= 65536, 'Package metadata exceeds 64 KiB.');
  const archive = envelope.archive;
  require(exactKeys(archive, ['encoding', 'byteLength', 'sha256', 'raw']) && archive.encoding === 'utf-8' && /^[a-f0-9]{64}$/.test(archive.sha256)
    && Number.isSafeInteger(archive.byteLength) && archive.byteLength === rawBytes(archive.raw), 'Package UTF-8 byte count or archive format is invalid.');
  require(archive.sha256 === await digest(archive.raw), 'Package archive SHA-256 differs from its bytes.');
  if (envelope.version === 2) require(exactKeys(envelope.integrity, ['algorithm', 'sha256']) && envelope.integrity.algorithm === 'sha256'
    && envelope.integrity.sha256 === await envelopeDigest(envelope), 'Package envelope integrity differs from its metadata.');
  const report = { status: 'unsupported', editable: false, validation: 'static-only; full editable validation occurs during adoption', schema: envelope.schema, origin, extensions, compatibility,
    archive: { byteLength: archive.byteLength, sha256: archive.sha256 }, captures: [], missing: [], original: envelope };
  if (compatibility.dataSchema !== DATA_SCHEMA) { report.missing.push(`data-schema:${compatibility.dataSchema}`); return report; }
  let parsed; try { parsed = JSON.parse(archive.raw); } catch { throw bad('The package archive is not JSON.'); }
  if (parsed && Number.isSafeInteger(parsed.version) && parsed.version > 0 && parsed.version !== 1) { report.missing.push(`archive-version:${parsed.version}`); return report; }
  const data = preflight(archive.raw), reader = graphReader(data), required = deriveRequirements(data);
  if (envelope.version === 2) require(required.every(item => compatibility.requiredCapabilities.includes(item)), 'The package omits requirements witnessed by its content.');
  else compatibility.requiredCapabilities = required;
  report.requiredCapabilities = required;
  report.missing.push(...compatibility.requiredCapabilities.filter(item => !supportsCapability(item)));
  if (envelope.version === 1 && !supportsLegacyProducer(envelope.identity)) report.missing.push('legacy-producer:unmapped');
  if (compatibility.editProfile !== EDIT_PROFILE) report.missing.push(`edit-profile:${compatibility.editProfile ?? 'explicit-v1-profile-required'}`);
  report.missing.push(...data.nodes.filter(node => node.function && !calculationNames.has(node.function)).map(node => `calculation:${node.function}`));
  const context = reader.context;
  require(Array.isArray(context.graphics) && new Set(context.graphics).size === context.graphics.length, 'Invalid declared kept captures.');
  const scan = mediaChecker();
  for (const address of context.graphics) {
    const capture = reader.value(address), source = capture.source, graphic = capture.graphic;
    require(capture.schema === 'studio-graphic@1' && typeof capture.title === 'string' && capture.title.trim() && capture.title.length <= 512
      && source?.mount === 'thro.prepared-samples' && same(reader.value(source.graphic), graphic) && same(reader.value(source.design), capture.design), 'Retained capture source, design or title is invalid.');
    require(graphic && typeof graphic.svg === 'string' && Number.isInteger(graphic.width) && Number.isInteger(graphic.height)
      && graphic.width > 0 && graphic.height > 0 && graphic.width <= 4096 && graphic.height <= 4096 && capture.hash === await digest(graphic.svg), 'Retained capture hash or dimensions are invalid.');
    scan(graphic.svg);
    if (source.disc && !source.material) {
      require(same(reader.value(source.disc), capture.specimen?.disc), 'Retained specimen differs from its owning version.');
      const resolvedAddress = graphic.provenance?.resolvedAddress;
      if (resolvedAddress) require(same(reader.value(resolvedAddress), capture.specimen.resolved), 'Retained resolved facts differ from their owning source.');
      else {
        const discId = reader.bindings.get(source.disc);
        require(data.nodes.some(node => node.calculation !== undefined && reader.nodes.get(node.calculation)?.function === 'fn.read'
          && node.inputs.some(([name, id]) => name === 'own' && id === discId) && same(reader.nodeValue(node.id), capture.specimen.resolved)), 'Retained resolved facts lack their source witness.');
      }
    } else require(source.material && !source.disc && same(reader.value(source.material), capture.competition), 'Retained lineup differs from its owning material.');
    let png = null;
    if (graphic.provenance?.rasterOnly === true) {
      const provenance = graphic.provenance;
      require(provenance.schema === 'thro-native-card@1' && provenance.discAddress === source.disc && provenance.designAddress === source.design
        && provenance.physicalDiscId === capture.specimen.disc.id && provenance.rendererBuild === capture.design.rendererBuild
        && provenance.preset === capture.design.study?.slice('discstudio:'.length), 'Retained native identity is inconsistent.');
      const carrier = new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" width="${graphic.width}" height="${graphic.height}" viewBox="0 0 ${graphic.width} ${graphic.height}"><image width="${graphic.width}" height="${graphic.height}" href="data:image/png;base64,([A-Za-z0-9+/]+={0,2})"/></svg>$`).exec(graphic.svg);
      require(carrier, 'Unsupported frozen native PNG carrier.');
      png = `data:image/png;base64,${carrier[1]}`;
      scan(png);
      const bytes = atob(carrier[1]), number = offset => [...bytes.slice(offset, offset + 4)].reduce((sum, character) => sum * 256 + character.charCodeAt(0), 0);
      require(number(16) === graphic.width && number(20) === graphic.height, 'Frozen PNG header dimensions differ.');
      const photo = capture.specimen.disc.depiction?.src;
      require(typeof photo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(photo), 'Frozen native prepared photo is missing.');
      const photoBytes = Uint8Array.from(atob(photo.split(',')[1]), character => character.charCodeAt(0));
      const photoHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', photoBytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      require(photoHash === provenance.preparedPhotoSha256, 'Frozen native photo hash differs.');
    }
    report.captures.push({ address, title: capture.title, format: png ? 'png' : 'svg', svg: graphic.svg, png, width: graphic.width, height: graphic.height, hash: capture.hash,
      source: snapshotJson(source), provenance: graphic.provenance ? snapshotJson(graphic.provenance) : null,
      integrity: 'hash-and-archived-source-consistent', authenticated: false });
  }
  report.editable = report.missing.length === 0;
  report.status = report.editable ? 'compatible' : 'unsupported';
  return report;
}

