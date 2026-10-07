import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const repo = '../..'; // The experience builds with its directory as cwd; the repo root is two levels up.
fs.mkdirSync('dist/local', { recursive: true });
fs.mkdirSync('dist/mock-pxc', { recursive: true });
for (const file of ['index.html','app.mjs','style.css']) fs.copyFileSync(file, `dist/${file}`);
const source = fs.readFileSync('../../mock-pxc/mock-pxc.mjs');
fs.writeFileSync('dist/mock-pxc/mock-pxc.mjs', source);
fs.writeFileSync('dist/seed-identity.mjs', `export default ${JSON.stringify(createHash('sha256').update(source).digest('hex'))};\n`);

// ---- Tests view ----
// The kernel is the testcontainer: its unit tests run in the browser against
// the same seam. Mirror the repo-relative layout under dist/tests so the real test
// files' relative imports keep working, and map the node: specifiers they
// import to the shims above through the import map in index.html. A test file
// is browser-runnable when every import is either a shimmed node: specifier
// or a relative file that exists; anything else stays listed as Node/CI-only.
const TEST_DIR = 'dist/tests';
const SHIMMED = new Set(['node:test', 'node:assert/strict']);
const importSpecifiers = text => {
  const specs = new Set();
  for (const m of text.matchAll(/import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of text.matchAll(/(?:[^.'"\w]|^)import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
  return [...specs];
};
const resolveRelative = (from, spec) => {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return path.posix.extname(joined) ? joined : `${joined}.mjs`;
};
const closureOf = entry => {
  const seen = new Set([entry]), stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    let text;
    try { text = fs.readFileSync(path.join(repo, file), 'utf8'); } catch { return null; }
    for (const spec of importSpecifiers(text)) {
      if (SHIMMED.has(spec)) continue;
      if (!spec.startsWith('.')) return null;
      const resolved = resolveRelative(file, spec);
      if (!seen.has(resolved)) { seen.add(resolved); stack.push(resolved); }
    }
  }
  return seen;
};
const testNamesOf = file => {
  const text = fs.readFileSync(path.join(repo, file), 'utf8');
  const names = [];
  for (const m of text.matchAll(/(?:^|[;{\s])test\(\s*['"`]([^'"`]+)['"`]/g)) names.push(m[1]);
  return names;
};
const testFiles = [];
for (const dir of ['local/test', 'local/test/e2e']) {
  const abs = path.join(repo, dir);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs).sort()) {
    if (name.endsWith('.test.mjs')) testFiles.push(`${dir}/${name}`);
  }
}
const catalog = [], mirrored = new Set();
// app.mjs imports this session seam before any catalog test runs. It is not
// itself a *.test.mjs entrypoint, so mirror its browser-safe import closure
// explicitly rather than shipping a broken dynamic import path.
const seamClosure = closureOf('local/test/test-seam.mjs');
if (!seamClosure) throw Error('The browser test seam import closure is not browser-runnable.');
for (const member of seamClosure) mirrored.add(member);
for (const file of testFiles) {
  const closure = closureOf(file), runnable = closure !== null;
  if (runnable) for (const member of closure) mirrored.add(member);
  catalog.push({ file, tests: testNamesOf(file), runnable, ...(runnable ? {} : { note: 'Runs in Node/CI; it needs node builtins or the assembled site.' }) });
}
for (const member of [...mirrored].sort()) {
  const target = path.join(TEST_DIR, member);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(repo, member), target);
}
fs.mkdirSync(path.join(TEST_DIR, 'shims'), { recursive: true });
for (const shim of ['node-test.mjs', 'node-assert.mjs']) fs.copyFileSync(path.join('shims', shim), path.join(TEST_DIR, 'shims', shim));
fs.writeFileSync(path.join(TEST_DIR, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
