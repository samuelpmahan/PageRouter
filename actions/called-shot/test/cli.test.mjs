// End to end, in a repository that is not PageRouter: init, call, grade, pr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const bin = path.resolve(import.meta.dirname, '../bin/called-shots.mjs');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'called-shots-e2e-'));
const run = (args, env = {}) => spawnSync(process.execPath, [bin, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const write = (file, content) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), content); };
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');

// A tiny project: build copies src/ to out/ and writes a manifest.
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test');
write('src/a.txt', 'alpha\n');
write('build.mjs', "import fs from 'node:fs';\nfs.rmSync('out', { recursive: true, force: true });\nfs.mkdirSync('out');\nconst files = fs.readdirSync('src').sort();\nfor (const f of files) fs.copyFileSync(`src/${f}`, `out/${f}`);\nfs.writeFileSync('out/manifest.json', JSON.stringify({ files }) + '\\n');\n");
write('.gitignore', 'out/\n');
git('add', '-A');
git('commit', '-q', '-m', 'project');

const shot = (id, sentence, clauses) => ({ schema: 'called-shot@0', id, call: [{ id: 'S1', text: sentence }], clauses: clauses.map((c, i) => ({ id: `C${i + 1}`, covers: ['S1'], ...c })) });
let base;

test('init writes the configuration, call log, empty predicate set and workflow, and never overwrites', () => {
  const result = run(['init', '--build', 'node build.mjs', '--output', 'out', '--action-ref', '0123abc']);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(read('called-shots.json'));
  assert.deepEqual([config.build, config.output, config.calledDir, config.excludeCalledDir], ['node build.mjs', 'out', 'called-shots', true]);
  assert.equal(read('called-shots/events.jsonl'), '');
  assert.ok(fs.existsSync(path.join(repo, 'called-shots/predicates/sgconfig.yml')));
  assert.match(read('.github/workflows/called-shots.yml'), /uses: samuelpmahan\/PageRouter\/actions\/called-shot@0123abc/);
  const again = run(['init', '--build', 'x', '--output', 'y']);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /init would overwrite: called-shots\.json/);
  git('add', '-A');
  git('commit', '-q', '-m', 'init called shots');
  base = git('rev-parse', 'HEAD');
});

test('a shot called before the change is made when the change does exactly what it says', () => {
  write('add-b.json', JSON.stringify(shot('add-b', 'src/b.txt is added; the output adds b.txt and changes manifest.json only at $.files[1].', [
    { kind: 'source.changedExactly', modified: [], added: ['src/b.txt'], removed: [] },
    { kind: 'output.changedExactly', modified: ['manifest.json'], added: ['b.txt'], removed: [] },
    { kind: 'json.changedPathsExactly', file: 'manifest.json', paths: ['$.files[1]'] },
  ])));
  const called = run(['call', 'add-b.json']);
  assert.equal(called.status, 0, called.stderr);
  fs.rmSync(path.join(repo, 'add-b.json'));
  const recorded = JSON.parse(read('called-shots/add-b.shot.json'));
  assert.equal(recorded.baseline.commit, base);
  assert.match(read('called-shots/events.jsonl'), /"event":"shot.called","shot":"add-b"/);
  write('src/b.txt', 'beta\n');
  const graded = run(['grade', 'called-shots/add-b.shot.json']);
  assert.equal(graded.status, 0, graded.stdout + graded.stderr);
  assert.match(graded.stdout, /^MADE {2}add-b/);
  assert.match(graded.stdout, /output: modified \[manifest\.json\] added \[b\.txt\] removed \[none\]/);
});

test('in a pull request, every added shot is graded; one miss fails the run and is named', () => {
  write('quiet.json', JSON.stringify(shot('quiet', 'Nothing in the output changes.', [
    { kind: 'output.changedExactly', modified: [], added: [], removed: [] },
  ])));
  assert.equal(run(['call', 'quiet.json']).status, 0);
  fs.rmSync(path.join(repo, 'quiet.json'));
  git('add', '-A');
  git('commit', '-q', '-m', 'add b, with two called shots');
  const outputs = path.join(repo, '..', `${path.basename(repo)}-outputs`), summary = path.join(repo, '..', `${path.basename(repo)}-summary`);
  const pr = run(['pr', '--base', base], { GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: summary });
  assert.equal(pr.status, 1, pr.stdout + pr.stderr);
  assert.equal(fs.readFileSync(outputs, 'utf8'), 'made=false\nshots=2\n');
  const text = fs.readFileSync(summary, 'utf8');
  assert.match(text, /\*\*Made\*\*: `called-shots\/add-b\.shot\.json`/);
  assert.match(text, /\*\*Missed\*\*: `called-shots\/quiet\.shot\.json`/);
  assert.match(pr.stdout, /output added: happened but was not called: b\.txt/);
});

test('a pull request that adds no shot passes, unless a shot is required', () => {
  const head = git('rev-parse', 'HEAD');
  assert.equal(run(['pr', '--base', head]).status, 0);
  assert.equal(run(['pr', '--base', head, '--require-shot']).status, 1);
});
