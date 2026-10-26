export const fixtureId = 'thro-prepared-samples-v1';

const flightFields = new Set(['speed', 'glide', 'turn', 'fade']);
const citationKeys = ['sourceKind', 'url', 'verifiedOn'];

export function validateFlightCorrection(disc) {
  const hasOverrides = Object.hasOwn(disc, 'flightOverrides');
  const hasCitation = Object.hasOwn(disc, 'flightCitation');
  if (!hasOverrides && !hasCitation) return null;
  const overrides = disc.flightOverrides, citation = disc.flightCitation;
  if (!hasOverrides || !hasCitation || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)
    || !citation || typeof citation !== 'object' || Array.isArray(citation)) throw Error('Invalid prepared flight correction.');
  const fields = Object.keys(overrides);
  if (!fields.length || fields.some(field => !flightFields.has(field))
    || fields.some(field => !Number.isFinite(overrides[field]))) throw Error('Invalid prepared flight correction.');
  if (Object.keys(citation).length !== citationKeys.length || citationKeys.some(key => !Object.hasOwn(citation, key))
    || citation.sourceKind !== 'manufacturer' || typeof citation.url !== 'string'
    || !/^https:\/\/[a-z0-9.-]+\/[a-z0-9/_-]*\/?$/i.test(citation.url)
    || typeof citation.verifiedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(citation.verifiedOn)
    || Number.isNaN(Date.parse(`${citation.verifiedOn}T00:00:00.000Z`))
    || new Date(`${citation.verifiedOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== citation.verifiedOn) {
    throw Error('Invalid prepared flight correction.');
  }
  return Object.freeze({ flightOverrides: Object.freeze({ ...overrides }), flightCitation: Object.freeze({ ...citation }) });
}

// A cited manufacturer correction belongs to the mold, not to the photo: every disc of that mold gets it, whichever way the disc
// arrived (a prepared sample, or a photo cropped on photos.html). Returns Map(mold id -> { flightOverrides, flightCitation }).
export async function loadFlightCorrections({ fetcher = globalThis.fetch, base = new URL('./', import.meta.url) } = {}) {
  const corrections = new Map();
  const response = await fetcher(new URL('prepared-fixture.json', base));
  if (!response.ok) throw Error(`Prepared sample manifest unavailable (${response.status}).`);
  const manifest = await response.json();
  if (manifest.schema !== 'thro-prepared-fixture@1' || !Array.isArray(manifest.discs)) throw Error('Unknown prepared sample manifest.');
  for (const disc of manifest.discs) {
    const correction = validateFlightCorrection(disc);
    if (correction && /^[a-z0-9-]+$/.test(disc.mold)) corrections.set(disc.mold, correction);
  }
  return corrections;
}

/** The discs with their mold's cited correction attached (a disc that already carries its own keeps it). */
export function withFlightCorrections(discs, corrections) {
  return discs.map(disc => {
    const correction = corrections.get(disc.mold);
    if (!correction || Object.hasOwn(disc, 'flightOverrides')) return disc;
    return Object.freeze({ ...disc, flightOverrides: correction.flightOverrides, flightCitation: correction.flightCitation });
  });
}

function asDataUrl(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:image/webp;base64,${btoa(binary)}`;
}

export async function loadFixture({ fetcher = globalThis.fetch, base = new URL('./', import.meta.url) } = {}) {
  const response = await fetcher(new URL('prepared-fixture.json', base));
  if (!response.ok) throw Error(`Prepared sample manifest unavailable (${response.status}).`);
  const manifest = await response.json();
  if (manifest.schema !== 'thro-prepared-fixture@1' || manifest.fixtureId !== fixtureId || manifest.fixtureOnly !== true || !Array.isArray(manifest.discs) || manifest.discs.length !== 3) throw Error('Unknown prepared sample manifest.');
  return Promise.all(manifest.discs.map(async disc => {
    validateFlightCorrection(disc);
    if (!/^assets\/discs\/[a-z0-9-]+\.webp$/.test(disc.file) || !/^[a-f0-9]{64}$/.test(disc.sha256) || !/^[a-z0-9-]+$/.test(disc.mold)) throw Error('Invalid prepared sample identity.');
    const image = await fetcher(new URL(disc.file, base));
    if (!image.ok) throw Error(`Prepared sample unavailable (${image.status}).`);
    const bytes = new Uint8Array(await image.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== disc.sha256) throw Error(`Prepared sample bytes changed: ${disc.name}.`);
    return Object.freeze({ ...disc, depiction: Object.freeze({ kind: 'photo', src: asDataUrl(bytes), name: disc.name }) });
  }));
}
