#!/usr/bin/env node
// One packaging path for local preview and CI. neat tracks; tidy registers;
// Muse's crisp implementation executes each build. Attempts retain their files.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { hashAppSources } from '../crisp/lib/packager.mjs';
import { loadManifest } from '../crisp/lib/manifest.mjs';
import { validateWorkItem } from '../vendor/neat/dist/work-items.js';
import { resolveTargets, workingTreeChanges } from './affected-targets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');
process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { const bytes = JSON.stringify(value, null, 2) + '\n'; if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === bytes) return; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const idOK = id => /^[A-Za-z0-9_-]+$/.test(id);
function command(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stderr ?? 'Tool failed');
  return result.stdout;
}
function copyTree(source, target, excluded = []) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source).sort()) {
    if (['.git', 'node_modules', '.crisp', ...excluded].includes(name)) continue;
    const from = path.join(source, name), to = path.join(target, name), stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw Error(`Source symlink needs an explicit packaging policy: ${from}`);
    if (stat.isDirectory()) copyTree(from, to, excluded);
    else if (stat.isFile()) fs.copyFileSync(from, to);
  }
}
function hashes(directory) {
  const entries = {};
  const walk = dir => { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name), stat = fs.lstatSync(file); if (stat.isDirectory()) walk(file); else if (stat.isFile()) entries[path.relative(directory, file)] = sha(fs.readFileSync(file)); } };
  walk(directory); return entries;
}
function apps(repo) { return fs.readdirSync(path.join(repo, 'experiences'), { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(repo, 'experiences', e.name, 'experience.json'))).map(e => e.name).sort(); }

// Matrix jobs have already run crisp. Assemble their testified bytes without
// rerunning a build or treating a missing artifact as a successful package.
async function importPackage(staged, destination, manifest, verifyReceipt) {
  const receiptPath = path.join(staged, 'receipt.json');
  if (!fs.existsSync(receiptPath)) throw Error('No package receipt supplied by the build job.');
  const receipt = read(receiptPath);
  if (receipt.build?.exitCode !== 0 || receipt.build?.timedOut || !Array.isArray(receipt.chunks) || !receipt.chunks.length) throw Error('Package receipt does not testify to a successful build with chunks.');
  const seen = new Set();
  for (const chunk of receipt.chunks) {
    if (typeof chunk.path !== 'string' || path.isAbsolute(chunk.path) || chunk.path.split(/[\\/]/).some(p => !p || p === '..' || p === '.') || seen.has(chunk.path)) throw Error('Invalid or duplicate package chunk path.');
    if (['receipt.json', 'pxcube-receipt.json'].includes(chunk.path)) throw Error('Package chunk uses a reserved receipt filename.');
    seen.add(chunk.path);
  }
  const verified = await verifyReceipt(receiptPath, staged);
  if (!verified.ok) throw Error(`Package chunks failed receipt verification: ${JSON.stringify(verified.mismatches)}`);
  if (!receipt.entryChunk || !receipt.chunks.some(c => c.path === 'index.html' && c.sha256 === receipt.entryChunk)) throw Error('Package receipt does not wire index.html to its entry chunk.');
  for (const chunk of receipt.chunks) {
    const output = path.join(destination, manifest.outDir, chunk.path);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(staged, chunk.path), output);
  }
  write(path.join(destination, '.crisp/receipt.json'), receipt);
  return receipt;
}

export async function build(repo = root, { refreshRegistry = false, stagedRoot = null } = {}) {
  const state = path.join(repo, '.pxcube'); fs.mkdirSync(state, { recursive: true });
  const lock = path.join(state, 'build.lock'); const fd = fs.openSync(lock, 'wx');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const run = path.join(state, 'runs', runId), work = path.join(run, 'work'), assembly = path.join(run, 'assembly');
  try {
    fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(path.join(assembly, 'experiences'), { recursive: true });
    for (const folder of ['crisp', 'kompoze', 'tidy', 'mock-pxc', 'launcher', 'local', 'vendor']) copyTree(path.join(repo, folder), path.join(work, folder));
    const toolsHash = hashes(work);
    const sharedToolsHash = sha(JSON.stringify(toolsHash));
    // Builds consume the same retained manifest snapshot as their source.
    if (fs.existsSync(path.join(repo, '.tidy'))) copyTree(path.join(repo, '.tidy'), path.join(work, '.tidy'));
    const { packageApp } = await import(pathToFileURL(path.join(work, 'crisp/lib/packager.mjs')).href);
    const { verifyReceipt } = await import(pathToFileURL(path.join(work, 'crisp/lib/verifier.mjs')).href);
    const registryPath = path.join(repo, '.tidy/pxcube.json');
    const registry = fs.existsSync(registryPath) ? read(registryPath) : { schemaVersion: 1, apps: {} };
    if (registry.schemaVersion !== 1 || !registry.apps || Array.isArray(registry.apps)) throw Error('Unsupported tidy app registry.');
    const lineagePath = path.join(repo, '.tidy/manifest.json');
    const lineage = fs.existsSync(lineagePath) ? read(lineagePath) : { schemaVersion: 1, types: {} };
    // Package outputs are immutable for this input key. The target resolver
    // is also used by Pages CI, so a local rebuild and an Actions rebuild
    // agree on what can be restored versus what must compile again.
    const targets = await resolveTargets(repo);
    const targetById = new Map(targets.map(target => [target.id, target]));
    // HEAD is useful provenance, but never the build input. A neat iteration
    // is allowed to be dirty: the package keys below name the exact current
    // working-tree bytes that crisp receives.
    const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout?.trim() || null;
    const sourceSnapshot = {
      schemaVersion: 1,
      baseCommit: sourceCommit,
      transport: process.env.GITHUB_SHA
        ? { kind: 'git-commit', commit: process.env.GITHUB_SHA }
        : { kind: 'working-tree', commit: null },
      dirtyFiles: workingTreeChanges(repo) ?? [],
      packageKeys: Object.fromEntries(targets.map(target => [target.id, target.packageKey])),
    };
    sourceSnapshot.digest = sha(JSON.stringify(sourceSnapshot));
    const packageCache = path.join(state, 'package-cache');
    const results = [];
    for (const id of apps(repo)) {
      if (!idOK(id)) throw Error(`Unsupported app directory: ${id}`);
      const source = path.join(repo, 'experiences', id), destination = path.join(work, 'experiences', id);
      let manifest, sourceHash, registration, drift = false;
      const itemPath = path.join(repo, '.neat/items', `PXCUBE-${id}.json`);
      if (!fs.existsSync(itemPath)) write(itemPath, { schemaVersion: 1, id: `PXCUBE-${id}`, outcome: `Run and inspect ${id} through the shared PxCube packaging program.`, location: { component: `experiences/${id}` }, target: { kind: 'pcr', identity: `pcr.pxcube.${id}` }, requirements: [{ id: 'package', text: 'Current source packages and supplies a usable index.html.' }, { id: 'review', text: 'The mounted Experience is inspected by its human reviewer.' }], dependencies: [], status: 'active', blockers: [], checkpoints: [], acceptanceRefs: [], promotionRefs: [], resume: 'Inspect the retained local packaging attempts; do not equate a build with human acceptance.' });
      const problems = validateWorkItem(read(itemPath)); if (problems.length) throw Error(problems.join('; '));
      try {
        manifest = await loadManifest(source, { providerRoot: work });
        if (manifest.id !== undefined && manifest.id !== id) throw Error('Manifest id differs from its app directory.');
        if (typeof manifest.outDir !== 'string' || !/^[A-Za-z0-9_-]+$/.test(manifest.outDir)) throw Error('This local adapter requires a single top-level outDir name; nested output paths need a crisp hashing fix.');
        // Use a fresh source snapshot, so an old dist cannot masquerade as a new build.
        copyTree(source, destination, [manifest.outDir.split('/')[0]]);
        // A composed cartridge packages its base from the same work snapshot,
        // never from a half-built sibling. The base lands here before the
        // overlay's own build runs, so packageApp finds it beside the overlay.
        if (manifest.composition?.base) {
          const baseId = manifest.composition.base;
          if (!idOK(baseId)) throw Error(`Unsupported base directory: ${baseId}`);
          const baseSource = path.join(repo, 'experiences', baseId);
          const baseManifest = await loadManifest(baseSource, { providerRoot: work });
          const baseDest = path.join(work, 'experiences', baseId);
          if (!fs.existsSync(baseDest)) copyTree(baseSource, baseDest, [baseManifest.outDir.split('/')[0]]);
        }
        sourceHash = await hashAppSources(destination, manifest);
        registration = registry.apps[id];
        if (!registration || refreshRegistry) {
          registration = { track: 'exp', manifest, sourceHash, sharedToolsHash, registeredAt: new Date().toISOString() };
          registry.apps[id] = registration;
        }
        if (!['exp', 'clean'].includes(registration.track)) throw Error('Invalid tidy registration track.');
        drift = registration.sourceHash !== sourceHash || registration.sharedToolsHash !== sharedToolsHash;
        // Inferred entries describe this run, not an authored manifest edit.
        // Keeping them in memory prevents a build from mutating an input that
        // participates in the next subcommit package key.
        lineage.types[`pxcube-${id}`] ??= { version: /^\d+\.\d+\.\d+$/.test(manifest.version ?? '') ? manifest.version : '0.0.0', root: `experiences/${id}`, clean: 'clean', experiments: 'exp', tests: [] };
        const target = targetById.get(id);
        const cacheDir = target ? path.join(packageCache, target.packageKey, id) : null;
        let cache = 'miss';
        let receipt;
        if (stagedRoot) {
          receipt = await importPackage(path.join(stagedRoot, `exp-${id}`), destination, manifest, verifyReceipt);
          cache = 'staged';
        } else if (cacheDir && fs.existsSync(path.join(cacheDir, manifest.outDir)) && fs.existsSync(path.join(cacheDir, '.crisp/receipt.json'))) {
          copyTree(path.join(cacheDir, manifest.outDir), path.join(destination, manifest.outDir));
          copyTree(path.join(cacheDir, '.crisp'), path.join(destination, '.crisp'));
          const cachedReceipt = read(path.join(destination, '.crisp/receipt.json'));
          const verified = await verifyReceipt(path.join(destination, '.crisp/receipt.json'), path.join(destination, manifest.outDir));
          if (!verified.ok) throw Error(`Local package cache failed receipt verification: ${JSON.stringify(verified.mismatches)}`);
          receipt = cachedReceipt;
          cache = 'hit';
        } else {
          receipt = await packageApp(destination);
          if (cacheDir) {
            copyTree(path.join(destination, manifest.outDir), path.join(cacheDir, manifest.outDir));
            copyTree(path.join(destination, '.crisp'), path.join(cacheDir, '.crisp'));
          }
        }
        const index = path.join(destination, manifest.outDir, 'index.html');
        if (!fs.existsSync(index) || !fs.statSync(index).isFile()) throw Error('A Page needs index.html; crisp output enumeration alone is insufficient.');
        if (await hashAppSources(destination, await loadManifest(destination)) !== sourceHash) throw Error('Build changed its recorded source; inspect this attempt.');
        const stage = path.join(assembly, 'staging', `exp-${id}`);
        copyTree(path.join(destination, manifest.outDir), stage);
        const outputHashes = hashes(stage);
        write(path.join(stage, 'receipt.json'), receipt);
        // Retain the existing extended receipt URL for current consumers.
        write(path.join(stage, 'pxcube-receipt.json'), { ...receipt, runId, sharedToolsHash, outputHashes, tidy: { track: registration.track, changedSinceRegistration: drift } });
        // Cache status is intentionally not part of the shipped NTC state:
        // assembly from verified CI artifacts must remain byte-for-byte
        // equivalent to assembly from a local cache miss.
        results.push({ id, ok: true, sourceHash, outputHashes, build: receipt.build, receipt: `experiences/${id}/receipt.json`, drift });
      } catch (error) {
        results.push({ id, ok: false, sourceHash: sourceHash ?? null, error: String(error), drift });
        fs.mkdirSync(destination, { recursive: true }); write(path.join(destination, 'failure.json'), results.at(-1));
      }
      const result = results.at(-1);
      write(path.join(assembly, 'experiences', id, 'experience.json'), { ...(manifest ?? {}), id, title: manifest?.title ?? id, track: registration?.track === 'clean' && !drift ? 'clean' : 'exp', registry: { registeredSourceHash: registration?.sourceHash ?? null, currentSourceHash: sourceHash ?? null, changedSinceRegistration: drift }, attempt: { runId, ok: result.ok, error: result.error ?? null, receipt: result.ok ? result.receipt : null } });
    }
    write(registryPath, registry);
    // Fresh scaffolds need an initial authored manifest. Once present, local
    // packaging never rewrites it: inferred run entries stay in memory.
    if (!fs.existsSync(lineagePath)) write(lineagePath, lineage);
    const ledger = path.join(run, 'ledger');
    for (const folder of ['.neat', '.tidy']) copyTree(path.join(repo, folder), path.join(ledger, folder));
    const neat = command([path.join(work, 'vendor/neat/dist/cli.js'), 'check', '--root', ledger], ledger);
    const tidy = command([path.join(work, 'vendor/tidy/tidy'), 'check'], ledger);
    fs.writeFileSync(path.join(run, 'neat-check.log'), neat); fs.writeFileSync(path.join(run, 'tidy-check.log'), tidy);
    write(path.join(assembly, 'ntc-state.json'), {
      schemaVersion: 1, runId, sourceCommit, sourceSnapshot, sharedToolsHash,
      work: fs.readdirSync(path.join(ledger, '.neat/items')).filter(file => file.endsWith('.json')).sort().map(file => read(path.join(ledger, '.neat/items', file))),
      types: lineage.types, results,
    });
    const launcher = command([path.join(work, 'launcher/build-launcher.mjs')], assembly);
    // The offline cartridge runtime. Every chunk crisp names is immutable and
    // content-addressed (Game Boy ROM semantics), so cache-first is correct;
    // the run id versions the cartridge and activation purges older ones.
    // pxcube-run.json stays network-only: it is the new-build signal, and the
    // shell already treats its absence as "inspectable offline".
    {
      const distDir = path.join(assembly, 'dist');
      const precache = ['./', './index.html', './shell.css', './shell.mjs', './sw.js', './neat.html',
        './tick-part-checklist.js', './pxc.js', './pxc-kernel.mjs', './mock-pxc.mjs'];
      for (const { id, ok } of results) {
        if (!ok) continue;
        const rp = path.join(distDir, 'experiences', id, 'receipt.json');
        if (!fs.existsSync(rp)) continue;
        for (const chunk of read(rp).chunks ?? []) precache.push(`./experiences/${id}/${chunk.path}`);
      }
      const sw = `// Generated by local/run.mjs. A new artifact is a new cartridge.
const VERSION = ${JSON.stringify(runId)};
const PRECACHE = ${JSON.stringify(precache, null, 2)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).pathname.endsWith('/pxcube-run.json')) return;
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
    if (response.ok && new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone();
      caches.open(VERSION).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match('./index.html'))));
});
`;
      fs.writeFileSync(path.join(distDir, 'sw.js'), sw);
    }
    const report = { schemaVersion: 1, runId, sourceCommit, sourceSnapshot, toolsHash, sharedToolsHash, ledgerHashes: hashes(ledger), results, launcher, neat, tidy };
    write(path.join(run, 'report.json'), report);
    copyTree(path.join(assembly, 'dist'), path.join(run, 'site'));
    command([path.join(work, 'vendor/neat/dist/cli.js'), 'html', '--root', ledger, '--out', path.join(run, 'site/neat.html')], ledger);
    write(path.join(run, 'site', 'pxcube-run.json'), report);
    // latest is a pointer. Previous run directories are never replaced or pruned.
    const temporary = path.join(state, `latest.${runId}.json`); write(temporary, { runId, site: path.relative(repo, path.join(run, 'site')) }); fs.renameSync(temporary, path.join(state, 'latest.json'));
    console.log(`${neat.trim()}\ntidy: registry schema checked\n${launcher.trim()}\nrun: ${runId}`);
    return { report, site: path.join(run, 'site') };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

export function serve(repo = root, { port = 4321 } = {}) {
  const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };
  const server = http.createServer((request, response) => {
    try {
      if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const latest = read(path.join(repo, '.pxcube/latest.json')), base = path.resolve(repo, latest.site);
      const url = new URL(request.url, 'http://localhost'), relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(base, relative);
      if (!file.startsWith(base + path.sep) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(file));
    } catch { response.writeHead(404).end('Not found'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`PxCube: http://127.0.0.1:${port}/`)); return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action = 'dev'] = process.argv.slice(2);
  if (!['dev', 'build', 'register'].includes(action)) { console.error('Use: node local/run.mjs dev | build | register'); process.exitCode = 2; }
  else {
    try {
      const result = await build(root, {refreshRegistry:action === 'register'});
      if (action === 'dev') {
        serve(root, { port: Number(process.env.PORT || 4321) });
        let timer, running = false, again = false;
        const rebuild = async () => { if (running) { again = true; return; } running = true; try { await build(root); } catch (error) { console.error(String(error)); } finally { running = false; if (again) { again = false; void rebuild(); } } };
        for (const folder of ['experiences','launcher','crisp','tidy','.tidy','mock-pxc','local']) fs.watch(path.join(root,folder), {recursive:true}, (_event,file) => {
          if (folder === '.tidy' && String(file) !== 'manifest.json') return;
          if (!file || String(file).split(/[\\/]/).some(v => ['dist','.crisp','node_modules'].includes(v))) return;
          clearTimeout(timer); timer = setTimeout(rebuild, 350);
        });
      } else if (result.report.results.some(app => !app.ok)) process.exitCode = 1;
    } catch (error) { console.error(String(error)); process.exitCode = 1; }
  }
}
