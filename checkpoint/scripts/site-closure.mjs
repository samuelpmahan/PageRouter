// Which src/ files the site ships as-is, derived from what the site loads
// instead of a hand-kept list. A module added to src/ and imported by the app
// ships automatically; one nothing loads does not ship.
import fs from 'node:fs';
import path from 'node:path';

// Relative references in HTML (src=, href=) and in modules (static import,
// re-export, dynamic import with a string literal).
const HTML_REF = /\b(?:src|href)\s*=\s*["'](\.?\.?\/?[^"':#?]+)["']/g;
const MODULE_REF = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/g;

export function siteSourceClosure(srcDir, { entries, rewritten = [] }) {
  const root = path.resolve(srcDir);
  const reached = new Set(), pending = [...entries];
  while (pending.length) {
    const rel = pending.pop();
    if (reached.has(rel)) continue;
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) throw Error(`Site entry or import missing from src/: ${rel}`);
    reached.add(rel);
    if (!/\.(?:html|mjs|js)$/.test(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(rel.endsWith('.html') ? HTML_REF : MODULE_REF)) {
      const reference = match[1].split(/[?#]/, 1)[0];
      if (/^[a-z]+:/i.test(reference) || reference.startsWith('/')) continue;
      const target = path.relative(root, path.resolve(path.dirname(file), reference)).split(path.sep).join('/');
      // Paths outside src/, or site paths another assembly step produces
      // (./exp/..., ./vendor/...), are not src/ files to copy.
      if (target.startsWith('../') || !fs.existsSync(path.join(root, target))) continue;
      pending.push(target);
    }
  }
  for (const name of rewritten) {
    if (!reached.has(name)) throw Error(`Rewritten module is no longer loaded by the site: ${name}`);
  }
  const copied = [...reached].filter(name => !rewritten.includes(name)).sort();
  return { copied, rewritten: [...rewritten].sort() };
}
