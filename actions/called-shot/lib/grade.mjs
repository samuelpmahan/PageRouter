// Grade a called shot. Every verdict is computed, not judged, and every line
// of evidence names a file, a line range, a statement or a JSON path.
//
// Trees are repository roots. A shot's sourceRoot (the configured default
// when absent) is the directory its source paths are relative to. Outputs are
// the built directories the configuration names, for the baseline and the
// candidate. "site" in clause kinds is an older name for "output".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runPredicates, ruleFiles } from './crudlint.mjs';

const require = createRequire(import.meta.url);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const SKIP = new Set(['.git', 'node_modules', '.bazel-tools']);

// ------------------------------------------------------------ syntax trees
let parsers = null;
async function loadParsers() {
  if (parsers) return parsers;
  const Parser = require('web-tree-sitter');
  await Parser.init();
  const wasm = name => require.resolve(`tree-sitter-wasms/out/tree-sitter-${name}.wasm`);
  const languages = {};
  for (const [key, name] of [['js', 'javascript'], ['ts', 'typescript'], ['tsx', 'tsx']]) languages[key] = await Parser.Language.load(wasm(name));
  parsers = { Parser, languages };
  return parsers;
}
function parse(file) {
  const { Parser, languages } = parsers;
  const parser = new Parser();
  parser.setLanguage(file.endsWith('.tsx') ? languages.tsx : /\.[cm]?ts$/.test(file) ? languages.ts : languages.js);
  return parser.parse(fs.readFileSync(file, 'utf8')).rootNode;
}
const where = node => node.startPosition.row === node.endPosition.row ? `line ${node.startPosition.row + 1}` : `lines ${node.startPosition.row + 1}-${node.endPosition.row + 1}`;
const declarationOf = statement => statement.type === 'export_statement' ? statement.childForFieldName('declaration') : statement;
function findFunction(root, name) {
  for (const statement of root.namedChildren) {
    const decl = declarationOf(statement);
    if (decl?.type === 'function_declaration' && decl.childForFieldName('name')?.text === name) return statement;
  }
  return null;
}
const declaredName = statement => declarationOf(statement)?.childForFieldName?.('name')?.text ?? null;

// ------------------------------------------------------------ files
// Source files are what git counts as the repository: tracked files plus
// untracked ones that are not ignored. Build output in an ignored directory is
// not source. A directory outside git is walked whole, minus SKIP.
function gitFiles(root) {
  const inside = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') return null;
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (listed.status !== 0) return null;
  return [...new Set(listed.stdout.split('\0').filter(Boolean))].sort();
}
function listTree(root, excluded = []) {
  const out = new Map();
  if (!fs.existsSync(root)) return out;
  const skipped = new Set(excluded.map(p => path.resolve(p)));
  const tracked = gitFiles(root);
  if (tracked) {
    for (const rel of tracked) {
      const full = path.join(root, rel);
      if ([...skipped].some(s => path.resolve(full) === s || path.resolve(full).startsWith(s + path.sep))) continue;
      if (fs.existsSync(full) && fs.lstatSync(full).isFile()) out.set(rel, sha(fs.readFileSync(full)));
    }
    return out;
  }
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (SKIP.has(name) || name.startsWith('bazel-')) continue;
      const full = path.join(dir, name), r = rel ? `${rel}/${name}` : name;
      if (skipped.has(path.resolve(full))) continue;
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) walk(full, r);
      else if (stat.isFile()) out.set(r, sha(fs.readFileSync(full)));
    }
  };
  walk(root, '');
  return out;
}
function changes(before, after) {
  const modified = [], added = [], removed = [];
  for (const [p, h] of after) { if (!before.has(p)) added.push(p); else if (before.get(p) !== h) modified.push(p); }
  for (const p of before.keys()) if (!after.has(p)) removed.push(p);
  return { modified, added, removed };
}
function compareSet(expected, actual) {
  return { missing: expected.filter(p => !actual.includes(p)), unexpected: actual.filter(p => !expected.includes(p)) };
}
function jsonPaths(a, b, at = '$', out = []) {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(at); return out; }
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) jsonPaths(a[key], b[key], Array.isArray(a) ? `${at}[${key}]` : `${at}.${key}`, out);
  return out;
}

// ------------------------------------------------------------ clause kinds
// Each takes (clause, sides) where sides = {base, cand, baseOut, candOut, predicates}
// and returns {pass, evidence: [plain sentences]}.
function setVerdict(label, clause, actual) {
  const evidence = [];
  for (const kind of ['modified', 'added', 'removed']) {
    const { missing, unexpected } = compareSet(clause[kind] ?? [], actual[kind]);
    for (const p of missing) evidence.push(`${label} ${kind}: called but did not happen: ${p}`);
    for (const p of unexpected) evidence.push(`${label} ${kind}: happened but was not called: ${p}`);
  }
  const pass = evidence.length === 0;
  if (pass) evidence.push(`${label}: modified [${actual.modified.join(', ') || 'none'}] added [${actual.added.join(', ') || 'none'}] removed [${actual.removed.join(', ') || 'none'}]`);
  return { pass, evidence };
}
const findingKey = f => `${f.rule}  ${f.file}  ${f.snippet ?? ''}`;

export const CLAUSES = {
  'ast.moved'(c, s) {
    const evidence = [];
    const at = (side, file) => fs.existsSync(path.join(side, file)) ? findFunction(parse(path.join(side, file)), c.symbol) : null;
    const fromBase = at(s.base, c.from), toBase = at(s.base, c.to), toCand = at(s.cand, c.to), fromCand = at(s.cand, c.from);
    if (!fromBase) evidence.push(`${c.symbol} is not declared in the baseline ${c.from}`);
    if (toBase) evidence.push(`${c.symbol} is already declared in the baseline ${c.to} (${where(toBase)})`);
    if (!toCand) evidence.push(`${c.symbol} is not declared in ${c.to}`);
    if (fromCand) evidence.push(`${c.symbol} is still declared in ${c.from} (${where(fromCand)})`);
    let same = true;
    if (fromBase && toCand) {
      same = c.body !== 'identical' || fromBase.text === toCand.text;
      evidence.push(same
        ? `${c.symbol}: ${c.from} ${where(fromBase)} → ${c.to} ${where(toCand)}, text identical (sha256 ${sha(toCand.text).slice(0, 12)})`
        : `${c.symbol}: text differs between ${c.from} ${where(fromBase)} and ${c.to} ${where(toCand)}`);
    }
    return { pass: !!fromBase && !toBase && !!toCand && !fromCand && same, evidence };
  },
  'ast.onlyImportsChanged'(c, s) {
    const evidence = [];
    let pass = true;
    for (const file of c.files) {
      const roots = [s.base, s.cand].map(side => parse(path.join(side, file)));
      const rest = root => root.namedChildren.filter(n => n.type !== 'import_statement' && n.type !== 'comment' && !(c.except ?? []).includes(declaredName(n)));
      const imports = root => root.namedChildren.filter(n => n.type === 'import_statement').map(n => n.text);
      const [a, b] = roots.map(rest);
      const i = a.findIndex((n, k) => n.text !== b[k]?.text);
      if (a.length !== b.length || i >= 0) {
        pass = false;
        const k = i >= 0 ? i : Math.min(a.length, b.length);
        evidence.push(`${file}: statement ${k + 1} other than imports differs (baseline ${a[k] ? where(a[k]) : 'none'}, candidate ${b[k] ? where(b[k]) : 'none'})`);
      } else {
        const [ia, ib] = roots.map(imports);
        const gone = ia.filter(x => !ib.includes(x)).map(x => `−[${x}]`), came = ib.filter(x => !ia.includes(x)).map(x => `+[${x}]`);
        evidence.push(`${file}: ${a.length} other statements identical; imports ${[...gone, ...came].join(' ') || 'unchanged'}`);
      }
    }
    return { pass, evidence };
  },
  'source.changedExactly'(c, s) { return setVerdict('source', c, changes(listTree(s.base, s.baseExclude), listTree(s.cand, s.candExclude))); },
  'output.changedExactly'(c, s) {
    if (!s.baseOut || !s.candOut) return { pass: false, evidence: ['an output clause needs the baseline and candidate outputs'] };
    return setVerdict('output', c, changes(listTree(s.baseOut), listTree(s.candOut)));
  },
  'json.changedPathsExactly'(c, s) {
    const dir = c.in === 'source' ? [s.base, s.cand] : [s.baseOut, s.candOut];
    const [a, b] = dir.map(d => JSON.parse(fs.readFileSync(path.join(d, c.file), 'utf8')));
    const actual = jsonPaths(a, b), { missing, unexpected } = compareSet(c.paths, actual);
    return {
      pass: !missing.length && !unexpected.length,
      evidence: [`${c.file} changed at: ${actual.join(', ') || 'nothing'}`,
        ...missing.map(p => `called but did not change: ${p}`), ...unexpected.map(p => `changed but was not called: ${p}`)],
    };
  },
  'json.valueEquals'(c, s) {
    const dir = c.in === 'source' ? s.cand : s.candOut;
    const file = path.join(dir ?? '', c.file);
    if (!dir || !fs.existsSync(file)) return { pass: false, evidence: [`${c.file} is missing from the candidate ${c.in === 'source' ? 'tree' : 'output'}`] };
    let value = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of c.path.replace(/^\$\.?/, '').split('.').filter(Boolean)) value = value?.[key];
    const pass = JSON.stringify(value) === JSON.stringify(c.value);
    return { pass, evidence: [`${c.file} ${c.path} is ${JSON.stringify(value)}${pass ? '' : `, called ${JSON.stringify(c.value)}`}`] };
  },
  'text.onlyLinesAdded'(c, s) {
    const evidence = [];
    let pass = true;
    for (const file of c.files) {
      const [a, b] = [s.base, s.cand].map(side => fs.existsSync(path.join(side, file)) ? fs.readFileSync(path.join(side, file), 'utf8').split('\n') : null);
      if (!a || !b) { pass = false; evidence.push(`${file}: missing on the ${a ? 'candidate' : 'baseline'} side`); continue; }
      const added = [];
      let i = 0;
      for (let j = 0; j < b.length; j++) { if (i < a.length && b[j] === a[i]) i++; else added.push(j + 1); }
      if (i < a.length) { pass = false; evidence.push(`${file}: baseline line ${i + 1} was changed or removed`); continue; }
      if (added.length !== c.lines) pass = false;
      const span = added.length ? `candidate lines ${added[0]}-${added.at(-1)}` : 'none';
      evidence.push(`${file}: ${added.length} lines added (${span}), called ${c.lines}; no baseline line changed`);
    }
    return { pass, evidence };
  },
  'crudlint.findingsChangedExactly'(c, s) {
    const configDir = c.config ? path.join(s.cand, c.config) : s.predicates;
    const rules = ruleFiles(configDir);
    const [a, b] = [s.base, s.cand].map(side => runPredicates(side, { src: c.src ?? ['src'], configDir }));
    const keysA = new Set(a.map(findingKey)), keysB = new Set(b.map(findingKey));
    const removed = a.filter(f => !keysB.has(findingKey(f))), added = b.filter(f => !keysA.has(findingKey(f)));
    const label = f => `${f.rule} at ${f.file}:${f.line}${f.endLine !== f.line ? `-${f.endLine}` : ''} [${f.snippet}]`;
    const match = (want, got) => got.filter(f => !want.some(w => w.rule === f.rule && w.file === f.file && (!w.snippet || w.snippet === f.snippet)));
    const unexpectedAdded = match(c.added ?? [], added), unexpectedRemoved = match(c.removed ?? [], removed);
    const missingAdded = (c.added ?? []).filter(w => !added.some(f => w.rule === f.rule && w.file === f.file)), missingRemoved = (c.removed ?? []).filter(w => !removed.some(f => w.rule === f.rule && w.file === f.file));
    const evidence = [`predicate set: ${rules.length} rules; baseline ${a.length} findings, candidate ${b.length}`,
      ...unexpectedAdded.map(f => `finding appeared but was not called: ${label(f)}`),
      ...unexpectedRemoved.map(f => `finding disappeared but was not called: ${label(f)}`),
      ...missingAdded.map(w => `called to appear but did not: ${w.rule} in ${w.file}`),
      ...missingRemoved.map(w => `called to disappear but did not: ${w.rule} in ${w.file}`)];
    const pass = !unexpectedAdded.length && !unexpectedRemoved.length && !missingAdded.length && !missingRemoved.length;
    if (pass) evidence.push(`findings added [${added.map(label).join('; ') || 'none'}] removed [${removed.map(label).join('; ') || 'none'}]`);
    return { pass, evidence };
  },
};
CLAUSES['site.changedExactly'] = CLAUSES['output.changedExactly'];

// ------------------------------------------------------------ the shot
export function validateShot(shot) {
  const problems = [];
  const sentences = new Map((shot.call ?? []).map(x => [x.id, x]));
  const clauseIds = new Set();
  if (!sentences.size) problems.push('the call has no sentences');
  for (const clause of shot.clauses ?? []) {
    if (clauseIds.has(clause.id)) problems.push(`clause id ${clause.id} is used twice`);
    clauseIds.add(clause.id);
    if (!CLAUSES[clause.kind]) problems.push(`clause ${clause.id} has unknown kind ${clause.kind}`);
    if (!clause.covers?.length) problems.push(`clause ${clause.id} covers no sentence`);
    for (const id of clause.covers ?? []) if (!sentences.has(id)) problems.push(`clause ${clause.id} covers ${id}, which is not a sentence of the call`);
  }
  for (const id of sentences.keys()) if (!(shot.clauses ?? []).some(c => c.covers?.includes(id))) problems.push(`sentence ${id} has no clause checking it`);
  return problems;
}

// exclude: repository-relative paths left out of source comparisons (the call records, when configured).
export async function grade(shotFile, { baseline, candidate, baselineOutput, candidateOutput, events, defaultSourceRoot = '.', predicates = null, exclude = [] }) {
  await loadParsers();
  const bytes = fs.readFileSync(shotFile), shot = JSON.parse(bytes), shotSha = sha(bytes);
  const root = shot.sourceRoot ?? defaultSourceRoot;
  const sides = { base: path.join(baseline, root), cand: path.join(candidate, root), baseOut: baselineOutput, candOut: candidateOutput, predicates,
    baseExclude: exclude.map(p => path.join(baseline, p)), candExclude: exclude.map(p => path.join(candidate, p)) };
  const report = { shot: shot.id, shotSha256: shotSha, sourceRoot: root, problems: validateShot(shot), called: null, precheck: null, results: [] };
  if (events) {
    const logged = fs.readFileSync(events, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      .find(e => e.event === 'shot.called' && e.sha256 === shotSha);
    report.called = logged ? { at: logged.at } : null;
    if (!logged) report.problems.push(`no shot.called event in ${path.basename(events)} has this shot's sha256; it was not called`);
  }
  if (report.problems.length) return { ...report, made: false };
  report.results = shot.clauses.map(c => ({ id: c.id, kind: c.kind, covers: c.covers, ...CLAUSES[c.kind](c, sides) }));
  // The ball must not already be in the pocket: graded against itself, the
  // baseline has to miss at least one clause.
  const self = { ...sides, cand: sides.base, candOut: sides.baseOut, candExclude: sides.baseExclude };
  const alreadyMade = shot.clauses.filter(c => CLAUSES[c.kind](c, self).pass).map(c => c.id);
  report.precheck = { pass: alreadyMade.length < shot.clauses.length, clausesTrueOnBaseline: alreadyMade };
  return { ...report, made: report.precheck.pass && report.results.every(r => r.pass) };
}

export function renderReport(report, shot) {
  const lines = [`${report.made ? 'MADE' : 'MISSED'}  ${report.shot}  (shot sha256 ${report.shotSha256.slice(0, 12)}${report.called ? `, called ${report.called.at}` : ''})`];
  for (const problem of report.problems) lines.push(`  problem: ${problem}`);
  for (const sentence of shot.call ?? []) lines.push(`  ${sentence.id}  ${sentence.text}`);
  for (const r of report.results) {
    lines.push(`  ${r.pass ? 'made  ' : 'missed'} ${r.id} ${r.kind} (covers ${r.covers.join(', ')})`);
    for (const e of r.evidence) lines.push(`         ${e}`);
  }
  if (report.precheck) lines.push(report.precheck.pass
    ? `  precheck: the baseline misses at least one clause (true on baseline: ${report.precheck.clausesTrueOnBaseline.join(', ') || 'none'})`
    : '  precheck failed: every clause is already true on the baseline; the ball was already in the pocket');
  return lines.join('\n');
}
