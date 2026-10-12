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

test('each shot is graded at its own commits, also under a pull request merge commit', () => {
  const base2 = git('rev-parse', 'HEAD');
  for (const letter of ['c', 'd']) {
    write(`add-${letter}.json`, JSON.stringify(shot(`add-${letter}`, `src/${letter}.txt is added; the output adds ${letter}.txt and changes manifest.json.`, [
      { kind: 'source.changedExactly', modified: [], added: [`src/${letter}.txt`], removed: [] },
      { kind: 'output.changedExactly', modified: ['manifest.json'], added: [`${letter}.txt`], removed: [] },
    ])));
    assert.equal(run(['call', `add-${letter}.json`]).status, 0);
    fs.rmSync(path.join(repo, `add-${letter}.json`));
    write(`src/${letter}.txt`, `${letter}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `add ${letter}`);
  }
  const feature = git('rev-parse', 'HEAD');
  // As on pull_request: HEAD is a merge whose first parent is the base.
  git('checkout', '-q', '--detach', base2);
  git('merge', '-q', '--no-ff', '--no-edit', feature);
  const outputs = path.join(repo, '..', `${path.basename(repo)}-outputs2`);
  const pr = run(['pr', '--base', base2], { GITHUB_OUTPUT: outputs });
  assert.equal(pr.status, 0, pr.stdout + pr.stderr);
  assert.equal(fs.readFileSync(outputs, 'utf8'), 'made=true\nshots=2\n');
  assert.match(pr.stderr, /called-shots\/add-c\.shot\.json: graded at [0-9a-f]{12}, the last commit with this shot and no other shot.s change/);
  // Graded at HEAD instead, the first shot sees the second shot's change and misses.
  const atHead = run(['grade', 'called-shots/add-c.shot.json']);
  assert.equal(atHead.status, 1);
  assert.match(atHead.stdout, /source added: happened but was not called: src\/d\.txt/);
});

test('lanes merged as branches: each shot is graded at the head of its own lane', () => {
  const base3 = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'integration');
  for (const letter of ['e', 'f']) {
    git('checkout', '-q', '-b', `lane-${letter}`, base3);
    write(`add-${letter}.json`, JSON.stringify(shot(`add-${letter}`, `src/${letter}.txt is added; the output adds ${letter}.txt and changes manifest.json.`, [
      { kind: 'source.changedExactly', modified: [], added: [`src/${letter}.txt`], removed: [] },
      { kind: 'output.changedExactly', modified: ['manifest.json'], added: [`${letter}.txt`], removed: [] },
    ])));
    assert.equal(run(['call', `add-${letter}.json`]).status, 0);
    fs.rmSync(path.join(repo, `add-${letter}.json`));
    write(`src/${letter}.txt`, `${letter}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `lane ${letter}`);
  }
  git('checkout', '-q', 'integration');
  // Both lanes appended to the call log; keep both lines, as merge=union would.
  for (const letter of ['e', 'f']) {
    const merged = spawnSync('git', ['merge', '-q', '--no-ff', '--no-edit', `lane-${letter}`], { cwd: repo, encoding: 'utf8' });
    if (merged.status !== 0) {
      const lines = new Set();
      for (const side of ['HEAD', `lane-${letter}`]) for (const l of git('show', `${side}:called-shots/events.jsonl`).split('\n')) if (l) lines.add(l);
      write('called-shots/events.jsonl', [...lines].join('\n') + '\n');
      git('add', '-A');
      git('commit', '-q', '--no-edit');
    }
  }
  const integration = git('rev-parse', 'HEAD');
  git('checkout', '-q', '--detach', base3);
  git('merge', '-q', '--no-ff', '--no-edit', integration);
  const pr = run(['pr', '--base', base3]);
  assert.equal(pr.status, 0, pr.stdout + pr.stderr);
  for (const letter of ['e', 'f']) {
    assert.match(pr.stderr, new RegExp(`add-${letter}\\.shot\\.json: graded at ${git('rev-parse', `lane-${letter}`).slice(0, 12)}`));
    assert.match(pr.stdout, new RegExp(`MADE {2}add-${letter}`));
  }
});

test('a missed shot superseded by a made one is reported, warned, and does not fail the run', () => {
  const base4 = git('rev-parse', 'HEAD');
  write('wrong.json', JSON.stringify(shot('wrong', 'Nothing in the output changes.', [{ kind: 'output.changedExactly', modified: [], added: [], removed: [] }])));
  assert.equal(run(['call', 'wrong.json']).status, 0);
  write('right.json', JSON.stringify(shot('right', 'The output adds g.txt and changes manifest.json.', [{ kind: 'output.changedExactly', modified: ['manifest.json'], added: ['g.txt'], removed: [] }])));
  assert.equal(run(['call', 'right.json']).status, 0);
  for (const f of ['wrong.json', 'right.json']) fs.rmSync(path.join(repo, f));
  write('src/g.txt', 'g\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'add g, with a wrong call and its replacement');
  assert.equal(run(['pr', '--base', base4]).status, 1, 'unsuperseded, the miss fails the run');
  assert.equal(run(['supersede', 'right', '--by', 'wrong', '--reason', 'x']).status, 2, 'only a later call can supersede');
  assert.equal(run(['supersede', 'wrong', '--by', 'right', '--reason', 'the output does change: g.txt is shipped']).status, 0);
  git('add', '-A');
  git('commit', '-q', '-m', 'supersede wrong');
  const summary = path.join(repo, '..', `${path.basename(repo)}-summary4`), outputs = path.join(repo, '..', `${path.basename(repo)}-outputs4`);
  const pr = run(['pr', '--base', base4], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: outputs });
  assert.equal(pr.status, 0, pr.stdout + pr.stderr);
  assert.equal(fs.readFileSync(outputs, 'utf8'), 'made=true\nshots=2\n');
  assert.match(fs.readFileSync(summary, 'utf8'), /\*\*Missed, superseded by `right`\*\*: `called-shots\/wrong\.shot\.json`/);
  assert.match(pr.stdout, /^::warning file=called-shots\/wrong\.shot\.json,title=Called shot missed, superseded by right: wrong::superseded by right: the output does change/m);
  assert.match(pr.stdout, /^::notice file=called-shots\/right\.shot\.json,title=Called shot made: right/m);
});
