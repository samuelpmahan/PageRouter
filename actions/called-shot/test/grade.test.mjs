import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { grade as gradeShot, validateShot } from '../lib/grade.mjs';
import { runPredicates, ruleFiles } from '../lib/crudlint.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-test-'));
const grade = (file, options) => gradeShot(file, { defaultSourceRoot: 'checkpoint', ...options });
let counter = 0;
function tree(files) {
  const root = path.join(scratch, `t${counter++}`);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}
function shotFile(shot) {
  const file = path.join(scratch, `shot${counter++}.json`);
  fs.writeFileSync(file, JSON.stringify(shot));
  return file;
}
const evidence = report => report.results.flatMap(r => r.evidence).join('\n');

// A miniature of the safePath extraction: the move is right, but the site's
// copy step was hand-kept, so the shipped router imports a file that is not shipped.
const SAFE = 'export function safePath(p) {\n  if (p.includes("..")) throw Error("bad");\n  return p;\n}\n';
const baseSrc = {
  'checkpoint/src/patch.mjs': `const enc = 1;\n${SAFE}export function toBase64(b) { return b; }\n`,
  'checkpoint/src/router.mjs': "import {safePath} from './patch.mjs';\nexport const route = p => safePath(p);\n",
};
const movedSrc = {
  'checkpoint/src/patch.mjs': "import {safePath} from './paths.mjs';\nconst enc = 1;\nexport function toBase64(b) { return b; }\n",
  'checkpoint/src/paths.mjs': SAFE,
  'checkpoint/src/router.mjs': "import {safePath} from './paths.mjs';\nexport const route = p => safePath(p);\n",
};
const extract = {
  schema: 'called-shot@0', id: 'mini-extract',
  call: [
    { id: 'S1', text: 'Move safePath from src/patch.mjs to a new src/paths.mjs, body unchanged.' },
    { id: 'S2', text: 'patch.mjs and router.mjs only change their imports.' },
    { id: 'S3', text: 'The site adds paths.mjs, modifies patch.mjs and router.mjs, and changes nowhere else.' },
  ],
  clauses: [
    { id: 'C1', covers: ['S1'], kind: 'ast.moved', symbol: 'safePath', from: 'src/patch.mjs', to: 'src/paths.mjs', body: 'identical' },
    { id: 'C2', covers: ['S2'], kind: 'ast.onlyImportsChanged', files: ['src/patch.mjs', 'src/router.mjs'], except: ['safePath'] },
    { id: 'C3', covers: ['S3'], kind: 'site.changedExactly', modified: ['patch.mjs', 'router.mjs'], added: ['paths.mjs'], removed: [] },
  ],
};
const siteBase = { 'patch.mjs': baseSrc['checkpoint/src/patch.mjs'], 'router.mjs': baseSrc['checkpoint/src/router.mjs'] };
const siteNaive = { 'patch.mjs': movedSrc['checkpoint/src/patch.mjs'], 'router.mjs': movedSrc['checkpoint/src/router.mjs'] };
const siteCalled = { ...siteNaive, 'paths.mjs': SAFE };

test('the naive extraction misses on the shipped site and names the missing file', async () => {
  const report = await grade(shotFile(extract), { baseline: tree(baseSrc), candidate: tree(movedSrc), baselineOutput: tree(siteBase), candidateOutput: tree(siteNaive) });
  assert.equal(report.made, false);
  assert.deepEqual(report.results.map(r => [r.id, r.pass]), [['C1', true], ['C2', true], ['C3', false]]);
  assert.match(evidence(report), /output added: called but did not happen: paths\.mjs/);
  assert.match(evidence(report), /safePath: src\/patch\.mjs lines 2-5 → src\/paths\.mjs lines 1-4, text identical/);
});

test('the same move shipped as called is made', async () => {
  const report = await grade(shotFile(extract), { baseline: tree(baseSrc), candidate: tree(movedSrc), baselineOutput: tree(siteBase), candidateOutput: tree(siteCalled) });
  assert.equal(report.made, true, evidence(report));
  assert.equal(report.precheck.pass, true);
});

test('a moved function whose body changed is a miss', async () => {
  const edited = { ...movedSrc, 'checkpoint/src/paths.mjs': SAFE.replace('"bad"', '"unsafe path"') };
  const report = await grade(shotFile(extract), { baseline: tree(baseSrc), candidate: tree(edited), baselineOutput: tree(siteBase), candidateOutput: tree(siteCalled) });
  assert.equal(report.results[0].pass, false);
  assert.match(report.results[0].evidence.join('\n'), /text differs between src\/patch\.mjs lines 2-5 and src\/paths\.mjs lines 1-4/);
});

test('a shot already true on the baseline fails the precheck', async () => {
  const trivial = { ...extract, id: 'trivial', clauses: [{ id: 'C1', covers: ['S1', 'S2', 'S3'], kind: 'site.changedExactly', modified: [], added: [], removed: [] }] };
  const site = tree(siteBase);
  const report = await grade(shotFile(trivial), { baseline: tree(baseSrc), candidate: tree(baseSrc), baselineOutput: site, candidateOutput: site });
  assert.equal(report.results[0].pass, true);
  assert.equal(report.precheck.pass, false);
  assert.equal(report.made, false);
});

test('a sentence without a clause, or a clause of unknown kind, is rejected before grading', () => {
  const problems = validateShot({ call: [{ id: 'S1', text: 'a' }, { id: 'S2', text: 'b' }], clauses: [{ id: 'C1', covers: ['S1'], kind: 'vibes.good' }] });
  assert.deepEqual(problems, ['clause C1 has unknown kind vibes.good', 'sentence S2 has no clause checking it']);
});

test('a shot whose hash was never logged as called is not made', async () => {
  const events = path.join(scratch, 'events.jsonl');
  fs.writeFileSync(events, JSON.stringify({ event: 'shot.called', shot: 'other', sha256: '0'.repeat(64), at: '2026-10-12T00:00:00Z' }) + '\n');
  const report = await grade(shotFile(extract), { baseline: tree(baseSrc), candidate: tree(movedSrc), baselineOutput: tree(siteBase), candidateOutput: tree(siteCalled), events });
  assert.equal(report.made, false);
  assert.match(report.problems[0], /it was not called/);
  const file = shotFile(extract);
  fs.appendFileSync(events, JSON.stringify({ event: 'shot.called', shot: 'mini-extract', sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), at: '2026-10-12T00:00:01Z' }) + '\n');
  const called = await grade(file, { baseline: tree(baseSrc), candidate: tree(movedSrc), baselineOutput: tree(siteBase), candidateOutput: tree(siteCalled), events });
  assert.equal(called.made, true);
  assert.equal(called.called.at, '2026-10-12T00:00:01Z');
});

test('text.onlyLinesAdded counts added lines and rejects a changed line', async () => {
  const base = tree({ 'w.yml': 'a\nb\nc\n' });
  const shot = n => ({ id: 'text', sourceRoot: '.', call: [{ id: 'S1', text: 'x' }], clauses: [{ id: 'C1', covers: ['S1'], kind: 'text.onlyLinesAdded', files: ['w.yml'], lines: n }] });
  const added = await grade(shotFile(shot(2)), { baseline: base, candidate: tree({ 'w.yml': 'a\nnew1\nnew2\nb\nc\n' }) });
  assert.equal(added.made, true, evidence(added));
  assert.match(evidence(added), /w\.yml: 2 lines added \(candidate lines 2-3\), called 2/);
  const edited = await grade(shotFile(shot(1)), { baseline: base, candidate: tree({ 'w.yml': 'a\nB\nc\nd\n' }) });
  assert.equal(edited.made, false);
  assert.match(evidence(edited), /baseline line 2 was changed or removed/);
});

test('json.changedPathsExactly names a path that changed without being called', async () => {
  const shot = { id: 'json', call: [{ id: 'S1', text: 'only the id' }], clauses: [{ id: 'C1', covers: ['S1'], kind: 'json.changedPathsExactly', file: 'c.json', paths: ['$.release.id'] }] };
  const report = await grade(shotFile(shot), { baseline: tree({}), candidate: tree({}),
    baselineOutput: tree({ 'c.json': '{"release":{"id":1,"n":1}}' }), candidateOutput: tree({ 'c.json': '{"release":{"id":2,"n":2}}' }) });
  assert.equal(report.made, false);
  assert.match(evidence(report), /changed but was not called: \$\.release\.n/);
});

test('with no predicate set configured, crudlint finds nothing', () => {
  assert.deepEqual(ruleFiles(null), []);
  assert.deepEqual(runPredicates(tree({ 'src/a.mjs': 'console.log(1);\n' })), []);
});

test('json.valueEquals checks a value in the candidate output, and site is an older name for output', async () => {
  const shot = value => ({ id: 'value', call: [{ id: 'S1', text: 'x' }], clauses: [
    { id: 'C1', covers: ['S1'], kind: 'json.valueEquals', file: 'c.json', path: '$.release.id', value },
    { id: 'C2', covers: ['S1'], kind: 'site.changedExactly', modified: ['c.json'], added: [], removed: [] }] });
  const sides = { baseline: tree({}), candidate: tree({}), baselineOutput: tree({ 'c.json': '{"release":{"id":"a"}}' }), candidateOutput: tree({ 'c.json': '{"release":{"id":"b"}}' }) };
  const made = await grade(shotFile(shot('b')), sides);
  assert.equal(made.made, true, evidence(made));
  assert.match(evidence(made), /c\.json \$\.release\.id is "b"/);
  const missed = await grade(shotFile(shot('c')), sides);
  assert.match(evidence(missed), /c\.json \$\.release\.id is "b", called "c"/);
});

test('a findings clause names the exact finding that appeared', async () => {
  // A throwaway predicate set: the shipped one stays empty.
  const config = tree({
    'sgconfig.yml': 'ruleDirs:\n  - rules\n',
    'rules/no-console-log.yml': 'id: no-console-log\nlanguage: JavaScript\nseverity: warning\nmessage: console.log left in source\nrule:\n  pattern: console.log($$$ARGS)\n',
  });
  const base = tree({ 'checkpoint/src/a.mjs': 'export const a = 1;\n' });
  const cand = tree({ 'checkpoint/src/a.mjs': 'export const a = 1;\nconsole.log(a);\n' });
  fs.cpSync(config, path.join(cand, 'checkpoint/predicates'), { recursive: true });
  fs.cpSync(config, path.join(base, 'checkpoint/predicates'), { recursive: true });
  const shot = added => ({ id: 'findings', call: [{ id: 'S1', text: 'x' }], clauses: [{ id: 'C1', covers: ['S1'], kind: 'crudlint.findingsChangedExactly', config: 'predicates', src: ['src'], added, removed: [] }] });
  const quiet = await grade(shotFile(shot([])), { baseline: base, candidate: cand });
  assert.equal(quiet.made, false);
  assert.match(evidence(quiet), /finding appeared but was not called: no-console-log at src\/a\.mjs:2 \[console\.log\(a\)\]/);
  const called = await grade(shotFile(shot([{ rule: 'no-console-log', file: 'src/a.mjs' }])), { baseline: base, candidate: cand });
  assert.equal(called.made, true, evidence(called));
});

test('except can name a const: removing a const copy and importing it is made', async () => {
  const base = tree({ 'v.mjs': "const $ = id => id;\nconst esc = s => String(s ?? '').replace(/&/g, '&amp;');\nexport const view = x => esc(x);\n" });
  const cand = tree({ 'v.mjs': "import {esc} from './html.mjs';\nconst $ = id => id;\nexport const view = x => esc(x);\n" });
  const shot = { id: 'const', sourceRoot: '.', call: [{ id: 'S1', text: 'x' }], clauses: [{ id: 'C1', covers: ['S1'], kind: 'ast.onlyImportsChanged', files: ['v.mjs'], except: ['esc'] }] };
  const report = await gradeShot(shotFile(shot), { baseline: base, candidate: cand });
  assert.equal(report.results[0].pass, true, evidence(report));
});

test('except drops only the named declarator: a change to its neighbor still misses', async () => {
  const base = tree({ 'v.mjs': "const $ = id => id, esc = s => s;\nexport const view = x => esc(x);\n" });
  const removed = tree({ 'v.mjs': "import {esc} from './html.mjs';\nconst $ = id => id;\nexport const view = x => esc(x);\n" });
  const touched = tree({ 'v.mjs': "import {esc} from './html.mjs';\nconst $ = id => id.trim();\nexport const view = x => esc(x);\n" });
  const shot = { id: 'neighbor', sourceRoot: '.', call: [{ id: 'S1', text: 'x' }], clauses: [{ id: 'C1', covers: ['S1'], kind: 'ast.onlyImportsChanged', files: ['v.mjs'], except: ['esc'] }] };
  assert.equal((await gradeShot(shotFile(shot), { baseline: base, candidate: removed })).results[0].pass, true);
  const missed = await gradeShot(shotFile(shot), { baseline: base, candidate: touched });
  assert.equal(missed.results[0].pass, false);
  assert.match(evidence(missed), /v\.mjs: statement 1 other than imports differs/);
});

test('ast.moved follows a const arrow function, ignoring an export prefix, and still checks the body', async () => {
  const base = tree({ 'a.mjs': "export const esc = s => String(s ?? '');\n" });
  const same = tree({ 'a.mjs': "import {esc} from './k.mjs';\nexport {esc};\n", 'k.mjs': "// kernel\nconst esc = s => String(s ?? '');\nexport {esc};\n" });
  const edited = tree({ 'a.mjs': "import {esc} from './k.mjs';\nexport {esc};\n", 'k.mjs': "const esc = s => String(s);\nexport {esc};\n" });
  const shot = { id: 'moved-const', sourceRoot: '.', call: [{ id: 'S1', text: 'x' }], clauses: [{ id: 'C1', covers: ['S1'], kind: 'ast.moved', symbol: 'esc', from: 'a.mjs', to: 'k.mjs', body: 'identical' }] };
  const made = await gradeShot(shotFile(shot), { baseline: base, candidate: same });
  assert.equal(made.results[0].pass, true, evidence(made));
  assert.match(evidence(made), /esc: a\.mjs line 1 → k\.mjs line 2, text identical/);
  const missed = await gradeShot(shotFile(shot), { baseline: base, candidate: edited });
  assert.equal(missed.results[0].pass, false);
});
