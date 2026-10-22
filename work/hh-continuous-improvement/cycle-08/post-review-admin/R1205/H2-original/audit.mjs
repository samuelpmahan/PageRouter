import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {resolve, relative} from 'node:path';

const repo = '/workspace/scratch/8528bb251845/PageRouter';
const pack = resolve(repo, 'work/hh-continuous-improvement/cycle-08');
const scratch = '/workspace/scratch/8528bb251845/hh-cycle08';
const manifestPath = resolve(pack, 'evidence/manifest.json');
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async path => readFile(resolve(pack, path));
const readJson = async path => JSON.parse((await read(path)).toString('utf8'));

const expectedManifestSha = '487bc186ea2e144f4a20648abf85d39d9c796e33cb0d1c130c308557074d29a9';
assert.equal(sha(manifestBytes), expectedManifestSha, 'frozen manifest digest');
assert.equal(Object.keys(manifest.files).length, 77, 'frozen file entry count');
const actualFiles = [];
async function walk(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (path !== manifestPath) actualFiles.push(relative(pack, path).split('\\').join('/'));
  }
}
await walk(pack);
actualFiles.sort();
const listedFiles = Object.keys(manifest.files).sort();
const missing = listedFiles.filter(path => !actualFiles.includes(path));
const unmanifested = actualFiles.filter(path => !Object.hasOwn(manifest.files, path));
const mismatches = [];
for (const path of listedFiles) {
  if (!actualFiles.includes(path)) continue;
  const actualHash = sha(await read(path));
  if (actualHash !== manifest.files[path]) mismatches.push({path, expected: manifest.files[path], actual: actualHash});
}
assert.deepEqual({missing, unmanifested, mismatches}, {missing: [], unmanifested: [], mismatches: []});

const productPaths = [
  'checkpoint/vendor/hh/src/public-controller.mjs',
  'checkpoint/vendor/hh/src/public-controller.test.mjs',
];
const productHashes = {};
const sourceBindings = {};
const e1204Receipt = await readJson('evidence/E1204/site.receipt.json');
for (const path of productPaths) {
  const expected = path.endsWith('.mjs') && path.includes('test.')
    ? '1150f43987bf79a5eb82936e0ee6100852f8f29388b239d14849ac08a0fbad62'
    : '8faad923a2e4721f1cc1059f902c54f97759ef32b57d36fe4fa8523205011a0b';
  const actual = sha(await readFile(resolve(repo, path)));
  const archivedPath = path === productPaths[0] ? 'evidence/E1203/public-controller.after.mjs' : 'evidence/E1203/public-controller.test.after.mjs';
  const archived = sha(await read(archivedPath));
  const buildPath = path.replace('checkpoint/', '');
  const binding = e1204Receipt.sourceInputs.find(item => item.path === buildPath);
  assert.equal(actual, expected, `${path} live source freeze`);
  assert.equal(archived, expected, `${archivedPath} source archive copy`);
  assert.equal(binding?.sha256, expected, `${path} canonical build source binding`);
  productHashes[path] = actual;
  sourceBindings[path] = {archivePath: archivedPath, buildSha256: binding.sha256, bytes: binding.bytes};
}

const e1204 = await readJson('evidence/E1204/result.json');
assert.deepEqual(e1204.test_results, {
  build_helpers: {passed: 2, failed: 0},
  targeted_HH_controller_community: {passed: 123, failed: 0},
  full_npm_suite: {passed: 278, failed: 0},
  built_atlas_import: {passed: 1, failed: 0},
});
assert.equal(e1204.build_receipt.siteBuildId, e1204Receipt.siteBuildId);
assert.equal(e1204.build_receipt.siteDigest, e1204Receipt.siteDigest);
assert.equal(e1204Receipt.pxcube.packages, 14);
assert.match((await read('evidence/E1204/site.log')).toString('utf8'), /Built 843 files; all 14 PxCube packages succeeded/);
const e1204receiptHash = sha(await read('evidence/E1204/site.receipt.json'));
assert.equal(e1204receiptHash, e1204.build_receipt.sha256);

const logs = {};
for (const [key, path] of Object.entries({
  red: 'evidence/E1203/red.stdout.log',
  compatibility: 'evidence/E1203/compatibility-baseline.stdout.log',
  focused: 'evidence/E1203/green-share.stdout.log',
  controller: 'evidence/E1203/full-controller.stdout.log',
  hhSourceCore: 'evidence/E1203/hh-source-core.stdout.log',
  hhSourceBroad: 'evidence/E1203/hh-source.stdout.log',
})) logs[key] = (await read(path)).toString('utf8');
assert.match(logs.red, /ℹ tests 1[\s\S]*ℹ pass 0[\s\S]*ℹ fail 1/);
assert.match(logs.red, /foreign route retires Avery handoff before provider completion/);
assert.match(logs.compatibility, /ℹ tests 1[\s\S]*ℹ pass 1[\s\S]*ℹ fail 0/);
assert.match(logs.focused, /ℹ tests 3[\s\S]*ℹ pass 3[\s\S]*ℹ fail 0/);
assert.match(logs.controller, /ℹ tests 49[\s\S]*ℹ pass 49[\s\S]*ℹ fail 0/);
assert.match(logs.hhSourceCore, /ℹ tests 116[\s\S]*ℹ pass 116[\s\S]*ℹ fail 0/);
assert.match(logs.hhSourceBroad, /ℹ tests 117[\s\S]*ℹ pass 116[\s\S]*ℹ fail 1/);
assert.match(logs.hhSourceBroad, /ERR_MODULE_NOT_FOUND/);
assert.match(logs.hhSourceBroad, /fast-check/);

const e1201 = await readJson('evidence/E1201/result.json');
const e1201Supplement = await readJson('evidence/E1201/E1201-postfinish-diagnostic.json');
assert.equal(e1201.outcome, 'confirmed_reuse');
assert.match((await read('evidence/E1201/stdout-first-failure.log')).toString('utf8'), /AssertionError/);
assert.match((await read('evidence/E1201/stdout-second-failure.log')).toString('utf8'), /AssertionError/);
assert.match((await read('evidence/E1201/probe-first-failure.mjs')).toString('utf8'), /share-route/);
assert.match((await read('evidence/E1201/probe-second-failure.mjs')).toString('utf8'), /profileStatus, 'loading'/);
assert.match(e1201Supplement.status, /post-finish supplemental diagnostic; not part of the original E1201 worker finish envelope/);
assert.equal(e1201Supplement.parent_native_receipt_sha256, manifest.files['native/receipts/E1201.json']);

const comparedNative = [];
const nativePairs = [];
for (let i = 0; i <= 3; i++) {
  const stem = `epoch-0${i}`;
  for (const ext of ['bundle', 'json', 'stderr.log', 'stdout.log']) nativePairs.push([`solves/${stem}.${ext}`, `native/solves/${stem}.${ext}`]);
}
for (const name of ['E1201', 'E1202', 'E1203', 'E1204', 'R1203']) nativePairs.push([`receipts/${name}.json`, `native/receipts/${name}.json`]);
for (const name of ['H1-E1201', 'H1-E1203', 'H1-E1204', 'H1-E1205', 'H2-E1202', 'H2-R1203']) nativePairs.push([`acknowledgments/${name}.json`, `native/receipts/${name}.json`]);
nativePairs.push(['H1/E1205/result.json', 'evidence/E1205/result.json']);
for (const [sourcePath, archivedPath] of nativePairs) {
  const sourceBytes = await readFile(resolve(scratch, sourcePath));
  const archivedBytes = await read(archivedPath);
  assert.equal(sha(archivedBytes), sha(sourceBytes), `native copy binding ${sourcePath}`);
  comparedNative.push(sourcePath);
}
const historical = await readJson('native/state-historical-E1205-packaging-running.json');
assert.equal(historical.epoch, 4);
assert.equal(historical.jobs.E1205.status, 'running');
assert.match((await read('README.md')).toString('utf8'), /exact historical snapshot.*not live state or authority/);

const browserAttempt = await readJson('browser/browser-attempt.json');
const cloudAttempt = await readJson('browser/browser-cloud-attempt.json');
assert.equal(browserAttempt.browserVisualQA, 'NOT_EXECUTED');
assert.equal(browserAttempt.screenshots, 0);
assert.equal(cloudAttempt.browserVisualQA, 'UNVERIFIED');
assert.equal(cloudAttempt.screenshots, 0);
assert.equal(cloudAttempt.DOMAssertionsFromBrowser, 0);
assert.match(browserAttempt.attempts[1].result, /originating browser context/);
assert.match(cloudAttempt.cloud.result, /ERR_CONNECTION_REFUSED/);

const readme = (await read('README.md')).toString('utf8');
const next = (await read('NEXT.md')).toString('utf8');
const continuation = await readJson('continuation.json');
assert.match(readme, /No real accounts\/teacher data, production or HH backend, HTTP backend calls, external copy\/share\/open, or browser exposure/);
assert.match(readme, /No commit, push, PR update, merge, main update, or deployment/);
assert.match(readme, /without claiming a screenshot, DOM, or visual acceptance/);
assert.match(next, /no commit, publication payload, push, merge, main update, deployment, browser visual QA, or human acceptance/i);
assert.equal(continuation.status.publication, 'not pushed, merged, or deployed');
assert.equal(continuation.status.humanAcceptance, 'not claimed');
assert.match(next, /unexecuted/);
assert.match(next, /Passwords.*never/i);

const commandFiles = ['E1201', 'E1202', 'E1203', 'E1204', 'R1203'].map(id => `evidence/${id}/COMMANDS.txt`);
const commandNotes = [];
for (const path of commandFiles) {
  const content = (await read(path)).toString('utf8');
  if (content.includes('/workspace/scratch/8528bb251845')) commandNotes.push(path);
}
const e1205 = await readJson('evidence/E1205/result.json');
const newPackageDocs = ['README.md', 'NEXT.md', 'continuation.json'];
assert.match(e1205.summary, /No source, docs, Git refs, build outputs, or publication payload were changed during packaging/);

const result = {
  job_id: 'R1205', worker: 'H2', decision: 'accepted',
  repository: 'PageRouter', packagePath: 'work/hh-continuous-improvement/cycle-08/',
  manifestSha256: sha(manifestBytes), manifestEntries: listedFiles.length, actualFilesExcludingManifest: actualFiles.length,
  byteAudit: {missing: missing.length, unmanifested: unmanifested.length, mismatches: mismatches.length, verified: true},
  sourceFreeze: {productHashes, canonicalSourceBindings: sourceBindings, E1204ReceiptSha256: e1204receiptHash,
    sourceInputCount: e1204Receipt.sourceInputs.length, verified: true},
  canonicalBuild: {targetedHH: e1204.test_results.targeted_HH_controller_community,
    fullSuite: e1204.test_results.full_npm_suite, atlas: e1204.test_results.built_atlas_import,
    helpers: e1204.test_results.build_helpers, pxcubePackages: e1204Receipt.pxcube.packages,
    verifiedOutputFiles: 843, siteBuildId: e1204Receipt.siteBuildId, siteDigest: e1204Receipt.siteDigest},
  regressionEvidence: {E1201: {outcome: e1201.outcome, firstFailurePreserved: true, secondFailurePreserved: true,
      postFinishSupplementQualified: e1201Supplement.status},
    E1203: {actualRed: '1 test, 0 pass, 1 fail (expected old-code behavioral failure)',
      compatibilityControl: '1 passed, 0 failed', focusedShare: '3 passed, 0 failed', controller: '49 passed, 0 failed',
      sourceCore: '116 passed, 0 failed', broadDirect: '116 passed, 1 failed at module load; missing fast-check',
      broadFailureQualified: true}},
  nativeEvidence: {comparedSourceToPackageFiles: comparedNative.length, epochsPackaged: [0, 1, 2, 3],
    historicalSnapshotEpoch: historical.epoch, E1205HistoricalStatusAtCapture: historical.jobs.E1205.status,
    explicitlyNotLive: true},
  browserScope: {extensionFailureRecorded: true, cloudLoopbackRefusedRecorded: true,
    screenshots: 0, browserVisualQA: 'UNVERIFIED'},
  scope: {syntheticFixturesOnly: true, backendOrHTTPCalls: false, productionOrRealData: false,
    externalShareCopyOpen: false, gitOrProductSourceChangesByAudit: false, humanAcceptanceClaimed: false,
    mainOrDeploymentClaimed: false},
  auditNotes: {
    commandPortability: 'COMMANDS.txt files preserve exact original invocations; several contain this workspace’s absolute /workspace/scratch paths or direct probe imports, so they are provenance records rather than relocatable drop-in commands. Replaying elsewhere requires path remapping and must preserve original scripts separately.',
    wordingAmbiguity: {severity: 'nonblocking', exactE1205Wording: 'No source, docs, Git refs, build outputs, or publication payload were changed during packaging.',
      packageAuthoredDocs: newPackageDocs,
      assessment: 'The frozen package plainly contains newly authored cycle-08 README/NEXT/continuation docs, while copied source and earlier docs remain manifest-bound. This is best read as no pre-existing source/docs changed, but the raw E1205 sentence is broader than that. Preserve the package bytes; clarify append-only in root-owned post-review administration.'},
  },
  summary: 'Accepted the exact frozen 77-file package: the manifest SHA-256 matches, all 77 listed files match and there are no unmanifested files. Product source copies and E1204 build receipt bind the two assigned hashes. Recorded red/green/build counts and their dependency failure distinction match raw logs. Original E1201 harness failures, explicitly post-finish supplement, native receipts/bundles, historical E1205-running capture, and browser attempt boundaries are preserved and qualified. No rebuild or re-execution of unchanged green evidence was performed.',
  commands: ['node /workspace/scratch/8528bb251845/hh-cycle08/H2/R1205/audit.mjs'],
  limitations: ['This was a package-integrity/provenance audit, not browser QA or a fresh canonical build.',
    'Historical browser extension and loopback failures are not interpreted as production or application failures.',
    'Machine-specific absolute paths in original command records require remapping for relocation.'],
};
await writeFile(resolve('/workspace/scratch/8528bb251845/hh-cycle08/H2/R1205/result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({job_id: result.job_id, worker: result.worker, decision: result.decision,
  manifestSha256: result.manifestSha256, manifestEntries: result.manifestEntries, byteAudit: result.byteAudit,
  sourceFreeze: result.sourceFreeze, canonicalBuild: result.canonicalBuild, regressionEvidence: result.regressionEvidence,
  nativeEvidence: result.nativeEvidence, browserScope: result.browserScope, auditNotes: result.auditNotes}, null, 2));
