import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TIDY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_REGISTRY = join(TIDY_ROOT, 'registry.json');

export class TidyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TidyError';
    this.code = code;
  }
}

export async function loadRegistry(registryPath = DEFAULT_REGISTRY) {
  try {
    return JSON.parse(await readFile(registryPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { stages: {} };
    throw new TidyError('registry', `cannot read registry ${registryPath}: ${err.message}`);
  }
}

export async function saveRegistry(registry, registryPath = DEFAULT_REGISTRY) {
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n');
}

// Register a stage: a pointer at a working folder, nothing more. This is what
// `neat add` triggers (via crisp as the go-between). No hashes: exp work is a
// live pointer, and content hashes exist only when frozen at promotion.
export async function registerStage(id, { source, title = null } = {}, registryPath = DEFAULT_REGISTRY) {
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new TidyError('register', `bad stage id "${id}": lowercase letters, digits, dashes`);
  }
  if (!source) {
    throw new TidyError('register', 'register needs --source, e.g. --source exp/hello');
  }
  const registry = await loadRegistry(registryPath);
  if (registry.stages[id]) {
    throw new TidyError('register', `stage "${id}" is already registered (source: ${registry.stages[id].source})`);
  }
  const now = new Date().toISOString();
  registry.stages[id] = {
    id,
    source, // tidy registry pointer, e.g. "exp/hello"
    title,
    track: 'exp',
    frozen: false,
    chunks: null, // content hashes land here only at promotion
    registeredAt: now,
    promotedAt: null,
    promotedBy: null,
  };
  await saveRegistry(registry, registryPath);
  return registry.stages[id];
}

// Record hashes at promotion: copy the crisp receipt's content-addressed
// chunks into the registry and freeze the stage. Promotion is Sam's hand
// only: without --by-sam this refuses, the same way the ledger never records
// acceptance by itself.
export async function promoteStage(id, { bySam = false, receiptPath } = {}, registryPath = DEFAULT_REGISTRY) {
  if (!bySam) {
    throw new TidyError('promote', `refusing to promote "${id}": promotion is Sam's hand only (pass --by-sam)`);
  }
  if (!receiptPath) {
    throw new TidyError('promote', 'promote needs --receipt <crisp-receipt.json>');
  }
  const registry = await loadRegistry(registryPath);
  const stage = registry.stages[id];
  if (!stage) {
    throw new TidyError('promote', `stage "${id}" is not registered`);
  }
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  } catch (err) {
    throw new TidyError('promote', `cannot read receipt ${receiptPath}: ${err.message}`);
  }
  if (!Array.isArray(receipt.chunks) || receipt.chunks.length === 0) {
    throw new TidyError('promote', `receipt ${receiptPath} has no chunks to freeze`);
  }
  const now = new Date().toISOString();
  stage.track = 'clean';
  stage.frozen = true;
  stage.chunks = receipt.chunks.map((c) => ({ path: c.path, sha256: c.sha256 }));
  stage.entryChunk = receipt.entryChunk ?? null;
  stage.promotedAt = now;
  stage.promotedBy = 'sam';
  await saveRegistry(registry, registryPath);
  return stage;
}

export async function stageStatus(id, registryPath = DEFAULT_REGISTRY) {
  const registry = await loadRegistry(registryPath);
  if (id) {
    const stage = registry.stages[id];
    if (!stage) throw new TidyError('status', `stage "${id}" is not registered`);
    return stage;
  }
  return Object.values(registry.stages);
}
