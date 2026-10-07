#!/usr/bin/env node
// Bounded cleanup for generated local packaging attempts. It deliberately has
// no arbitrary target argument: source, worktrees, and committed evidence are
// outside this utility's authority.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');
const runIdPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function assertRunsDirectory(repo, runs) {
  const expected = path.resolve(repo, '.pxcube', 'runs');
  if (path.resolve(runs) !== expected) throw Error('Refusing cleanup outside this repository’s .pxcube/runs directory.');
  return expected;
}

export function planGeneratedRunPrune(repo = root, { keep = 3 } = {}) {
  if (!Number.isSafeInteger(keep) || keep < 1) throw Error('--keep must be a positive integer.');
  const runs = assertRunsDirectory(repo, path.join(repo, '.pxcube', 'runs'));
  if (!fs.existsSync(runs)) return { runs, keep, retained: [], remove: [], bytes: 0 };
  const latest = readJson(path.join(repo, '.pxcube', 'latest.json'))?.runId;
  const entries = fs.readdirSync(runs, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && runIdPattern.test(entry.name))
    .map(entry => ({ name: entry.name, path: path.join(runs, entry.name), mtimeMs: fs.statSync(path.join(runs, entry.name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const retainedNames = new Set(entries.slice(0, keep).map(entry => entry.name));
  if (typeof latest === 'string' && runIdPattern.test(latest)) retainedNames.add(latest);
  const retained = entries.filter(entry => retainedNames.has(entry.name));
  const remove = entries.filter(entry => !retainedNames.has(entry.name));
  return { runs, keep, retained, remove, bytes: remove.reduce((total, entry) => total + directoryBytes(entry.path), 0) };
}

function directoryBytes(directory) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) total += directoryBytes(item);
    else if (entry.isFile()) total += fs.lstatSync(item).size;
  }
  return total;
}

export function applyGeneratedRunPrune(plan, repo = root) {
  assertRunsDirectory(repo, plan.runs);
  for (const entry of plan.remove) {
    if (!entry.path.startsWith(`${plan.runs}${path.sep}`) || !runIdPattern.test(entry.name) || fs.lstatSync(entry.path).isSymbolicLink()) throw Error(`Refusing unsafe generated-run target: ${entry.path}`);
    fs.rmSync(entry.path, { recursive: true, force: false });
  }
  return plan.remove.length;
}

function usage() { return 'Use: node local/prune-generated-runs.mjs [--dry-run|--apply] [--keep N]'; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let apply = false, keep = 3;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--dry-run') continue;
    if (args[index] === '--apply') { apply = true; continue; }
    if (args[index] === '--keep' && /^\d+$/.test(args[index + 1] ?? '')) { keep = Number(args[++index]); continue; }
    throw Error(usage());
  }
  const plan = planGeneratedRunPrune(root, { keep });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', keep, retained: plan.retained.map(entry => entry.name), remove: plan.remove.map(entry => entry.name), reclaimBytes: plan.bytes }, null, 2));
  if (apply) console.log(`Removed ${applyGeneratedRunPrune(plan)} generated run(s).`);
}
