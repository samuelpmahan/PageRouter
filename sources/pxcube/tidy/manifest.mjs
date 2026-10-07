// Local manifest-provider extension. The pinned tidy CLI stays in vendor/tidy.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const canonical = value => JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

export function provideExperience(repo, type) {
  const source = '.tidy/manifest.json';
  const registry = JSON.parse(fs.readFileSync(path.join(repo, source), 'utf8'));
  if (registry.schemaVersion !== 1 || !registry.types || Array.isArray(registry.types)) throw Error('tidy: unsupported manifest');
  if (!Object.hasOwn(registry.types, type)) throw Error(`tidy: unknown type ${type}`);
  const spec = registry.types[type];
  // This provider targets the existing PxCube app discovery convention.
  if (!/^experiences\/[A-Za-z][A-Za-z0-9_-]*$/.test(spec?.root)) throw Error('tidy: root must be experiences/<id>');
  if (!/^\d+\.\d+\.\d+$/.test(spec.version)) throw Error('tidy: version must be x.y.z');
  if (!spec.experience || typeof spec.experience !== 'object' || Array.isArray(spec.experience)) throw Error(`tidy: ${type} has no experience manifest`);
  const id = spec.root.split('/')[1];
  if (spec.experience.id !== undefined && spec.experience.id !== id) throw Error('tidy: experience id differs from root');
  if (spec.experience.version !== undefined && spec.experience.version !== spec.version) throw Error('tidy: experience version differs from type');
  if (Object.hasOwn(spec.experience, 'tidy')) throw Error('tidy: an experience definition cannot refer to another tidy definition');
  return { source, type, root: spec.root, digest: digest(spec), manifest: { ...spec.experience, id, version: spec.version } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('usage: node tidy/manifest.mjs <type>');
    console.log(JSON.stringify(provideExperience(process.cwd(), process.argv[2]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
