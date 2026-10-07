import { readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { provideExperience } from '../../tidy/manifest.mjs';
import { resolveTypedOverlay } from '../../kompoze/typed-overlay.mjs';

export async function loadManifest(appDir, { providerRoot } = {}) {
  return resolveManifest(appDir, { providerRoot, seen: [] });
}

// Kustomize-style composition, borrowed deliberately and named:
// an experience.json may declare `base` (another experience directory whose
// resolved manifest this one inherits) and `patches` (RFC 7386 JSON merge
// patches applied over the merged manifest, in order). Like Kustomize there
// is no templating: the overlay's own keys win over the base's, objects merge
// recursively, arrays and scalars replace, and a patch value of null deletes
// the key. The resolved manifest records `composition: { base, patches }` so
// the receipt and the launcher accordion show exactly what composed.
async function resolveManifest(appDir, { providerRoot, seen }) {
  const path = join(appDir, 'experience.json');
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`manifest: cannot read ${path}: ${err.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`manifest: ${path} is not valid JSON: ${err.message}`);
  }
  if (manifest?.tidy) {
    if (!manifest.tidy || typeof manifest.tidy !== 'object' || Array.isArray(manifest.tidy) ||
        Object.keys(manifest.tidy).length !== 1 || typeof manifest.tidy.type !== 'string' ||
        Object.keys(manifest).some((key) => !['tidy', 'base', 'patches'].includes(key))) {
      throw Error('manifest: a tidy reference may contain only tidy.type, base, and patches');
    }
    const repo = resolve(appDir, '../..');
    const supplied = provideExperience(providerRoot ?? repo, manifest.tidy.type);
    if (relative(repo, resolve(appDir)) !== supplied.root) throw Error('manifest: tidy root differs from app directory');
    if (manifest.base === undefined && manifest.patches === undefined) {
      return { ...supplied.manifest, manifestSource: { path: supplied.source, type: supplied.type, digest: supplied.digest } };
    }
    if (manifest.base === undefined) throw Error('manifest: a typed overlay with patches requires a base');
    const { base, baseId } = await loadBase(appDir, manifest.base, { providerRoot, seen });
    const patches = validatePatches(manifest.patches);
    return resolveTypedOverlay({ supplied, base, baseId, patches, mergePatch });
  }
  const { base, baseId } = await loadBase(appDir, manifest.base, { providerRoot, seen });
  const patches = validatePatches(manifest.patches);
  const { base: _b, patches: _p, ...own } = manifest;
  let resolved = base ? mergePatch(stripComposition(base), own) : { ...own };
  for (const patch of patches) resolved = mergePatch(resolved, patch);
  if (base) resolved.composition = { base: baseId, patches };
  return resolved;
}

async function loadBase(appDir, baseId, { providerRoot, seen }) {
  if (baseId === undefined) return { base: null, baseId: null };
  if (typeof baseId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(baseId)) {
    throw new Error(`manifest: base must be a sibling experience directory name, got ${JSON.stringify(baseId)}`);
  }
  const baseDir = join(appDir, '..', baseId);
  if (baseDir === appDir || seen.includes(baseDir)) {
    throw new Error(`manifest: base cycle detected: ${[...seen, appDir, baseDir].join(' -> ')}`);
  }
  return { base: await resolveManifest(baseDir, { providerRoot, seen: [...seen, appDir] }), baseId };
}

function validatePatches(value) {
  const patches = value ?? [];
  if (!Array.isArray(patches) || patches.some((p) => p === null || typeof p !== 'object' || Array.isArray(p))) {
    throw new Error('manifest: patches must be an array of JSON merge-patch objects');
  }
  return patches;
}

// The base's own composition block describes the base, not the overlay;
// the overlay records its own.
function stripComposition(manifest) {
  const { composition: _c, ...rest } = manifest;
  return rest;
}

// RFC 7386 JSON merge patch: objects merge recursively, arrays and scalars
// replace, null deletes the key.
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
}

const MOUNT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateManifestShape(m) {
  const errors = [];
  if (m === null || typeof m !== 'object' || Array.isArray(m)) {
    return ['manifest must be a JSON object'];
  }
  if (!nonEmptyString(m.title)) {
    errors.push('title must be a non-empty string');
  }
  if (!Array.isArray(m.mounts)) {
    errors.push('mounts must be an array of strings');
  } else {
    for (const mount of m.mounts) {
      if (typeof mount !== 'string' || !MOUNT_NAME_RE.test(mount)) {
        errors.push(`mounts: invalid mount name ${JSON.stringify(mount)} (expected /^[A-Za-z_][A-Za-z0-9_-]*$/)`);
      }
    }
  }
  if (!nonEmptyString(m.build)) {
    errors.push('build must be a non-empty string');
  }
  if (!nonEmptyString(m.outDir)) {
    errors.push('outDir must be a non-empty string');
  }
  return errors;
}
