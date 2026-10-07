import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyReceipt } from '../../../crisp/lib/verifier.mjs';
import { canonical } from '../../../tidy/manifest.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '../../..');
const here = process.env.PXCUBE_EVIDENCE_DIR ? path.resolve(root, process.env.PXCUBE_EVIDENCE_DIR) : scriptDirectory;
fs.mkdirSync(here, { recursive: true });
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (p, v) => fs.writeFileSync(path.join(here, p), JSON.stringify(v, null, 2) + '\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const latest = read(path.join(root, '.pxcube/latest.json'));
const site = path.join(root, latest.site);
const remote = 'https://samuelpmahan.github.io/PxCube/';
const state = html => JSON.parse(html.match(/<script[^>]*id="ntc-state"[^>]*>([\s\S]*?)<\/script>/)[1]);
const requests = [];
async function get(relative) {
  const url = new URL(relative, remote).href;
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  const bytes = Buffer.from(await response.arrayBuffer());
  requests.push({ url, status: response.status, bytes: bytes.length, sha256: digest(bytes), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') });
  return { status: response.status, bytes };
}
async function batch(items, action) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await action(items[i], i); }
  }));
  return results;
}
const localHtml = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
const remoteIndex = await get('');
if (remoteIndex.status !== 200) throw Error(`Pages index returned ${remoteIndex.status}`);
const pagesHtml = remoteIndex.bytes.toString();
const localState = state(localHtml), pagesState = state(pagesHtml);
save('local-state.json', localState); save('pages-state.json', pagesState);
const report = {
  observedAt: new Date().toISOString(), pages: remote, workflowRun: Number(process.env.WORKFLOW_RUN_ID || 34897594224),
  localHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  localBranch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
  localRun: latest, state: {}, shell: [], experiences: [], supportingFiles: [], requests,
};
for (const [mode, value] of [['local', localState], ['pages', pagesState]]) {
  report.state[mode] = { runId: value.runId ?? null, sourceCommit: value.sourceCommit ?? null,
    work: value.work.length, types: Object.keys(value.types).length, results: value.results.length,
    packagedIds: value.packagedIds, receiptAccordions: (mode === 'local' ? localHtml : pagesHtml).split('wiring manifest, crisp receipt').length - 1 };
}
for (const file of ['shell.css', 'shell.mjs']) {
  const deployed = await get(file), localBytes = fs.readFileSync(path.join(site, file));
  report.shell.push({ file, status: deployed.status, sameBytes: deployed.bytes.equals(localBytes) });
}
for (const file of ['neat.html', 'pxcube-run.json']) {
  const deployed = await get(file);
  const localFile = path.join(site, file), localExists = fs.existsSync(localFile);
  report.supportingFiles.push({ file, pagesStatus: deployed.status, localExists, sameBytes: localExists && deployed.bytes.equals(fs.readFileSync(localFile)) });
}
for (const id of localState.packagedIds) {
  const prefix = `experiences/${id}/`;
  const deployed = await get(prefix + 'receipt.json');
  if (deployed.status !== 200) throw Error(`${id} receipt returned ${deployed.status}`);
  const receipt = JSON.parse(deployed.bytes);
  const localReceipt = read(path.join(site, prefix, 'pxcube-receipt.json'));
  const downloadRoot = path.join(here, 'downloaded', id); fs.mkdirSync(downloadRoot, { recursive: true });
  fs.writeFileSync(path.join(downloadRoot, 'receipt.json'), deployed.bytes);
  const chunks = await batch(receipt.chunks, async chunk => {
    if (path.isAbsolute(chunk.path) || chunk.path.split('/').includes('..')) throw Error('Unsafe receipt path');
    const actual = await get(prefix + chunk.path);
    const destination = path.join(downloadRoot, chunk.path); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, actual.bytes);
    const localFile = path.join(site, prefix, chunk.path), localBytes = fs.existsSync(localFile) ? fs.readFileSync(localFile) : null;
    return { path: chunk.path, pagesStatus: actual.status, receiptHash: chunk.sha256, pagesHash: digest(actual.bytes),
      localHash: localBytes ? digest(localBytes) : null, sameBytes: localBytes?.equals(actual.bytes) ?? false };
  });
  const localManifest = localState.manifests.find(m => m.id === id), pagesManifest = pagesState.manifests.find(m => m.id === id);
  const contract = m => Object.fromEntries(['id', 'title', 'version', 'entry', 'mounts', 'sandbox', 'build', 'track'].map(k => [k, m[k] ?? null]));
  const validation = await verifyReceipt(path.join(downloadRoot, 'receipt.json'), downloadRoot);
  const entry = { id, title: pagesManifest.title, contractMatches: JSON.stringify(contract(localManifest)) === JSON.stringify(contract(pagesManifest)),
    effectiveContractMatches: JSON.stringify({ ...contract(localManifest), track: localManifest.track === 'clean' ? 'clean' : 'exp' }) === JSON.stringify({ ...contract(pagesManifest), track: pagesManifest.track === 'clean' ? 'clean' : 'exp' }),
    sourceHashMatches: localReceipt.sourceHash === receipt.sourceHash, manifestHashMatches: localReceipt.manifestHash === receipt.manifestHash,
    entryChunkMatches: localReceipt.entryChunk === receipt.entryChunk,
    localChunkCount: localReceipt.chunks.length, pagesChunkCount: receipt.chunks.length, identicalChunks: chunks.filter(c => c.sameBytes).length,
    validation, mountValidation: receipt.validation, chunks,
    localManifest: contract(localManifest), pagesManifest: contract(pagesManifest) };
  report.experiences.push(entry); save('byte-results.json', report);
  console.log(JSON.stringify({ id, same: entry.identicalChunks, total: chunks.length, validation: validation.ok, contract: entry.contractMatches }));
}
// Compare the retained definitions and outputs. Keep each run's own identity
// and measured duration in the evidence, without requiring those to be equal.
const normalizeRun = (value, runId) => JSON.parse(JSON.stringify(value).replaceAll(runId || '<absent>', '<assembly-run>'));
const outcomes = value => value.results.map(({ build, ...result }) => ({ ...result, build: build && { ...build, durationMs: '<measured-per-build>' } }));
report.ntc = {
  sourceCommitMatches: localState.sourceCommit === pagesState.sourceCommit && !!pagesState.sourceCommit,
  workMatches: canonical(localState.work) === canonical(pagesState.work),
  typesMatch: canonical(localState.types) === canonical(pagesState.types),
  manifestsMatch: canonical(normalizeRun(localState.manifests, localState.runId)) === canonical(normalizeRun(pagesState.manifests, pagesState.runId)),
  outcomesMatch: canonical(outcomes(localState)) === canonical(outcomes(pagesState)),
  sharedToolsHashMatches: localState.sharedToolsHash === pagesState.sharedToolsHash && !!pagesState.sharedToolsHash,
};
report.summary = { allRemoteChunksVerified: report.experiences.every(e => e.validation.ok && e.chunks.every(c => c.pagesStatus === 200)),
  allExperienceBytesMatch: report.experiences.every(e => e.localChunkCount === e.pagesChunkCount && e.identicalChunks === e.pagesChunkCount),
  allContractsMatch: report.experiences.every(e => e.contractMatches),
  allEffectiveContractsMatch: report.experiences.every(e => e.effectiveContractMatches),
  totalChunks: report.experiences.reduce((n, e) => n + e.pagesChunkCount, 0),
  ntcStateMatches: JSON.stringify(report.state.local) === JSON.stringify(report.state.pages),
  ntcSemanticParity: Object.values(report.ntc).every(Boolean),
  allSupportingFilesAvailable: report.supportingFiles.every(file => file.localExists && file.pagesStatus === 200),
};
save('byte-results.json', report);
console.log(JSON.stringify({ summary: report.summary, state: report.state, supportingFiles: report.supportingFiles }, null, 2));
