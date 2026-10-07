import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

function sortedStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(sortedStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function walkFiles(dir, root, excludeDirs, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name) || entry.name === 'node_modules') continue;
      await walkFiles(join(dir, entry.name), root, excludeDirs, out);
    } else if (entry.isFile()) {
      const rel = relative(root, join(dir, entry.name)).split(sep).join('/');
      out.push(rel);
    }
  }
  return out;
}

// Hashes the source tree of an app. experience.json is special-cased: the
// recorded sourceHash itself must not change the hash, so it is hashed from
// its parsed form with the sourceHash key deleted and keys sorted.
export async function hashSources(appDir, excludeDirs = []) {
  const hash = createHash('sha256');
  const rels = await walkFiles(appDir, appDir, excludeDirs, []);
  rels.sort();
  for (const rel of rels) {
    const abs = join(appDir, rel);
    if (rel === 'experience.json') {
      const parsed = JSON.parse(await readFile(abs, 'utf8'));
      delete parsed.sourceHash;
      hash.update(`experience.json\0${sortedStringify(parsed)}`, 'utf8');
    } else {
      const bytes = await readFile(abs);
      hash.update(`${rel}\0`, 'utf8');
      hash.update(bytes);
    }
  }
  return hash.digest('hex');
}
