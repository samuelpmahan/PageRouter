// crudlint predicate runner: ast-grep rules in, crudlint findings out.
//
// A repository's predicate set is a directory in crudlint's layout
// (sgconfig.yml, rules/, utils/, rule-tests/), named by "predicates" in
// called-shots.json, so crudlint rule files drop in unchanged. With none
// configured the set is empty and finds nothing.
//
// Finding shape is crudlint's: {rule, layer, tool, file, line, endLine,
// message, caseIds, snippet}, file relative to the project root with forward
// slashes. Supported rule metadata: role: detector (never reported) and
// role: smell with requires: [detector ids] (reported only when every listed
// detector has a hit, and never inside a detector's own range). Rules that
// use crudlint's grouping metadata (group, collapse) are refused rather than
// silently reported per hit.
//
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__)\/|\.(test|spec)\.[cm]?[tj]sx?$/;

export function ruleFiles(configDir) {
  if (!configDir) return [];
  const dir = path.join(configDir, 'rules');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => /\.ya?ml$/.test(name)).sort();
}

function astGrepBinary() {
  const exe = process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep';
  const cli = path.dirname(require.resolve('@ast-grep/cli/package.json'));
  if (fs.existsSync(path.join(cli, exe))) return path.join(cli, exe);
  // Installed with scripts disabled: the binary is still in the platform package.
  const platform = { 'linux-x64': 'linux-x64-gnu', 'linux-arm64': 'linux-arm64-gnu', 'darwin-x64': 'darwin-x64',
    'darwin-arm64': 'darwin-arm64', 'win32-x64': 'win32-x64-msvc', 'win32-arm64': 'win32-arm64-msvc' }[`${process.platform}-${process.arch}`];
  if (!platform) throw Error(`No ast-grep binary for ${process.platform}-${process.arch}`);
  return path.join(path.dirname(require.resolve(`@ast-grep/cli-${platform}/package.json`, { paths: [cli] })), exe);
}

function finding(rule, file, line, endLine, message, snippet) {
  return { rule, layer: 2, tool: 'ast-grep', file, line, endLine, message, caseIds: [], snippet: String(snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) };
}

export function runPredicates(projectRoot, { src = ['src'], configDir = null } = {}) {
  if (!ruleFiles(configDir).length) return [];
  const root = path.resolve(projectRoot);
  const targets = src.map(dir => path.join(root, dir)).filter(dir => fs.existsSync(dir));
  if (!targets.length) return [];
  const run = spawnSync(astGrepBinary(), ['scan', '--json=compact', '--include-metadata', ...targets],
    { cwd: configDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error || !run.stdout.trim()) throw Error(`ast-grep scan failed: ${run.error?.message ?? run.stderr.slice(0, 500)}`);
  const hits = new Map();
  for (const hit of JSON.parse(run.stdout)) {
    const file = path.relative(root, path.resolve(configDir, hit.file)).split(path.sep).join('/');
    if (TEST_PATH.test(file)) continue;
    const metadata = hit.metadata ?? {};
    if (metadata.group || metadata.collapse) throw Error(`Rule ${hit.ruleId} uses crudlint grouping (${metadata.group ? 'group' : 'collapse'}), which this runner does not implement`);
    if (!hits.has(hit.ruleId)) hits.set(hit.ruleId, []);
    hits.get(hit.ruleId).push({ ...hit, file, metadata });
  }
  const findings = [];
  for (const [rule, list] of hits) {
    const metadata = list[0].metadata;
    if (metadata.role === 'detector') continue;
    const requires = metadata.requires ?? [];
    if (requires.some(id => !hits.has(id))) continue;
    const helperRanges = requires.flatMap(id => hits.get(id).map(h => [h.file, h.range.byteOffset.start, h.range.byteOffset.end]));
    for (const hit of list) {
      const { start, end } = hit.range.byteOffset;
      if (helperRanges.some(([file, a, b]) => file === hit.file && a <= start && end <= b)) continue;
      findings.push(finding(rule, hit.file, hit.range.start.line + 1, hit.range.end.line + 1, hit.message || rule, hit.text));
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
}
