import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atlasImplementationIdentity } from './atlas-identity.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

function sourceFiles(directory) {
  const files = {};
  function visit(current, prefix = '') {
    for (const name of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, name), relative = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(absolute);
      assert.equal(stat.isSymbolicLink(), false, `compiled artifact has no symlink: ${relative}`);
      if (stat.isDirectory()) visit(absolute, relative);
      else if (stat.isFile()) files[relative] = { encoding: 'base64', data: fs.readFileSync(absolute).toString('base64') };
    }
  }
  visit(directory);
  return files;
}

function importClosure(entry) {
  const pending = [entry];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    assert.ok(file.startsWith(dist + path.sep), `built import stays inside dist: ${file}`);
    assert.ok(fs.existsSync(file), `missing built import: ${file}`);
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), match[1]);
      assert.ok(target.startsWith(dist + path.sep), `${file} import escapes built tree: ${match[1]}`);
      assert.ok(fs.existsSync(target), `${file} imports missing ${match[1]}`);
      if (/\.(?:mjs|js)$/.test(target)) pending.push(target);
    }
  }
  return visited;
}

test('built host and CapabilityLab imports resolve through the guarded overlay', async () => {
  const lab = path.join(dist, 'compiled/capability-lab');
  const pin = JSON.parse(fs.readFileSync(path.join(root, 'vendor/capability-lab/SOURCE-PIN.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(dist, 'data/catalog.json'), 'utf8'));
  const project = catalog.projects.find(item => item.id === 'capability-lab');
  assert.ok(project, 'CapabilityLab remains a catalog project');
  assert.equal(project.sourcePin.sourceCommit, pin.sourceCommit, 'the historical pinned Lab revision remains the source pin');
  assert.deepEqual(project.sourcePin.files, pin.files, 'the complete original source file pin is carried into the catalog');

  for (const [relative, expectedBlob] of Object.entries(pin.files)) {
    const bytes = fs.readFileSync(path.join(root, 'vendor/capability-lab', relative));
    assert.equal(gitBlobSha(bytes), expectedBlob, `pinned vendor file is unchanged: ${relative}`);
  }

  const labFiles = importClosure(path.join(lab, 'ui/app.mjs'));
  for (const relative of [
    'references/operations/lab-bridge.mjs',
    'references/operations/adapters.mjs',
  ]) assert.ok(labFiles.has(path.join(lab, relative)), `instrumented Lab reaches ${relative}`);
  for (const relative of ['core.mjs', 'adapters.mjs', 'lab-bridge.mjs']) {
    assert.ok(fs.existsSync(path.join(lab, 'references/operations', relative)), `Lab overlay includes ${relative}`);
  }
  assert.match(fs.readFileSync(path.join(lab, 'ui/app.mjs'), 'utf8'), /observeLabRun\(\{ action: 'execute'/);
  assert.match(fs.readFileSync(path.join(lab, 'ui/app.mjs'), 'utf8'), /observeLabRun\(\{ action: 'replay'/);

  const overlay = project.observationOverlay;
  assert.equal(overlay?.schema, 'capabilitylab.operation-overlay.v1');
  assert.match(overlay?.digest ?? '', /^[a-f0-9]{64}$/);
  assert.equal(sha256(Buffer.from(canonical(overlay.files))), overlay.digest, 'overlay identity covers its file digest map');
  for (const [relative, digest] of Object.entries(overlay.files)) {
    const bytes = fs.readFileSync(path.join(lab, relative));
    assert.equal(sha256(bytes), digest, `catalog overlay digest covers compiled ${relative}`);
  }
  assert.match(project.digest, /^[a-f0-9]{64}$/);
  const [{ buildSnapshot }, { staticSpec }] = await Promise.all([
    import('../dist/compiled-patch.mjs'),
    import('../dist/static-compiler.mjs'),
  ]);
  const compiledSnapshot = await buildSnapshot(staticSpec('capability-lab', sourceFiles(lab)));
  assert.equal(compiledSnapshot.digest, project.digest, 'catalog digest identifies the exact compiled Lab including the overlay');

  const hostFiles = importClosure(path.join(dist, 'app.mjs'));
  for (const relative of [
    'atlas-view.mjs',
    'operation-timeline-view.mjs',
    'exp/operation-index/core.mjs',
    'exp/operation-index/adapters.mjs',
    'exp/operation-index/lab-bridge.mjs',
    'exp/operation-index/cv-demo.mjs',
    'vendor/capability-lab/src/runtime/index.mjs',
  ]) assert.ok(hostFiles.has(path.join(dist, relative)), `built host reaches ${relative}`);
  assert.ok(hostFiles.has(path.join(dist, 'vendor/capability-lab/src/runtime/index.mjs')), 'built CV fixture reaches a byte-identical vendored CapabilityLab runtime dependency');
});

test('current Atlas identity covers the complete operation-index runtime closure', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(dist, 'data/catalog.json'), 'utf8'));
  const identity = catalog.release.atlasIdentity;
  assert.deepEqual(identity, atlasImplementationIdentity(root), 'catalog identity matches the current source closure');
  assert.match(identity.digest, /^[a-f0-9]{64}$/);
  for (const relative of [
    'exp/operation-index/core.mjs',
    'exp/operation-index/adapters.mjs',
    'exp/operation-index/lab-bridge.mjs',
    'exp/operation-index/cv-demo.mjs',
    'vendor/capability-lab/src/runtime/index.mjs',
  ]) {
    const recorded = identity.files[relative];
    assert.ok(recorded, `current runtime identity includes ${relative}`);
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.equal(recorded.bytes, bytes.length, `${relative} source byte length`);
    assert.equal(recorded.sha256, sha256(bytes), `${relative} source digest`);
  }

  const digests = {};
  for (const relative of Object.keys(identity.files)) digests[relative] = identity.files[relative].sha256;
  assert.deepEqual(identity.roots.filter(relative => relative.startsWith('exp/operation-index/')).sort(), [
    'exp/operation-index/adapters.mjs',
    'exp/operation-index/core.mjs',
    'exp/operation-index/cv-demo.mjs',
    'exp/operation-index/lab-bridge.mjs',
  ].sort(), 'the new runtime roots are explicitly in the identity input');
  assert.equal(Object.keys(digests).length, Object.keys(identity.files).length);

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'operation-index-identity-'));
  try {
    for (const relative of Object.keys(identity.files)) {
      const target = path.join(temporaryRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, relative), target);
    }
    const copiedIdentity = atlasImplementationIdentity(temporaryRoot);
    assert.equal(copiedIdentity.digest, identity.digest);
    const core = path.join(temporaryRoot, 'exp/operation-index/core.mjs');
    fs.appendFileSync(core, '\n// identity mutation probe\n');
    assert.notEqual(atlasImplementationIdentity(temporaryRoot).digest, identity.digest, 'changing a runtime source changes the build identity');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('the built CV demo records four CapabilityLab executions with two linked replays', async () => {
  const [{ createOperationIndex }, adapters, cv] = await Promise.all([
    import('../dist/exp/operation-index/core.mjs'),
    import('../dist/exp/operation-index/adapters.mjs'),
    import('../dist/exp/operation-index/cv-demo.mjs'),
  ]);
  const index = createOperationIndex({
    idFactory: (() => { let sequence = 0; return () => `built-run-${++sequence}`; })(),
    now: (() => { let time = 1_000; return () => time++; })(),
  });
  const catalog = JSON.parse(fs.readFileSync(path.join(dist, 'data/catalog.json'), 'utf8'));
  const identity = catalog.release.atlasIdentity;
  const source = {
    implementation: {
      path: 'checkpoint/exp/operation-index/cv-demo.mjs',
      identityStatus: 'pinned-current-build',
      sourceDigest: identity.files['exp/operation-index/cv-demo.mjs'].sha256,
    },
    currentBuildIdentity: identity,
    historicalReference: {
      repository: 'samuelpmahan/ChainSpot',
      commit: '4da01fba601a250e2fd4e7b8683c9fdd6bf0401b',
      file: 'src/lib/cv/localSnap.ts',
      url: 'https://github.com/samuelpmahan/ChainSpot/blob/4da01fba601a250e2fd4e7b8683c9fdd6bf0401b/src/lib/cv/localSnap.ts',
    },
  };
  const result = cv.runCvCounterexample({ index, source });
  const runs = index.list();
  assert.deepEqual(runs.map(run => run.action), [
    'cv.rankThenFilter', 'cv.rankThenFilter.replay',
    'cv.filterThenRank', 'cv.filterThenRank.replay',
  ]);
  assert.equal(runs.length, 4);
  assert.equal(runs[1].replayOf, runs[0].id);
  assert.equal(runs[3].replayOf, runs[2].id);
  assert.equal(runs[0].status, 'succeeded');
  assert.equal(runs[2].status, 'succeeded');
  assert.equal(result.before.replay.matches, true);
  assert.equal(result.after.replay.matches, true);
  assert.equal(result.before.execution.result.candidate, null);
  assert.equal(result.after.execution.result.candidate.name, 'near-acceptable');
  assert.notEqual(result.before.indexedRunId, result.after.indexedRunId);

  for (const run of runs) {
    assert.deepEqual(JSON.parse(JSON.stringify(run)), run, `${run.id} is finite JSON evidence`);
    assert.ok(run.operations.length >= 1, `${run.id} retains actual runtime operations`);
    assert.ok(run.operations.every(operation => operation.status === 'succeeded'));
    assert.ok(run.edges.every(edge => edge.kind === 'invocation'), 'call edges remain invocation evidence');
  }
  assert.notEqual(adapters.flowCandidateKey(runs[0]), adapters.flowCandidateKey(runs[2]), 'the two operation orderings remain distinct candidates');
  assert.equal(runs[0].source.historicalReference.commit, source.historicalReference.commit);
  assert.equal(runs[0].source.currentBuildIdentity.digest, identity.digest);
  assert.notEqual(runs[0].source.historicalReference.commit, runs[0].source.currentBuildIdentity.digest);
});
