export const fixtureId = 'thro-prepared-samples-v1';

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
    if (!/^assets\/discs\/[a-z0-9-]+\.webp$/.test(disc.file) || !/^[a-f0-9]{64}$/.test(disc.sha256) || !/^[a-z0-9-]+$/.test(disc.mold)) throw Error('Invalid prepared sample identity.');
    const image = await fetcher(new URL(disc.file, base));
    if (!image.ok) throw Error(`Prepared sample unavailable (${image.status}).`);
    const bytes = new Uint8Array(await image.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== disc.sha256) throw Error(`Prepared sample bytes changed: ${disc.name}.`);
    return Object.freeze({ ...disc, depiction: Object.freeze({ kind: 'photo', src: asDataUrl(bytes), name: disc.name }) });
  }));
}
