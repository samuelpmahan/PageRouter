import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve, dirname, relative} from 'node:path';

const site = resolve(import.meta.dirname, '../dist');

// The page loads app.mjs; app.mjs registers sw.js by URL. Every relative
// module import reachable from them must name a file the site ships.
test('every relative import in the built site resolves', () => {
  const pending = ['app.mjs', 'sw.js'].map(entry => resolve(site, entry));
  const visited = new Set(), missing = [];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) { missing.push(`${relative(site, file)} (entry)`); continue; }
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), match[1].split(/[?#]/, 1)[0]);
      if (!existsSync(target)) missing.push(`${relative(site, file)} imports ${match[1]}, which the site does not contain`);
      else if (/\.(?:mjs|js)$/.test(target)) pending.push(target);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(visited.size > 1, 'the app must import at least one module');
});
