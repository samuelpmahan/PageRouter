import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
export function atlasImplementationIdentity(root) {
  const roots=['exp/atlas/atlas-session.mjs','exp/atlas/cross-language.mjs'];
  const files = {}, seen = new Set(), pending = [...roots];
  while (pending.length) {
    const relative = pending.pop();
    if (seen.has(relative)) continue;
    seen.add(relative);
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(path.resolve(root) + path.sep) || fs.realpathSync(absolute) !== absolute) throw Error('Atlas dependency must stay within source');
    const bytes = fs.readFileSync(absolute), source = bytes.toString('utf8');
    files[relative] = {sha256:sha(bytes), bytes:bytes.length};
    const imports = [...source.matchAll(/\b(?:import|export)\s+(?:[\w{}\s,*]+?\s+from\s+)?['"]([^'"]+)['"]/g)];
    const dynamics = [...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)];
    if ((source.match(/\bimport\s*\(/g) || []).length !== dynamics.length) throw Error('Undeclared Atlas dynamic dependency');
    for (const match of [...imports,...dynamics]) {
      if (!match[1].startsWith('.')) throw Error('Atlas external dependency requires explicit policy');
      pending.push(path.relative(root,path.resolve(path.dirname(absolute),match[1])).split(path.sep).join('/'));
    }
  }
  const record = {schema:'atlas-implementation-closure@1', roots, files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))};
  return {...record, digest:sha(JSON.stringify(record))};
}
