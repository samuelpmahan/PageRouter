#!/usr/bin/env node
// Hardening suite for the crisp packager. Runs the CLI against fresh copies of
// the fixtures in a temp dir (packaging writes .crisp/ into the app dir, so
// fixtures are never touched in place).
//
// Model under test (Sam's design):
// - tidy is the registry; crisp builds whatever tidy's manifest points at.
// - exp manifests are pointers at working folders; content hashes exist only
//   when frozen, recorded by tidy at promotion. crisp never freezes.
// - crisp generates the fresh folder on `neat add`, so it knows exactly how
//   to compile it. The receipt is a wiring manifest of content-addressed
//   output chunks; `verify` checks the artifact, not the source tree.
//
// usage: node test/run.mjs            (run from anywhere; paths are file-relative)
// exit: 0 when every case passes, 1 otherwise.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRISP = join(ROOT, 'bin', 'crisp');
const FIXTURES = join(ROOT, 'fixtures');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    process.stdout.write(`ok   ${name}\n`);
  } else {
    failed++;
    failures.push(name);
    process.stdout.write(`FAIL ${name}${detail ? ` :: ${detail}` : ''}\n`);
  }
}

function runCrisp(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('node', [CRISP, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function freshFixture(name) {
  const dir = mkdtempSync(join(tmpdir(), 'crisp-test-'));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'crisp-test-'));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// 1. scaffold generates the canonical folder crisp knows how to compile
{
  const parent = freshDir();
  const dir = join(parent, 'brand-new');
  const r = await runCrisp(['scaffold', dir, '--title', 'Brand New', '--mounts', 'shelf', '--source', 'exp/brand-new'], parent);
  check('scaffold/exit 0', r.code === 0, `exit ${r.code}: ${r.stderr}`);
  check('scaffold/writes experience.json', existsSync(join(dir, 'experience.json')));
  check('scaffold/writes src/index.html', existsSync(join(dir, 'src', 'index.html')));
  check('scaffold/writes build.mjs', existsSync(join(dir, 'build.mjs')));
  const manifest = readJson(join(dir, 'experience.json'));
  check('scaffold/manifest has title and mounts', manifest.title === 'Brand New' && manifest.mounts.includes('shelf'));
  check('scaffold/manifest records tidy pointer', manifest.source === 'exp/brand-new');
  check('scaffold/manifest has build contract', manifest.entry === 'src/index.html' && manifest.build === 'node build.mjs' && manifest.outDir === 'dist');
}

// 2. scaffold refuses a non-empty directory
{
  const dir = freshDir();
  writeFileSync(join(dir, 'something.txt'), 'hands off');
  const r = await runCrisp(['scaffold', dir], dir);
  check('scaffold/refuses non-empty dir', r.code === 1, `exit ${r.code}: ${r.stderr}`);
  check('scaffold/stderr says refusing', /refusing to overwrite/.test(r.stderr), r.stderr.trim());
}

// 3. crisp compiles exactly what it scaffolded
{
  const parent = freshDir();
  const dir = join(parent, 'woven');
  const s = await runCrisp(['scaffold', dir, '--title', 'Woven', '--mounts', 'shelf'], parent);
  check('scaffold+package/scaffold exit 0', s.code === 0, s.stderr);
  const r = await runCrisp(['package', dir], dir);
  check('scaffold+package/package exit 0', r.code === 0, `exit ${r.code}: ${r.stderr}`);
}

// 4. happy path: package the hello fixture, receipt is a wiring manifest
{
  const dir = freshFixture('hello');
  const manifestBefore = readFileSync(join(dir, 'experience.json'), 'utf8');
  const r = await runCrisp(['package', dir], dir);
  check('hello/package exit 0', r.code === 0, `exit ${r.code}: ${r.stderr}`);
  const receiptPath = join(dir, '.crisp', 'receipt.json');
  check('hello/receipt written', existsSync(receiptPath));
  check('hello/snapshot written', existsSync(join(dir, '.crisp', 'manifest.snapshot.json')));
  if (existsSync(receiptPath)) {
    const receipt = readJson(receiptPath);
    check('hello/receipt app title', receipt.app === 'Hello Shelf', receipt.app);
    check('hello/receipt has content-addressed chunks',
      Array.isArray(receipt.chunks) && receipt.chunks.length > 0 &&
      receipt.chunks.every((c) => /^[0-9a-f]{64}$/.test(c.sha256 || '')));
    check('hello/receipt wires entry chunk', /^[0-9a-f]{64}$/.test(receipt.entryChunk || ''));
    check('hello/receipt usedMounts has shelf', (receipt.usedMounts || []).includes('shelf'));
    check('hello/receipt validation clean',
      (receipt.validation.undeclaredMounts || []).length === 0 &&
      (receipt.validation.persistedPrefixViolations || []).length === 0);
    // independently re-hash the built chunks: the receipt must match the bytes
    const distDir = join(dir, 'dist');
    const rematch = receipt.chunks.every((c) => sha256File(join(distDir, c.path)) === c.sha256);
    check('hello/chunk hashes match built bytes', rematch);
    const entryChunk = receipt.chunks.find((c) => c.path === receipt.entry)
      ?? receipt.chunks.find((c) => c.path === (receipt.entry || '').replace(/^src\//, ''));
    check('hello/entry chunk wires to entry path', !!entryChunk && entryChunk.sha256 === receipt.entryChunk);
  }
  // crisp never freezes: packaging must not record hashes into the manifest
  const manifestAfter = readFileSync(join(dir, 'experience.json'), 'utf8');
  check('hello/manifest untouched by package (no freeze)', manifestAfter === manifestBefore);
  check('hello/manifest carries no chunk hashes', !/sha256/.test(manifestAfter));
}

// 5. verify: the honest check runs against the artifact
{
  const dir = freshFixture('hello');
  const p = await runCrisp(['package', dir], dir);
  check('verify/package exit 0', p.code === 0, p.stderr);
  const receiptPath = join(dir, '.crisp', 'receipt.json');
  const v = await runCrisp(['verify', receiptPath, join(dir, 'dist')], dir);
  check('verify/clean chunks exit 0', v.code === 0, `exit ${v.code}: ${v.stderr}`);
  check('verify/reports chunk count', /chunks match/.test(v.stdout), v.stdout.trim());
  appendFileSync(join(dir, 'dist', readJson(receiptPath).chunks[0].path), '\n<!-- tampered -->\n');
  const t = await runCrisp(['verify', receiptPath, join(dir, 'dist')], dir);
  check('verify/tampered chunk exit 1', t.code === 1, `exit ${t.code}: ${t.stderr}`);
  const tamperedPath = readJson(receiptPath).chunks[0].path;
  check('verify/names the bad chunk', new RegExp(tamperedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t.stderr), t.stderr.trim());
}

// 6. check command on a clean fixture
{
  const dir = freshFixture('hello');
  const r = await runCrisp(['check', dir], dir);
  check('hello/check exit 0', r.code === 0, `exit ${r.code}: ${r.stderr}`);
  check('hello/check reports mounts', /ok: mounts \[shelf\]/.test(r.stdout), r.stdout.trim());
}

// 7. failing build -> exit 2
{
  const dir = freshFixture('broken');
  const r = await runCrisp(['package', dir], dir);
  check('broken/package exit 2', r.code === 2, `exit ${r.code}: ${r.stderr}`);
  check('broken/stderr names build failure', /crisp: build: build failed/.test(r.stderr), r.stderr.trim());
}

// 8. undeclared mount use -> exit 1, names mount and file:line
{
  const dir = freshFixture('sneaky');
  const r = await runCrisp(['package', dir], dir);
  check('sneaky/package exit 1', r.code === 1, `exit ${r.code}: ${r.stderr}`);
  check('sneaky/stderr names undeclared mount', /undeclared mount "billing"/.test(r.stderr), r.stderr.trim());
  check('sneaky/stderr names file and line', /src\/app\.js:4/.test(r.stderr), r.stderr.trim());
}

// 9. persisted mount prefix in a stored address -> exit 1
{
  const dir = freshFixture('leaky');
  const r = await runCrisp(['package', dir], dir);
  check('leaky/package exit 1', r.code === 1, `exit ${r.code}: ${r.stderr}`);
  check('leaky/stderr names persisted prefix', /persisted address keeps mount prefix "shelf\.px\.discs"/.test(r.stderr), r.stderr.trim());
}

// 10. unknown mount/world against a foreign PxC -> exit 1
{
  const dir = freshFixture('unknown-world');
  const altPxc = join(dir, 'alt-pxc.mjs');
  writeFileSync(altPxc, 'export function hasWorld() { return false; }\nexport function listWorlds() { return []; }\n');
  const r = await runCrisp(['package', dir, '--pxc', altPxc], dir);
  check('unknown-world/package exit 1', r.code === 1, `exit ${r.code}: ${r.stderr}`);
  check('unknown-world/stderr names unknown mount', /unknown mount\/world "shelf"/.test(r.stderr), r.stderr.trim());
}

// 11. repackaging after source edits is a new version, not drift
{
  const dir = freshFixture('hello');
  const first = await runCrisp(['package', dir], dir);
  check('repack/first package exit 0', first.code === 0, first.stderr);
  const firstReceipt = readJson(join(dir, '.crisp', 'receipt.json'));
  appendFileSync(join(dir, 'src', 'index.html'), '\n<!-- second version -->\n');
  const second = await runCrisp(['package', dir], dir);
  check('repack/second package exit 0 (no drift gate)', second.code === 0, `exit ${second.code}: ${second.stderr}`);
  const secondReceipt = readJson(join(dir, '.crisp', 'receipt.json'));
  check('repack/edited chunk gets a new hash',
    !!firstReceipt.entryChunk && !!secondReceipt.entryChunk &&
    firstReceipt.entryChunk !== secondReceipt.entryChunk);
}

// 12. Kustomize-style composition: base + patches resolve, package, and record
{
  const dir = freshFixture('compose');
  const overlay = join(dir, 'overlay');
  const r = await runCrisp(['resolve', overlay], overlay);
  check('compose/resolve exit 0', r.code === 0, `exit ${r.code}: ${r.stderr}`);
  const manifest = JSON.parse(r.stdout);
  check('compose/overlay title wins', manifest.title === 'Overlay Game', manifest.title);
  check('compose/inherits base entry and mounts',
    manifest.entry === 'index.html' && Array.isArray(manifest.mounts) && manifest.mounts.length === 0,
    JSON.stringify({ entry: manifest.entry, mounts: manifest.mounts }));
  check('compose/patch applied (sandbox, version)',
    JSON.stringify(manifest.sandbox) === JSON.stringify(['allow-scripts', 'allow-same-origin']) && manifest.version === '0.2.0',
    JSON.stringify({ sandbox: manifest.sandbox, version: manifest.version }));
  check('compose/resolved manifest records composition',
    manifest.composition?.base === 'base' && manifest.composition.patches.length === 1,
    JSON.stringify(manifest.composition));
  check('compose/base and patches are directives, not manifest fields',
    manifest.base === undefined && manifest.patches === undefined);

  const p = await runCrisp(['package', overlay], overlay);
  check('compose/package exit 0', p.code === 0, `exit ${p.code}: ${p.stderr}`);
  const receipt = readJson(join(overlay, '.crisp', 'receipt.json'));
  const paths = (receipt.chunks || []).map((c) => c.path).sort();
  check('compose/chunks are the base+overlay union',
    JSON.stringify(paths) === JSON.stringify(['index.html', 'rom.js', 'shell.js']), paths.join(','));
  check('compose/overlay wins path conflicts',
    readFileSync(join(overlay, 'dist', 'shell.js'), 'utf8').includes('shadows the base shell'),
    readFileSync(join(overlay, 'dist', 'shell.js'), 'utf8').trim());
  check('compose/receipt records the composition',
    receipt.composition?.base === 'base' &&
    (receipt.composition.baseChunks || []).length === 2 &&
    (receipt.composition.overridden || []).includes('shell.js'),
    JSON.stringify(receipt.composition));
  const rematch = (receipt.chunks || []).every((c) => sha256File(join(overlay, 'dist', c.path)) === c.sha256);
  check('compose/chunk hashes match built bytes', rematch);
}

// 13. base cycles are refused, not looped
// A typed overlay resolves the Tidy type after composition, retaining both
// base provenance and its own registry identity through packaging.
{
  const repo = freshDir();
  const experiences = join(repo, 'experiences');
  const base = join(experiences, 'base');
  const overlay = join(experiences, 'overlay');
  mkdirSync(join(repo, '.tidy'), { recursive: true });
  mkdirSync(base, { recursive: true });
  mkdirSync(overlay, { recursive: true });
  const definition = (id, version, build, extra = {}) => ({
    root: `experiences/${id}`, version,
    experience: { title: id, entry: 'index.html', mounts: [], build, outDir: 'dist', ...extra },
  });
  writeFileSync(join(repo, '.tidy', 'manifest.json'), JSON.stringify({ schemaVersion: 1, types: {
    'typed-base': definition('base', '0.1.0', 'mkdir -p dist && cp index.html dist/', { demo: { common: 'base', side: 'base' } }),
    'typed-overlay': definition('overlay', '0.2.0', 'mkdir -p dist && cp index.html dist/', { title: 'Typed overlay', demo: { side: 'overlay' } }),
    'wrong-root': definition('base', '0.3.0', 'mkdir -p dist && cp index.html dist/'),
  } }));
  writeFileSync(join(base, 'experience.json'), JSON.stringify({ tidy: { type: 'typed-base' } }));
  writeFileSync(join(base, 'index.html'), '<h1>base</h1>');
  writeFileSync(join(overlay, 'index.html'), '<h1>overlay</h1>');
  const writeOverlay = value => writeFileSync(join(overlay, 'experience.json'), JSON.stringify(value));
  writeOverlay({ tidy: { type: 'typed-overlay' }, base: 'base', patches: [{ demo: { checked: true } }] });

  const r = await runCrisp(['resolve', overlay], repo);
  check('typed-compose/resolve succeeds', r.code === 0, r.stderr);
  const resolved = JSON.parse(r.stdout);
  check('typed-compose/merge and patch preserve fields',
    resolved.demo.common === 'base' && resolved.demo.side === 'overlay' && resolved.demo.checked === true,
    JSON.stringify(resolved.demo));
  check('typed-compose/identity and provenance',
    resolved.id === 'overlay' && resolved.version === '0.2.0' &&
    resolved.manifestSource.type === 'typed-overlay' &&
    resolved.composition.baseManifestSource.type === 'typed-base' &&
    resolved.composition.resolvedType === 'typed-overlay', JSON.stringify(resolved));
  const packaged = await runCrisp(['package', overlay], repo);
  check('typed-compose/package succeeds', packaged.code === 0, packaged.stderr);
  const receipt = readJson(join(overlay, '.crisp', 'receipt.json'));
  check('typed-compose/receipt retains resolved type and base',
    receipt.manifestSource.type === 'typed-overlay' &&
    receipt.composition.resolvedVersion === '0.2.0' &&
    receipt.composition.baseManifestSource.type === 'typed-base' &&
    receipt.composition.baseChunks.length === 1, JSON.stringify(receipt.composition));

  for (const [name, input, message] of [
    ['version patch', { tidy: { type: 'typed-overlay' }, base: 'base', patches: [{ version: '9.0.0' }] }, /typed patches cannot change/],
    ['identity patch', { tidy: { type: 'typed-overlay' }, base: 'base', patches: [{ id: 'base' }] }, /typed patches cannot change/],
    ['source patch', { tidy: { type: 'typed-overlay' }, base: 'base', patches: [{ manifestSource: { type: 'typed-base' } }] }, /typed patches cannot change/],
    ['wrong root', { tidy: { type: 'wrong-root' }, base: 'base' }, /tidy root differs/],
    ['patch without base', { tidy: { type: 'typed-overlay' }, patches: [{ title: 'Delta' }] }, /requires a base/],
    ['cycle', { tidy: { type: 'typed-overlay' }, base: 'overlay' }, /base cycle/],
  ]) {
    writeOverlay(input);
    const rejected = await runCrisp(['resolve', overlay], repo);
    check(`typed-compose/reject ${name}`, rejected.code === 1 && message.test(rejected.stderr), rejected.stderr);
  }
  writeOverlay({ tidy: { type: 'typed-overlay' } });
  const plain = await runCrisp(['resolve', overlay], repo);
  check('typed-compose/typed-only remains supported', plain.code === 0 && JSON.parse(plain.stdout).composition === undefined, plain.stderr);
}

// 13. base cycles are refused, not looped
{
  const dir = freshDir();
  for (const [name, base] of [['a', 'b'], ['b', 'a']]) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'experience.json'), JSON.stringify({
      title: name, base, build: 'mkdir -p dist && touch dist/x', outDir: 'dist', mounts: [],
    }));
  }
  const r = await runCrisp(['resolve', join(dir, 'a')], dir);
  check('compose-cycle/resolve exit 1', r.code === 1, `exit ${r.code}: ${r.stderr}`);
  check('compose-cycle/stderr names the cycle', /cycle/.test(r.stderr), r.stderr.trim());
}

// 14. a missing base is refused with its name
{
  const dir = freshDir();
  mkdirSync(join(dir, 'lonely'), { recursive: true });
  writeFileSync(join(dir, 'lonely', 'experience.json'), JSON.stringify({
    title: 'Lonely', base: 'nope', build: 'mkdir -p dist && touch dist/x', outDir: 'dist', mounts: [],
  }));
  const r = await runCrisp(['resolve', join(dir, 'lonely')], dir);
  check('compose-missing/resolve exit 1', r.code === 1, `exit ${r.code}: ${r.stderr}`);
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stdout.write(`failed: ${failures.join(', ')}\n`);
  process.exit(1);
}
