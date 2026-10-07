import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

// Retained from the verified nctk prototype: canonical values and exact-byte identities.
export const sha = data => createHash('sha256').update(data).digest('hex');
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
  value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value ?? null);
export function safePath(root, path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) throw Error(`Unsafe path: ${path}`);
  const full = resolve(root, path);
  if (full !== resolve(root) && !full.startsWith(resolve(root) + sep)) throw Error(`Outside root: ${path}`);
  return full;
}
export async function fileHash(path) { return sha(await readFile(path)); }
export async function json(root, path) {
  const full = safePath(root, path);
  if ((await lstat(full)).isSymbolicLink()) throw Error(`Symlink declaration: ${path}`);
  return JSON.parse(await readFile(full, 'utf8'));
}
async function discover(root, directory, name) {
  const found = [];
  async function walk(path) {
    for (const entry of await readdir(safePath(root, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw Error(`Symlink in authoring tree: ${child}`);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name === name) found.push(child);
    }
  }
  await walk(directory);
  return found.sort();
}
export async function compile(root, recipePath = 'recipes/house-cut.json', overrides = {}, options = {}) {
  const recipe = await json(root, recipePath);
  if (recipe.kind !== 'recipe' || !/^bases\/.+\.json$/.test(recipe.base) || !/^overlays\/.+\.json$/.test(recipe.overlay)) throw Error('Invalid recipe');
  const base = await json(root, recipe.base), overlay = await json(root, recipe.overlay);
  if (base.kind !== 'base' || overlay.kind !== 'overlay' || overlay.base !== recipe.base) throw Error('Invalid base/overlay binding');
  const runArgs = { ...base.runArgs, ...overlay.runArgs, ...overrides.runArgs };
  const viewArgs = { ...base.viewArgs, ...overlay.viewArgs, ...overrides.viewArgs };
  for (const key of Object.keys({ ...overlay.runArgs, ...overrides.runArgs })) if (!(key in base.runArgs)) throw Error(`Undeclared Run Arg: ${key}`);
  for (const key of Object.keys({ ...overlay.viewArgs, ...overrides.viewArgs })) if (!(key in base.viewArgs)) throw Error(`Undeclared View Arg: ${key}`);
  if (Object.values(runArgs).some(value => value === undefined || value === null) || Object.values(viewArgs).some(value => value === undefined || value === null)) throw Error('Invalid declared argument value');
  const partFiles = await discover(root, 'parts', 'part.json');
  const calcFiles = await discover(root, 'calculations', 'calculation.json');
  const parts = new Map(), producers = new Map(), calculations = new Map();
  for (const path of partFiles) {
    const address = dirname(path).replaceAll('\\', '/'), contract = await json(root, path);
    const policy = (await json(root, `${address}/nctk.json`)).policies;
    if (!['source', 'derived'].includes(contract.kind)) throw Error(`Invalid Part: ${address}`);
    parts.set(address, { address, path, contract, hash: sha(canonical({ contract: await fileHash(safePath(root, path)), crisp: policy.crisp, kompoze: policy.kompoze })) });
  }
  for (const path of calcFiles) {
    const address = dirname(path).replaceAll('\\', '/'), contract = await json(root, path);
    const policy = (await json(root, `${address}/nctk.json`)).policies;
    if (!Array.isArray(contract.inputs) || !Array.isArray(contract.outputs) || contract.outputs.length !== 1 || !contract.script || !Array.isArray(contract.runArgs) || !Array.isArray(contract.viewArgs) || (contract.sourceFiles !== undefined && !Array.isArray(contract.sourceFiles))) throw Error(`Invalid Calculation: ${address}`);
    const script = `${address}/${contract.script}`;
    const node = { address, path, script, contract, hash: sha(canonical({ contract: await fileHash(safePath(root, path)), crisp: policy.crisp, kompoze: policy.kompoze })), scriptHash: await fileHash(safePath(root, script)) };
    for (const input of contract.inputs) if (!parts.has(input)) throw Error(`Missing input Part: ${input}`);
    for (const output of contract.outputs) {
      if (!parts.has(output)) throw Error(`Missing output Part: ${output}`);
      const choices = producers.get(output) ?? [];
      choices.push(node);
      producers.set(output, choices);
    }
    calculations.set(address, node);
  }
  for (const part of parts.values()) {
    if (part.contract.kind === 'source' && producers.has(part.address) ||
        !options.allowVariants && part.contract.kind === 'derived' && !producers.has(part.address)) throw Error(`Source/producer mismatch: ${part.address}`);
  }
  if (!options.allowVariants) for (const [address, choices] of producers) if (choices.length > 1) throw Error(`Ambiguous producer for ${address}`);
  if (!parts.has(base.source) || parts.get(base.source).contract.kind !== 'source' || !parts.has(base.target)) throw Error('Base source/target missing');
  const ordered = [], active = new Set(), done = new Set();
  function visit(address) {
    if (done.has(address)) return;
    if (active.has(address)) throw Error(`Dependency cycle: ${address}`);
    active.add(address);
    const choices = producers.get(address) ?? [];
    if (!choices.length && parts.get(address)?.contract.kind === 'derived') throw Error(`Open Part without producer: ${address}`);
    const binding = options.producerBindings?.[address];
    if (choices.length > 1 && !binding) throw Error(`Explicit producer binding required for ${address}`);
    const node = binding ? choices.find(choice => choice.address === binding) : choices[0];
    if (binding && !node) throw Error(`Producer binding ${binding} does not produce ${address}`);
    if (node) { for (const input of node.contract.inputs) visit(input); ordered.push(node); }
    active.delete(address); done.add(address);
  }
  visit(base.target);
  if (!done.has(base.source)) throw Error('Selected target does not depend on base source');
  for (const [address, binding] of Object.entries(options.producerBindings ?? {})) {
    if (!done.has(address) && options.strictBindings !== false) throw Error(`Unused producer binding for ${address}`);
    if (!producers.get(address)?.some(node => node.address === binding)) throw Error(`Invalid producer binding for ${address}`);
  }
  return { recipePath, recipe, base, overlay, runArgs, viewArgs, parts, calculations, ordered, source: parts.get(base.source), target: base.target };
}
