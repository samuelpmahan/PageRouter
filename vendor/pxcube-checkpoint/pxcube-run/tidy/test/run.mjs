#!/usr/bin/env node
// Tests for the tidy registry: the only two jobs are registering stages
// (pointers, no hashes) and recording hashes at promotion (Sam's hand only).
// Runs the CLI against a temp registry file; the repo's registry.json is
// never touched.
//
// usage: node test/run.mjs   (run from anywhere; paths are file-relative)
// exit: 0 when every case passes, 1 otherwise.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIDY = join(ROOT, 'bin', 'tidy');
const CRISP = join(ROOT, '..', 'crisp', 'bin', 'crisp');
const HELLO_FIXTURE = join(ROOT, '..', 'crisp', 'fixtures', 'hello');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    process.stdout.write(`ok   ${name}\n`);
  } else {
    failed++;
    failures.push(name);
    process.stdout.write(`FAIL ${name}${detail ? ` :: ${detail}` : ''}\n`);
  }
}

function runTidy(args) {
  return new Promise((resolve) => {
    const child = spawn('node', [TIDY, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function freshRegistry() {
  return join(mkdtempSync(join(tmpdir(), 'tidy-test-')), 'registry.json');
}

// Build a genuine crisp receipt for the promote tests.
async function genuineReceipt() {
  const dir = mkdtempSync(join(tmpdir(), 'tidy-test-'));
  cpSync(HELLO_FIXTURE, dir, { recursive: true });
  const child = spawn('node', [CRISP, 'package', dir], { cwd: dir });
  const code = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`crisp package failed with ${code}`);
  return join(dir, '.crisp', 'receipt.json');
}

// 1. register creates a stage: pointer, no hashes
{
  const reg = freshRegistry();
  const r = await runTidy(['register', 'hello', '--source', 'exp/hello', '--title', 'Hello', '--registry', reg]);
  check('register/exit 0', r.code === 0, `exit ${r.code}: ${r.stderr}`);
  const entry = JSON.parse(readFileSync(reg, 'utf8')).stages.hello;
  check('register/records pointer', entry && entry.source === 'exp/hello');
  check('register/track exp, not frozen', entry.track === 'exp' && entry.frozen === false);
  check('register/no hashes on a stage', entry.chunks === null);
}

// 2. register refuses bad input
{
  const reg = freshRegistry();
  const badId = await runTidy(['register', 'BAD ID', '--source', 'exp/x', '--registry', reg]);
  check('register/bad id exit 1', badId.code === 1, `exit ${badId.code}`);
  const noSource = await runTidy(['register', 'hello', '--registry', reg]);
  check('register/missing --source exit 1', noSource.code === 1, `exit ${noSource.code}`);
}

// 3. register refuses a duplicate
{
  const reg = freshRegistry();
  await runTidy(['register', 'hello', '--source', 'exp/hello', '--registry', reg]);
  const dup = await runTidy(['register', 'hello', '--source', 'exp/other', '--registry', reg]);
  check('register/duplicate exit 1', dup.code === 1, `exit ${dup.code}: ${dup.stderr}`);
  check('register/duplicate names the stage', /already registered/.test(dup.stderr), dup.stderr.trim());
}

// 4. promote refuses without Sam's hand
{
  const reg = freshRegistry();
  await runTidy(['register', 'hello', '--source', 'exp/hello', '--registry', reg]);
  const receipt = await genuineReceipt();
  const r = await runTidy(['promote', 'hello', '--receipt', receipt, '--registry', reg]);
  check('promote/without --by-sam exit 1', r.code === 1, `exit ${r.code}: ${r.stderr}`);
  check('promote/refusal names the rule', /Sam's hand only/.test(r.stderr), r.stderr.trim());
  const entry = JSON.parse(readFileSync(reg, 'utf8')).stages.hello;
  check('promote/refused leaves stage unfrozen', entry.frozen === false && entry.chunks === null);
}

// 5. promote with --by-sam freezes the receipt's chunk hashes
{
  const reg = freshRegistry();
  await runTidy(['register', 'hello', '--source', 'exp/hello', '--registry', reg]);
  const receipt = await genuineReceipt();
  const receiptJson = JSON.parse(readFileSync(receipt, 'utf8'));
  const r = await runTidy(['promote', 'hello', '--by-sam', '--receipt', receipt, '--registry', reg]);
  check('promote/--by-sam exit 0', r.code === 0, `exit ${r.code}: ${r.stderr}`);
  const entry = JSON.parse(readFileSync(reg, 'utf8')).stages.hello;
  check('promote/track clean and frozen', entry.track === 'clean' && entry.frozen === true);
  check('promote/chunk hashes recorded',
    Array.isArray(entry.chunks) && entry.chunks.length === receiptJson.chunks.length &&
    entry.chunks.every((c, i) => c.sha256 === receiptJson.chunks[i].sha256));
  check('promote/entry chunk recorded', entry.entryChunk === receiptJson.entryChunk);
  check('promote/stamps sam and time', entry.promotedBy === 'sam' && !!entry.promotedAt);
}

// 6. promote refuses unknown stages and bad receipts
{
  const reg = freshRegistry();
  const receipt = await genuineReceipt();
  const ghost = await runTidy(['promote', 'ghost', '--by-sam', '--receipt', receipt, '--registry', reg]);
  check('promote/unknown stage exit 1', ghost.code === 1, `exit ${ghost.code}`);
  const badPath = join(tmpdir(), 'nope.json');
  await runTidy(['register', 'hello', '--source', 'exp/hello', '--registry', reg]);
  const badReceipt = await runTidy(['promote', 'hello', '--by-sam', '--receipt', badPath, '--registry', reg]);
  check('promote/missing receipt exit 1', badReceipt.code === 1, `exit ${badReceipt.code}`);
}

// 7. status shows the registry
{
  const reg = freshRegistry();
  await runTidy(['register', 'hello', '--source', 'exp/hello', '--registry', reg]);
  await runTidy(['register', 'world', '--source', 'exp/world', '--registry', reg]);
  const all = await runTidy(['status', '--registry', reg]);
  check('status/exit 0', all.code === 0, `exit ${all.code}`);
  const list = JSON.parse(all.stdout);
  check('status/lists stages', Array.isArray(list) && list.length === 2);
  const one = await runTidy(['status', 'hello', '--registry', reg]);
  check('status/one stage', JSON.parse(one.stdout).id === 'hello');
  const missing = await runTidy(['status', 'ghost', '--registry', reg]);
  check('status/unknown stage exit 1', missing.code === 1, `exit ${missing.code}`);
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stdout.write(`failed: ${failures.join(', ')}\n`);
  process.exit(1);
}
