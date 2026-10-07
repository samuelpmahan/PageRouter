import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { canonical, fileHash, safePath, sha } from '../facts.mjs';

const MANAGED_ROOTS = ['bases', 'calculations', 'overlays', 'parts', 'recipes'];
const POLICY_NAMES = ['crisp', 'kompoze', 'neat', 'tidy'];
const WORK_STATES = ['Compare', 'Combine', 'Validate', 'Review', 'Merge', 'Merged', 'Park', 'Reject'];
const equal = (left, right) => canonical(left) === canonical(right);

/** Tidy owns physical address validation. Raw directory moves must fail here. */
export async function validateDirectoryTree(root) {
  const manifests = new Map(), sources = new Map();
  async function visit(address) {
    const directory = address === '.' ? root : safePath(root, address);
    if (!(await lstat(directory)).isDirectory()) throw Error(`Managed address is not a directory: ${address}`);
    const path = address === '.' ? 'nctk.json' : `${address}/nctk.json`;
    const full = safePath(root, path);
    if ((await lstat(full)).isSymbolicLink()) throw Error(`Symlink directory manifest: ${path}`);
    const manifest = JSON.parse(await readFile(full, 'utf8'));
    if (manifest.schema !== 'nctk-directory@1' || manifest.address !== address) throw Error(`Directory address mismatch: ${path} declares ${manifest.address}, physically ${address}`);
    if (!Array.isArray(manifest.children) || !equal(manifest.children, [...new Set(manifest.children)].sort())) throw Error(`Invalid children inventory: ${address}`);
    if (!manifest.policies || !equal(Object.keys(manifest.policies).sort(), POLICY_NAMES)) throw Error(`Missing policy block: ${address}`);
    for (const name of POLICY_NAMES) if (!['local', 'inherit', 'none'].includes(manifest.policies[name]?.mode)) throw Error(`Invalid ${name} mode: ${address}`);
    if (manifest.policies.neat.mode === 'local' && !WORK_STATES.includes(manifest.policies.neat.state)) throw Error(`Invalid Neat item state: ${address}`);
    const physical = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = address === '.' ? entry.name : `${address}/${entry.name}`;
      if (address === '.' && !MANAGED_ROOTS.includes(entry.name)) continue;
      physical.push(child);
    }
    if (!equal(physical.sort(), manifest.children)) throw Error(`Managed child inventory mismatch: ${address}`);
    if (manifest.source !== null) {
      if (typeof manifest.source !== 'string' || sources.has(manifest.source)) throw Error(`Invalid or duplicate manifest source: ${address}`);
      const sourcePath = safePath(root, manifest.source);
      if (!(await lstat(sourcePath)).isFile()) throw Error(`Missing manifest source: ${manifest.source}`);
      sources.set(manifest.source, address);
    }
    manifests.set(address, { path, manifest });
    for (const child of manifest.children) await visit(child);
  }
  await visit('.');
  for (const [address, { manifest }] of manifests) {
    if (!manifest.source) continue;
    const contract = JSON.parse(await readFile(safePath(root, manifest.source), 'utf8'));
    const refs = manifest.kind === 'calculation' ? [...contract.inputs, ...contract.outputs] :
      manifest.kind === 'recipe' ? [contract.base, contract.overlay] :
      manifest.kind === 'base' ? [contract.source, contract.target] :
      manifest.kind === 'overlay' ? [contract.base] : [];
    if (!equal(manifest.policies.kompoze.references, refs)) throw Error(`Kompoze references differ from contract: ${address}`);
    for (const ref of refs) if (!manifests.has(ref) && !sources.has(ref)) throw Error(`Unmanaged reference ${ref} from ${address}`);
  }
  return { manifests, sources };
}
export async function managedManifestFiles(root) {
  const tree = await validateDirectoryTree(root);
  return [...tree.manifests.values()].map(value => value.path).sort();
}
export async function managedSourceFiles(root) {
  const tree = await validateDirectoryTree(root), files = [...tree.sources.keys()];
  for (const { manifest } of tree.manifests.values()) {
    if (manifest.kind !== 'calculation') continue;
    const contract = JSON.parse(await readFile(safePath(root, manifest.source), 'utf8'));
    files.push(`${manifest.address}/${contract.script}`);
  }
  return [...new Set(files)].sort();
}
export async function manifestForSource(root, source) {
  const tree = await validateDirectoryTree(root), address = tree.sources.get(source);
  if (!address) throw Error(`No managed directory for ${source}`);
  return tree.manifests.get(address);
}
const relativeImports = source => [...source.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g),
  ...source.matchAll(/import\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map(match => match[1]);
/** Exact authored closure claimed by a managed address, including Calculation imports. */
export async function authoredAddressFiles(root, address) {
  const { manifests } = await validateDirectoryTree(root), node = manifests.get(address);
  if (!node?.manifest.source) throw Error(`No managed source at address: ${address}`);
  const { manifest } = node, files = new Set([node.path, manifest.source]);
  const contract = JSON.parse(await readFile(safePath(root, manifest.source), 'utf8'));
  if (manifest.kind === 'calculation') {
    const visit = async path => {
      if (files.has(path)) return;
      files.add(path);
      const full = safePath(root, path), source = await readFile(full, 'utf8');
      for (const specifier of relativeImports(source)) {
        const child = relative(resolve(root), resolve(dirname(full), specifier)).replaceAll('\\', '/');
        await visit(child);
      }
    };
    await visit(`${address}/${contract.script}`);
    for (const path of contract.sourceFiles ?? []) files.add(path);
  }
  if (manifest.kind === 'part' && contract.materializer === 'fixture-file') files.add(contract.path);
  return [...files].sort();
}
export async function candidateFiles(root, addresses) {
  if (!Array.isArray(addresses) || !addresses.length || new Set(addresses).size !== addresses.length) throw Error('Candidate needs unique managed addresses');
  const claims = [];
  for (const address of [...addresses].sort()) {
    const paths = await authoredAddressFiles(root, address);
    claims.push({ address, files: await Promise.all(paths.map(async path => ({ path, sourceIdentity: await sourceIdentity(root, path) }))) });
  }
  return claims;
}
export async function sourceIdentity(root, path) {
  if (!path.endsWith('/nctk.json') && path !== 'nctk.json') return fileHash(safePath(root, path));
  const manifest = JSON.parse(await readFile(safePath(root, path), 'utf8'));
  const { neat, ...policies } = manifest.policies;
  return sha(canonical({ ...manifest, policies: { ...policies, neat: { mode: neat.mode } } }));
}

const ledgerPath = 'work/build-ledger.json';
const versionText = v => `${v.x}.${v.y}.${v.z}`;
export async function validateBuild(root, files) {
  const version = JSON.parse(await readFile(join(root, 'version.json'), 'utf8'));
  if (![version.x, version.y, version.z].every(n => Number.isInteger(n) && n >= 0) || !/^[a-z][a-z0-9-]*$/.test(version.taskId)) throw Error('Invalid semantic version or task ID');
  const identities = Object.fromEntries(await Promise.all(files.map(async path => [path, await sourceIdentity(root, path)])));
  const contentId = sha(canonical(identities));
  const previous = await readFile(join(root, ledgerPath), 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (previous) {
    const old = previous.version;
    if (versionText(version) === versionText(old) && contentId !== previous.contentId) throw Error('Build source changed without semantic version change');
    if (versionText(version) !== versionText(old)) {
      const valid = version.changeKind === 'meaning' && version.x === old.x + 1 && version.y === 0 && version.z === 0 ||
        version.changeKind === 'information' && version.x === old.x && version.y === old.y + 1 && version.z === 0 ||
        version.changeKind === 'correction' && version.x === old.x && version.y === old.y && version.z === old.z + 1;
      if (!valid) throw Error('Version bump does not match meaning/information/correction');
    }
  }
  // A fresh recipe extraction has no local ledger: its declared version is the baseline.
  return { version, contentId, identities };
}
export async function recordBuild(root, build) {
  await mkdir(join(root, 'work'), { recursive: true });
  await writeFile(join(root, ledgerPath), JSON.stringify(build, null, 2) + '\n');
}
export async function eligibility(root, node, fingerprint) {
  const directory = join(root, 'work/receipts', node.address.replaceAll('/', '__'));
  const names = await readdir(directory).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  for (const name of names.filter(n => n.endsWith('.json')).sort().reverse()) {
    const receipt = JSON.parse(await readFile(join(directory, name), 'utf8'));
    if (receipt.fingerprint !== fingerprint || receipt.execution !== 'PASS' || !receipt.outputs?.length) continue;
    let valid = true;
    for (const output of receipt.outputs) {
      const path = safePath(root, output.path);
      const actual = await fileHash(path).catch(() => null);
      if (actual !== output.sha256) { valid = false; break; }
    }
    if (valid) return { decision: 'REUSE', receipt, receiptPath: `work/receipts/${node.address.replaceAll('/', '__')}/${name}`,
      receiptSha256: await fileHash(join(directory, name)), reason: 'Exact request fingerprint and output bytes verified' };
  }
  return { decision: 'RUN', reason: 'No valid output for this request fingerprint' };
}
