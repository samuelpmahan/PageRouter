import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build, root } from '../run.mjs';
import { verifyReceipt } from '../../crisp/lib/verifier.mjs';
import { workspace, cli } from './scaffold-helpers.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const state = site => JSON.parse(fs.readFileSync(path.join(site, 'index.html'), 'utf8').match(/<script[^>]*id="ntc-state"[^>]*>([\s\S]*?)<\/script>/)[1]);
const stable = (value, runId) => JSON.parse(JSON.stringify(value).replaceAll(runId, '<assembly-run>'));

async function prepared() {
  const repo = workspace();
  assert.equal(cli(repo, 'scaffold', '--from-tidy', 'pxcube-build-bag').status, 0);
  const hello = path.join(repo, 'experiences/hello');
  fs.cpSync(path.join(root, 'crisp/fixtures/hello'), hello, { recursive: true });
  const counter = path.join(repo, 'build-count');
  fs.writeFileSync(path.join(hello, 'build.mjs'), `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(counter)}, 'built\\n');\nfs.mkdirSync('dist', {recursive:true});\nfs.copyFileSync('src/index.html','dist/index.html');\n`);
  const manifest = read(path.join(hello, 'experience.json'));
  manifest.build = 'node build.mjs';
  fs.writeFileSync(path.join(hello, 'experience.json'), JSON.stringify(manifest));
  const local = await build(repo);
  assert.ok(local.report.results.every(result => result.ok));
  const stagedRoot = path.join(repo, 'matrix-artifacts');
  for (const result of local.report.results) {
    const source = path.join(local.site, 'experiences', result.id);
    const destination = path.join(stagedRoot, `exp-${result.id}`);
    fs.cpSync(source, destination, { recursive: true });
  }
  return { repo, local, stagedRoot, counter };
}

test('local and matrix assembly carry the same complete NTC surface without rebuilding', async () => {
  const { repo, local, stagedRoot, counter } = await prepared();
  try {
    const assembled = await build(repo, { stagedRoot });
    assert.ok(assembled.report.results.every(result => result.ok));
    assert.deepEqual(stable(state(local.site), local.report.runId), stable(state(assembled.site), assembled.report.runId));
    assert.equal(fs.readFileSync(counter, 'utf8'), 'built\n', 'assembly must not rerun a package build');
    for (const site of [local.site, assembled.site]) {
      const snapshot = state(site), html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
      assert.equal(snapshot.work.length, 2);
      assert.equal(Object.keys(snapshot.types).length, 2);
      assert.equal(snapshot.results.length, 2);
      assert.equal(html.split('wiring manifest, crisp receipt').length - 1, 2);
      assert.ok(fs.statSync(path.join(site, 'neat.html')).size > 0);
      assert.equal(read(path.join(site, 'pxcube-run.json')).runId, snapshot.runId);
      for (const result of snapshot.results) {
        assert.equal(result.receipt, `experiences/${result.id}/receipt.json`);
        const directory = path.join(site, 'experiences', result.id);
        assert.ok((await verifyReceipt(path.join(site, result.receipt), directory)).ok);
        assert.deepEqual(read(path.join(directory, 'receipt.json')).chunks, read(path.join(directory, 'pxcube-receipt.json')).chunks);
      }
      // The offline cartridge runtime precaches every content-addressed chunk.
      const sw = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
      assert.ok(sw.includes(`const VERSION = ${JSON.stringify(snapshot.runId)}`), 'sw versioned by the run id');
      assert.ok(sw.includes('tick-part-checklist.js'), 'sw precaches the review checklist component');
      for (const result of snapshot.results) {
        const receipt = read(path.join(site, 'experiences', result.id, 'receipt.json'));
        for (const chunk of receipt.chunks) {
          assert.ok(sw.includes(`./experiences/${result.id}/${chunk.path}`), `sw precaches ${result.id}/${chunk.path}`);
        }
      }
    }
    for (const result of local.report.results) {
      const from = path.join(local.site, 'experiences', result.id), to = path.join(assembled.site, 'experiences', result.id);
      const receipt = read(path.join(from, 'receipt.json'));
      assert.deepEqual(read(path.join(to, 'receipt.json')), receipt, 'preserve the matrix producer\'s testimony');
      for (const chunk of receipt.chunks) assert.deepEqual(fs.readFileSync(path.join(from, chunk.path)), fs.readFileSync(path.join(to, chunk.path)));
    }
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('missing and altered matrix artifacts stay red while healthy siblings and prior attempts survive', async () => {
  const { repo, local, stagedRoot, counter } = await prepared();
  try {
    const directory = path.join(stagedRoot, 'exp-hello');
    const entry = path.join(directory, 'index.html');
    fs.writeFileSync(entry, 'different from the receipt');
    const altered = await build(repo, { stagedRoot });
    assert.equal(altered.report.results.find(r => r.id === 'hello').ok, false);
    assert.match(altered.report.results.find(r => r.id === 'hello').error, /receipt verification/);
    assert.equal(fs.existsSync(path.join(altered.site, 'experiences/hello/index.html')), false);
    assert.ok(altered.report.results.find(r => r.id === 'build-bag').ok);
    fs.rmSync(directory, { recursive: true });
    const missing = await build(repo, { stagedRoot });
    assert.match(missing.report.results.find(r => r.id === 'hello').error, /No package receipt/);
    assert.ok(missing.report.results.find(r => r.id === 'build-bag').ok);
    assert.match(fs.readFileSync(path.join(missing.site, 'index.html'), 'utf8'), /build failed, not shipped/);
    assert.equal(fs.readFileSync(counter, 'utf8'), 'built\n');
    assert.ok((await verifyReceipt(path.join(local.site, 'experiences/hello/receipt.json'), path.join(local.site, 'experiences/hello'))).ok);

    const output = path.join(repo, 'job-output');
    const attempt = spawnSync(process.execPath, ['local/ci.mjs', '--staged', stagedRoot], { cwd: repo, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    assert.equal(attempt.status, 1, attempt.stderr);
    assert.equal(fs.readFileSync(output, 'utf8'), 'site-ready=true\n');
    assert.ok(fs.existsSync(path.join(repo, 'dist/neat.html')));
    assert.equal(read(path.join(repo, 'dist/pxcube-run.json')).results.filter(r => r.ok).length, 1);
    // A fatal assembly failure must not label a previous dist as deployable.
    fs.writeFileSync(path.join(repo, '.tidy/manifest.json'), 'invalid json');
    const failedOutput = path.join(repo, 'failed-job-output');
    const fatal = spawnSync(process.execPath, ['local/ci.mjs', '--staged', stagedRoot], { cwd: repo, env: { ...process.env, GITHUB_OUTPUT: failedOutput }, encoding: 'utf8' });
    assert.notEqual(fatal.status, 0);
    assert.equal(fs.existsSync(failedOutput), false);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
