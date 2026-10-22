import { MAX_ARCHIVE_BYTES } from './archive-codec.mjs';
export const encoder = new TextEncoder();
export const bad = message => Object.assign(Error(message), { code: 'THRO_PACKAGE_INVALID' });
export const unsupported = message => Object.assign(Error(message), { code: 'THRO_PACKAGE_UNSUPPORTED' });
export const require = (condition, message) => { if (!condition) throw bad(message); };
export const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const dangerous = key => ['__proto__', 'constructor', 'prototype'].includes(key);
export const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const DATA_SCHEMA = 'thro-workspace-state@1';
export const EDIT_PROFILE = 'thro-prepared-workspace@1';
export const LEGACY_V1_PROFILE = 'thro-delivered-workspace-v1@1';
export const capabilities = Object.freeze(['parts-archive@1', 'prepared-disc@1', 'versioned-bags@1', 'studio-single-svg@1', 'studio-lineup-svg@1', 'discstudio-card-png@1', 'export-record@1']);
export const calculationNames = new Set(`fn.addReference fn.addToShelf fn.createBag fn.find fn.paintRecipe fn.read fn.renderDepiction fn.renderPainting fn.selectPainting fn.shelfQuery fn.shelfRows fn.tick oc.create oc.destroy oc.update fn.studio.canvasDesign fn.studio.canvasFields fn.studio.canvasFrame fn.studio.canvasScene fn.studio.capture fn.studio.card fn.studio.cardPreset fn.studio.cardPreview fn.studio.cardTokens fn.studio.compositionDefinition fn.studio.compositionFields fn.studio.compositionLayers fn.studio.cornerMetadata fn.studio.cornerStudy fn.studio.cornerTypography fn.studio.exportRecord fn.studio.frame fn.studio.graphic fn.studio.graphicArt fn.studio.graphicDesign fn.studio.graphicFields fn.studio.layeredCompositionDefinition fn.studio.layeredCompositionPreview fn.studio.layeredCompositionScene fn.studio.moldHeading fn.studio.reorderSelection fn.studio.scene fn.studio.svgDigest fn.studio.unlabelledArt fn.studio.unlabelledCard fn.studio.competitionAppearance fn.studio.competitionCapture fn.studio.competitionDesign fn.studio.competitionDraft fn.studio.competitionEdit fn.studio.competitionFields fn.studio.competitionPreset fn.studio.competitionPresetPanel fn.studio.competitionScene fn.studio.competitionTreatment fn.studio.competitionTreatmentPanel fn.battle.entry fn.battle.standings`.split(' '));
const presets = ['u01', 'u02', 'u03-front', 'u03-behind', 'u04', 'u05', 'b01', 'b02', 'b03', 'b04', 'b05'];
export const supportsCapability = item => capabilities.includes(item) || presets.some(preset => item === `discstudio-recipe@28ac2b39fab85255/${preset}`);
// v1 did not declare its data ABI. Only this verified delivered producer has
// an explicit historical profile mapping; this is not proof of authorship.
export const supportsLegacyProducer = value => value.sourceId === 'efb93ae994ed5316e946302a6cdba1bb64669223ed3a953cbb468226f9da8911'
  && value.artifactId === '865250c1941bc52319e42c03a59501b9ad892c74545de5f4ed84a158be53eef2' && value.nativeRendererBuild === '28ac2b39fab85255';

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

export function identity(value) {
  require(exactKeys(value, ['sourceId', 'artifactId', 'nativeRendererBuild']) && /^[a-f0-9]{64}$/.test(value.sourceId)
    && /^[a-f0-9]{64}$/.test(value.artifactId) && typeof value.nativeRendererBuild === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(value.nativeRendererBuild), 'An explicit producer source, artifact and renderer provenance is required.');
  return value;
}
export async function digestBytes(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export const digest = text => digestBytes(encoder.encode(text));
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
/** Canonical sorted-object JSON over the envelope, excluding raw and integrity. */
export const envelopeDigest = envelope => {
  const { raw: _raw, ...archive } = envelope.archive;
  return digest(canonical({ schema: envelope.schema, version: envelope.version, compatibility: envelope.compatibility, origin: envelope.origin, extensions: envelope.extensions, archive }));
};
export function rawBytes(raw) {
  require(typeof raw === 'string' && raw.length <= MAX_ARCHIVE_BYTES, 'Raw package archive exceeds the 64 MiB limit.');
  const bytes = encoder.encode(raw).byteLength;
  require(bytes <= MAX_ARCHIVE_BYTES, 'Raw package archive exceeds the 64 MiB UTF-8 limit.'); return bytes;
}

