import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { provideExperience, digest } from '../../tidy/manifest.mjs';
import { validateManifestShape } from './manifest.mjs';
import { hasWorld, resolveAddress } from '../../mock-pxc/mock-pxc.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const templateDir = new URL('../templates/sandbox/', import.meta.url);
const files = ['index.html', 'app.mjs', 'style.css', 'build.mjs', 'README.md'];
const addressOK = value => typeof value === 'string' && /^(px|fn|oc|sc)\.[A-Za-z0-9_.-]+$/.test(value);

export function validateScaffold(manifest) {
  const errors = validateManifestShape(manifest);
  if (errors.length) throw Error(`crisp: ${errors.join('; ')}`);
  const config = manifest.scaffold;
  if (config?.template !== 'sandbox@1') throw Error('crisp: unknown scaffold template (expected sandbox@1)');
  if (manifest.build !== 'node build.mjs' || manifest.outDir !== 'dist') throw Error('crisp: sandbox@1 uses node build.mjs and dist');
  if (!hasWorld(config.world) || !manifest.mounts.includes(config.world)) throw Error('crisp: scaffold world must be known and declared in mounts');
  for (const group of ['inputs', 'outputs']) {
    if (!Array.isArray(config[group])) throw Error(`crisp: scaffold ${group} must be an array`);
    for (const item of config[group]) {
      if (!addressOK(item.address) || !item.label || !item.for) throw Error(`crisp: ${group} need inner address, label, and for`);
      if (group === 'inputs') resolveAddress(config.world, item.address);
    }
  }
  if (!Array.isArray(config.steps) || !config.steps.length || config.steps.some(step => typeof step !== 'string' || !step.trim())) throw Error('crisp: scaffold steps must name the planned work');
  if (config.draft) {
    const { address, field, label } = config.draft;
    if (!/^sc\.[A-Za-z_][A-Za-z0-9_-]*$/.test(address) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(field) || !label) throw Error('crisp: draft needs a whole scratch address, field, and label');
    if (typeof resolveAddress(config.world, `${address}.${field}`) !== 'string') throw Error('crisp: scaffold draft field must be a string');
  }
  return config;
}

export async function scaffoldExperience(repo, type) {
  const supplied = provideExperience(repo, type);
  validateScaffold(supplied.manifest);
  const target = path.join(repo, supplied.root);
  // Refuse symlink ancestors and all existing destinations: generation cannot
  // clobber the next contribution someone has already made to this scaffold.
  for (const part of [path.join(repo, 'experiences'), target]) {
    if (fs.existsSync(part) && fs.lstatSync(part).isSymbolicLink()) throw Error(`crisp: scaffold path uses a symlink: ${part}`);
  }
  if (fs.existsSync(target)) throw Error(`crisp: scaffold destination exists: ${supplied.root}`);
  const outputs = Object.fromEntries(files.map(file => [file, fs.readFileSync(new URL(file, templateDir))]));
  outputs['experience.json'] = Buffer.from(JSON.stringify({ tidy: { type } }, null, 2) + '\n');
  const hashes = Object.fromEntries(Object.entries(outputs).map(([file, bytes]) => [file, sha(bytes)]));
  const receipt = { schemaVersion: 1, root: supplied.root, manifestSource: { path: supplied.source, type, digest: supplied.digest }, template: 'sandbox@1', templateDigest: digest(Object.fromEntries(files.map(file => [file, hashes[file]]))), outputs: hashes };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(target), '.crisp-scaffold-'));
  try {
    for (const [file, bytes] of Object.entries(outputs)) fs.writeFileSync(path.join(temporary, file), bytes);
    fs.writeFileSync(path.join(temporary, 'generation.json'), JSON.stringify(receipt, null, 2) + '\n');
    // Exclusive target creation also refuses a concurrent second generator.
    fs.mkdirSync(target);
    for (const file of fs.readdirSync(temporary)) fs.renameSync(path.join(temporary, file), path.join(target, file));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  return receipt;
}
