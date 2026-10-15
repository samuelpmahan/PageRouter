// What atlas-identity.mjs and evaluator-identity.mjs share. Each pins a
// source closure: every file its root modules reach through relative imports,
// with the SHA-256 and length of the file's bytes. The walk and the hash are
// here; each script keeps its own roots, refusal messages, extra rules and
// record digest. Node only (node:fs, node:crypto), so it lives in scripts/.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// SHA-256 as 64 lowercase hex digits. A string is hashed as its UTF-8 bytes.
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// The import specifiers in a module's source, static ones first, then
// dynamic: `import ... from '…'`, `export ... from '…'`, `import '…'`, and
// `import('…')` with a string literal. `followable` is false when the source
// has an `import(` whose target is not a string literal.
export function importSpecifiers(source) {
  const statics = [...source.matchAll(/\b(?:import|export)\s+(?:[\w{}\s,*]+?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m => m[1]);
  const dynamics = [...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
  const followable = (source.match(/\bimport\s*\(/g) || []).length === dynamics.length;
  return {specifiers: [...statics, ...dynamics], followable};
}

// The files reached from `roots` (paths relative to `root`, written with '/')
// through relative imports, as {path: {sha256, bytes}} in the order visited:
// a stack, so depth first, the last import of a module first.
// `refuse` holds the message each refusal throws as Error(message):
//   outsideOrLinked   a file outside root, or a path through a symbolic link
//   dynamicImport     an import( whose target is not a string literal
//   externalImport    a specifier that does not start with '.'
// and two checks made only when their message is given:
//   notRegularFile    a path that is not a regular file (a directory)
//   importLeavesRoot  an import resolving outside root, refused where it is
//                     read instead of by outsideOrLinked when it is visited
export function hashImportClosure(root, roots, refuse) {
  const base = path.resolve(root), files = {}, seen = new Set(), pending = [...roots];
  while (pending.length) {
    const relative = pending.pop();
    if (seen.has(relative)) continue;
    seen.add(relative);
    const absolute = path.resolve(base, relative);
    if (!absolute.startsWith(base + path.sep) || fs.realpathSync(absolute) !== absolute) throw Error(refuse.outsideOrLinked);
    if (refuse.notRegularFile && !fs.statSync(absolute).isFile()) throw Error(refuse.notRegularFile);
    const bytes = fs.readFileSync(absolute);
    files[relative] = {sha256: sha256Hex(bytes), bytes: bytes.length};
    const {specifiers, followable} = importSpecifiers(bytes.toString('utf8'));
    if (!followable) throw Error(refuse.dynamicImport);
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) throw Error(refuse.externalImport);
      const dependency = path.resolve(path.dirname(absolute), specifier);
      if (refuse.importLeavesRoot && !dependency.startsWith(base + path.sep)) throw Error(refuse.importLeavesRoot);
      pending.push(path.relative(base, dependency).split(path.sep).join('/'));
    }
  }
  return files;
}
