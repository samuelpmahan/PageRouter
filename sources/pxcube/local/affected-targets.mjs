// Dependency-aware package targets shared by local PxCube builds and Pages CI.
//
// The launcher must always assemble a complete site, but a THING's crisp
// package is immutable once its inputs are unchanged.  This module makes that
// distinction explicit: `affected` explains the git delta; `packageKey`
// identifies the exact verified package that can be restored locally or from
// an Actions cache.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashAppSources } from '../crisp/lib/packager.mjs';
import { loadManifest } from '../crisp/lib/manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..');
const CACHE_SCHEMA = 'pxcube-package-inputs-v2';

const ignore = new Set(['.git', '.crisp', 'dist', 'node_modules', '.pxcube']);
const studioApps = new Set(['upload-disc-to-shelf', 'explore-shelf', 'your-shelf', 'build-bag', 'on-course']);
// These experiences are thin typed manifests over the shared Studio demo
// cartridge. Their package keys must move whenever the shared UI/renderer
// changes, otherwise a cache hit can quietly ship yesterday's screen.
const demoApps = new Set(['build-bag', 'create-graphics', 'export-graphics', 'on-course']);
const connect4PxcApps = new Set(['connect4-pxc']);

function sha(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

function hashPath(root, relative, memo = new Map()) {
  const key = `${root}\0${relative}`;
  if (memo.has(key)) return memo.get(key);
  const start = path.join(root, relative);
  const parts = [];
  const visit = (file, rel) => {
    if (!fs.existsSync(file)) return;
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) {
        if (ignore.has(name)) continue;
        visit(path.join(file, name), path.posix.join(rel, name));
      }
      return;
    }
    if (!stat.isFile()) return;
    parts.push(Buffer.from(`${rel}\0`));
    parts.push(fs.readFileSync(file));
  };
  visit(start, relative.replaceAll(path.sep, '/'));
  const digest = sha(parts);
  memo.set(key, digest);
  return digest;
}

function rawManifest(root, id) {
  return JSON.parse(fs.readFileSync(path.join(root, 'experiences', id, 'experience.json'), 'utf8'));
}

export function experienceIds(root = repoRoot) {
  return fs.readdirSync(path.join(root, 'experiences'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'experiences', entry.name, 'experience.json')))
    .map((entry) => entry.name)
    .sort();
}

function packageInputs(root, id) {
  // crisp's validator/mock facade are package-time inputs for every app.
  const inputs = ['crisp', 'kompoze', 'mock-pxc'];
  const raw = rawManifest(root, id);
  // `.tidy/pxcube.json` is retained build evidence written by local/run.
  // Only the authored typed manifest belongs in an immutable package key.
  if (raw.tidy) inputs.push('tidy', '.tidy/manifest.json');
  if (studioApps.has(id)) {
    inputs.push('local/build-studio.mjs', 'local/studio-sandbox', 'local/mock-mounts.mjs', 'local/experience-mount.mjs', 'local/scenarios.mjs', 'vendor/studio');
  }
  if (demoApps.has(id)) inputs.push('local/studio-demo', 'vendor/studio-renderer');
  if (connect4PxcApps.has(id)) inputs.push('experiences/connect4/rules.mjs', '../../vendor/hh/services/pxc.mjs');
  const base = raw.base;
  if (base) {
    if (!experienceIds(root).includes(base)) throw Error(`Missing composition base: ${base}`);
    inputs.push(`experiences/${base}`, ...packageInputs(root, base));
  }
  return [...new Set(inputs)].sort();
}

function compositionDependents(root) {
  const inverse = new Map();
  for (const id of experienceIds(root)) {
    const base = rawManifest(root, id).base;
    if (!base) continue;
    const children = inverse.get(base) ?? [];
    children.push(id);
    inverse.set(base, children);
  }
  return inverse;
}

function expandComposition(root, seeds) {
  const inverse = compositionDependents(root);
  const all = new Set(seeds);
  const pending = [...all];
  while (pending.length) {
    const id = pending.pop();
    for (const child of inverse.get(id) ?? []) {
      if (!all.has(child)) { all.add(child); pending.push(child); }
    }
  }
  return all;
}

function namesFromStatus(output) {
  const entries = output.split('\0').filter(Boolean);
  const names = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const code = entry.slice(0, 2);
    names.add(entry.slice(3));
    // With porcelain -z a rename/copy has a second, old-path record. Both
    // sides matter when asking an owner what changed.
    if ((code.includes('R') || code.includes('C')) && entries[index + 1]) names.add(entries[++index]);
  }
  return [...names].filter(Boolean).sort();
}

export function workingTreeChanges(root = repoRoot) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? namesFromStatus(result.stdout) : null;
}

function changedFiles(root, base, head) {
  const worktree = workingTreeChanges(root);
  if (!base || !head) return worktree;
  const result = spawnSync('git', ['diff', '--name-only', `${base}...${head}`], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return [...new Set([...result.stdout.split('\n').map((line) => line.trim()).filter(Boolean), ...(worktree ?? [])])].sort();
}

function affectedFromFiles(root, files) {
  const ids = experienceIds(root);
  if (!files) return new Map(ids.map((id) => [id, ['no comparable git base; validate every package']]));
  const reasons = new Map();
  const affect = (id, reason) => {
    if (!ids.includes(id)) return;
    const list = reasons.get(id) ?? [];
    if (!list.includes(reason)) list.push(reason);
    reasons.set(id, list);
  };
  for (const file of files) {
    if (file === 'experiences/connect4/rules.mjs' || file === 'sources/pxcube/experiences/connect4/rules.mjs') {
      affect('connect4', `shared Connect Four rules changed: ${file}`);
      for (const id of connect4PxcApps) affect(id, `Connect Four port dependency changed: ${file}`);
      continue;
    }
    if (file === '../../vendor/hh/services/pxc.mjs' || file === 'vendor/hh/services/pxc.mjs') {
      for (const id of connect4PxcApps) affect(id, `PxC Calculation runtime changed: ${file}`);
      continue;
    }
    const direct = /^experiences\/([^/]+)\//.exec(file)?.[1];
    if (direct) { affect(direct, `experience source changed: ${file}`); continue; }
    if (/^(crisp|kompoze|mock-pxc)\//.test(file)) {
      for (const id of ids) affect(id, `shared package runtime changed: ${file}`);
      continue;
    }
    if (/^tidy\//.test(file) || file === '.tidy/manifest.json') {
      for (const id of ids) if (rawManifest(root, id).tidy) affect(id, `typed manifest provider changed: ${file}`);
      continue;
    }
    if (/^(local\/build-studio\.mjs|local\/studio-sandbox\/|local\/(mock-mounts|experience-mount|scenarios)\.mjs|vendor\/studio\/)/.test(file)) {
      for (const id of studioApps) affect(id, `Studio build dependency changed: ${file}`);
      continue;
    }
    if (/^(local\/studio-demo\/|vendor\/studio-renderer\/)/.test(file)) {
      for (const id of demoApps) affect(id, `Studio demo build dependency changed: ${file}`);
    }
  }
  const expanded = expandComposition(root, reasons.keys());
  for (const id of expanded) if (!reasons.has(id)) affect(id, 'composed base changed');
  return reasons;
}

export async function resolveTargets(root = repoRoot, { base = null, head = 'HEAD' } = {}) {
  const reasons = affectedFromFiles(root, changedFiles(root, base, head));
  const hashMemo = new Map();
  const targets = [];
  for (const id of experienceIds(root)) {
    const manifest = await loadManifest(path.join(root, 'experiences', id), { providerRoot: root });
    const appHash = await hashAppSources(path.join(root, 'experiences', id), manifest);
    const inputs = packageInputs(root, id);
    const inputHash = sha(inputs.map((input) => `${input}\0${hashPath(root, input, hashMemo)}\0`));
    const composition = manifest.composition?.base ?? null;
    targets.push({
      id,
      outDir: manifest.outDir,
      affected: reasons.has(id),
      reasons: reasons.get(id) ?? [],
      inputs,
      packageKey: sha([`${CACHE_SCHEMA}\0${id}\0${appHash}\0${inputHash}\0${composition ?? ''}`]),
    });
  }
  return targets;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;
  const root = value('--root') ? path.resolve(value('--root')) : repoRoot;
  const targets = await resolveTargets(root, { base: value('--base'), head: value('--head') ?? 'HEAD' });
  if (args.includes('--matrix')) console.log(JSON.stringify(targets));
  else console.log(JSON.stringify({ schemaVersion: 1, targets }, null, 2));
}
