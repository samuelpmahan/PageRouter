#!/usr/bin/env node
// called-shots: announce a change before building it, then grade it.
//
//   init  --build "<command>" --output <dir> [--working-directory <dir>]
//         [--source-root <dir>] [--called-dir <dir>] [--action-ref <ref>]
//       Writes called-shots.json, an empty call log, an empty crudlint
//       predicate set and .github/workflows/called-shots.yml. Never overwrites.
//   call  <shot.json>
//       Validates the shot, records the baseline commit (HEAD when absent),
//       copies it to <calledDir>/<id>.shot.json and logs its sha256 and time.
//   supersede <id> --by <id> --reason "<why>"
//       Records that a missed shot was replaced by a later call. The miss stays
//       in the record and the report but no longer fails `pr` once <by> is made.
//   grade <shot.json> [--base <ref>] [--candidate <ref>] [--candidate-output <dir>] [--json <file>]
//       Builds the base (the shot's baseline commit by default) and the
//       candidate (the working tree by default), grades, prints the report.
//   pr    --base <ref> [--candidate-output <dir>] [--require-shot]
//       Grades every shot added under <calledDir> since <ref>. Writes a
//       job summary and outputs when run in GitHub Actions.
//   crosscheck batch <dir> <shot.json>... | crosscheck compare <dir> <shot.json>...
//
// Every command takes --config <file> (default called-shots.json) and runs
// against the git repository containing the current directory.
// Exit status: 0 made (or nothing to grade), 1 missed, 2 usage or setup error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG_FILE, defaults, loadConfig } from '../lib/config.mjs';
import { Builder, git, resolveCommit } from '../lib/build.mjs';
import { grade, renderReport, validateShot } from '../lib/grade.mjs';
import { buildBatch, compare, score, renderReport as renderCrosscheck } from '../lib/crosscheck.mjs';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function parse(argv) {
  const positional = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { positional.push(argv[i]); continue; }
    const name = argv[i].slice(2);
    if (name === 'require-shot') options[name] = true;
    else options[name] = argv[++i];
  }
  return { positional, options };
}

function fail(message) { console.error(message); process.exit(2); }

function repoRoot() {
  const top = git(process.cwd(), ['rev-parse', '--show-toplevel'], { quiet: true });
  if (!top) fail('called-shots must run inside a git repository');
  return top;
}

function init(repo, o) {
  if (!o.build || !o.output) fail('init needs --build "<command>" and --output <dir>');
  const config = defaults({
    workingDirectory: o['working-directory'] ?? '.', build: o.build, output: o.output,
    defaultSourceRoot: o['source-root'] ?? '.', calledDir: o['called-dir'] ?? 'called-shots', excludeCalledDir: true,
  });
  config.predicates = `${config.calledDir}/predicates`;
  const files = {
    [CONFIG_FILE]: JSON.stringify(config, null, 2) + '\n',
    [`${config.calledDir}/events.jsonl`]: '',
    [`${config.predicates}/sgconfig.yml`]: 'ruleDirs:\n  - rules\nutilDirs:\n  - utils\ntestConfigs:\n  - testDir: rule-tests\n',
    [`${config.predicates}/rules/.gitkeep`]: '',
    [`${config.predicates}/utils/.gitkeep`]: '',
    [`${config.predicates}/rule-tests/.gitkeep`]: '',
    '.github/workflows/called-shots.yml': fs.readFileSync(path.join(PACKAGE, 'templates/called-shots.yml'), 'utf8').replaceAll('__ACTION_REF__', o['action-ref'] ?? 'main'),
  };
  const existing = Object.keys(files).filter(f => fs.existsSync(path.join(repo, f)));
  if (existing.length) fail(`init would overwrite: ${existing.join(', ')}`);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
    console.log(`wrote ${file}`);
  }
  if (!o['action-ref']) console.log('note: the workflow uses the action at @main; pin it to a commit with --action-ref <sha>');
}

function call(repo, config, file) {
  const shot = readJson(file);
  const problems = validateShot(shot);
  if (problems.length) fail(problems.join('\n'));
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(shot.id ?? '')) fail('shot id must be letters, digits and dashes');
  shot.baseline = { commit: resolveCommit(repo, 'HEAD'), ...shot.baseline };
  const dir = path.join(repo, config.calledDir), target = path.join(dir, `${shot.id}.shot.json`);
  fs.mkdirSync(dir, { recursive: true });
  const bytes = path.resolve(file) === target ? fs.readFileSync(target) : Buffer.from(JSON.stringify(shot, null, 2) + '\n');
  if (fs.existsSync(target) && !fs.readFileSync(target).equals(bytes)) fail(`${path.relative(repo, target)} already holds a different shot`);
  fs.writeFileSync(target, bytes);
  const event = { event: 'shot.called', shot: shot.id, sha256: sha(bytes), at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
  fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
  console.log(`called ${shot.id} (${event.sha256}) against ${shot.baseline.commit.slice(0, 12)}`);
}

async function gradeOne(repo, config, builder, file, { base, candidate, candidateOutput }) {
  const shot = readJson(file);
  const baseRef = base ?? shot.baseline?.commit;
  if (!baseRef) fail(`${file}: no --base given and the shot records no baseline.commit`);
  const baseTree = builder.tree(baseRef);
  const baselineOutput = builder.output(baseTree.dir, `base-${baseTree.sha.slice(0, 12)}`);
  let candidateRoot = repo, candidateOut;
  if (candidate) {
    const tree = builder.tree(candidate);
    candidateRoot = tree.dir;
    candidateOut = builder.output(tree.dir, `candidate-${tree.sha.slice(0, 12)}`);
  } else {
    candidateOut = candidateOutput ? builder.keep(path.resolve(candidateOutput), 'candidate-given') : builder.output(repo, 'candidate-working-tree');
  }
  const report = await grade(file, {
    baseline: baseTree.dir, candidate: candidateRoot, baselineOutput, candidateOutput: candidateOut,
    events: path.join(repo, config.calledDir, 'events.jsonl'),
    defaultSourceRoot: config.defaultSourceRoot,
    predicates: config.predicates ? path.join(candidateRoot, config.predicates) : null,
    exclude: config.excludeCalledDir ? [config.calledDir] : [],
  });
  return { report, text: renderReport(report, shot) };
}

// Shots added since base, each with the commit to grade it at. A shot is
// graded at the last commit that contains it and no other shot's change:
// on a straight line, the commit before the next shot was added; with lanes
// merged as branches, the head of its own lane. null means HEAD itself (or a
// commit with HEAD's exact tree), so an output already built can be reused.
function addedShots(repo, config, base) {
  // --no-merges: on pull_request, HEAD is a merge whose own diff would hold every shot at once.
  const log = git(repo, ['log', '--reverse', '--topo-order', '--no-merges', '--diff-filter=A', '--format=commit %H', '--name-only', `${base}..HEAD`, '--', config.calledDir]);
  const added = [];
  let commit = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7);
    else if (line.endsWith('.shot.json') && !added.some(s => s.file === line)) added.push({ file: line, commit });
  }
  if (!added.length) {
    // Shots added only by a merge: grade them at HEAD.
    const out = git(repo, ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', config.calledDir]);
    return out.split('\n').filter(f => f.endsWith('.shot.json')).sort().map(file => ({ file, at: null }));
  }
  const contains = (ancestor, commit) => git(repo, ['merge-base', '--is-ancestor', ancestor, commit], { quiet: true }) !== null;
  const commits = git(repo, ['rev-list', '--reverse', '--topo-order', '--no-merges', `${base}..HEAD`]).split('\n').filter(Boolean);
  const headTree = git(repo, ['rev-parse', 'HEAD^{tree}']);
  return added.map(shot => {
    const others = added.filter(s => s.commit !== shot.commit && !contains(s.commit, shot.commit));
    const own = commits.filter(c => contains(shot.commit, c) && !others.some(s => contains(s.commit, c)));
    const at = own.at(-1) ?? shot.commit;
    return { file: shot.file, at: git(repo, ['rev-parse', `${at}^{tree}`]) === headTree ? null : at };
  });
}

// In GitHub Actions: step outputs, the job summary, and annotations, which
// show on the pull request's checks and are readable through the checks API
// without the logs. GitHub keeps at most 10 annotations of each level per
// step, so every made shot goes into one summary notice, and each missed or
// superseded shot gets its own error or warning.
function githubOutputs(values, summary, verdicts = []) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const escape = s => String(s).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  // Workflow command properties are comma-separated key=value pairs.
  const property = s => escape(s).replaceAll(':', '%3A').replaceAll(',', '%2C');
  const madeShots = verdicts.filter(v => v.report.made);
  if (madeShots.length) {
    const lines = madeShots.map(({ report }) => `${report.shot}: ${report.results.length} of ${report.results.length} clauses made`);
    console.log(`::notice title=${property(`Called shots made: ${madeShots.length} of ${verdicts.length}`)}::${escape(lines.join('\n'))}`);
  }
  for (const { file, report, superseded } of verdicts.filter(v => !v.report.made)) {
    const missed = report.results.filter(r => !r.pass);
    const detail = [...(superseded ? [`superseded by ${superseded.by}: ${superseded.reason}`] : []), ...report.problems, ...missed.map(r => `${r.id} ${r.kind}: ${r.evidence[0]}`), ...(report.precheck && !report.precheck.pass ? ['precheck: every clause was already true on the baseline'] : [])].join('\n');
    const [level, verdict] = superseded ? ['warning', `missed, superseded by ${superseded.by}`] : ['error', 'missed'];
    console.log(`::${level} file=${property(file)},title=${property(`Called shot ${verdict}: ${report.shot}`)}::${escape(detail)}`);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, options } = parse(rest);
  const repo = repoRoot();
  if (command === 'init') return init(repo, options);
  if (!['call', 'supersede', 'grade', 'pr', 'crosscheck'].includes(command)) { console.error(fs.readFileSync(import.meta.filename, 'utf8').split('\n').slice(1, 25).join('\n')); process.exit(2); }
  const config = loadConfig(repo, options.config ?? CONFIG_FILE);
  if (command === 'call') return call(repo, config, positional[0] ?? fail('call needs a shot file'));
  const eventsFile = path.join(repo, config.calledDir, 'events.jsonl');
  const events = () => fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  // supersede <id> --by <id> --reason "<text>": a missed shot replaced by a later
  // call. The miss stays in the record and the report; it no longer fails `pr`
  // when the superseding shot is graded made in the same run.
  if (command === 'supersede') {
    const [id] = positional, by = options.by, reason = options.reason;
    if (!id || !by || !reason) fail('supersede <id> --by <id> --reason "<why>"');
    // The log's order is the order of calls; timestamps can tie within a second.
    const callIndex = shot => { const i = events().findIndex(e => e.event === 'shot.called' && e.shot === shot); return i >= 0 ? i : fail(`${shot} was never called`); };
    for (const shot of [id, by]) if (!fs.existsSync(path.join(repo, config.calledDir, `${shot}.shot.json`))) fail(`${config.calledDir}/${shot}.shot.json not found`);
    if (!(callIndex(by) > callIndex(id))) fail(`${by} must be called after ${id}`);
    const event = { event: 'shot.superseded', shot: id, by, reason, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
    fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');
    return console.log(`${id} superseded by ${by}`);
  }
  if (command === 'crosscheck') {
    const [mode, dir, ...shots] = positional;
    if (mode === 'batch') {
      const { batch, key } = buildBatch(shots.map(readJson));
      fs.mkdirSync(dir, { recursive: true });
      writeJson(path.join(dir, 'batch.json'), batch); writeJson(path.join(dir, 'key.json'), key);
      return console.log(`${batch.items.length} items, case ${batch.case_id}; give checkers batch.json and crosscheck/prompt.md, never key.json`);
    }
    if (mode === 'compare') {
      const batch = readJson(path.join(dir, 'batch.json')), key = readJson(path.join(dir, 'key.json'));
      const observations = fs.readdirSync(dir).filter(f => /^[a-z]+-\d+\.json$/.test(f)).sort().map(f => readJson(path.join(dir, f)));
      const comparison = await compare(batch, observations), scores = score(comparison, key);
      writeJson(path.join(dir, 'comparison.json'), { ...comparison, scores });
      const report = renderCrosscheck(batch, key, comparison, scores, shots.map(readJson)) + '\n';
      fs.writeFileSync(path.join(dir, 'report.md'), report);
      return console.log(report);
    }
    fail('crosscheck batch <dir> <shot.json>... | crosscheck compare <dir> <shot.json>...');
  }
  const builder = new Builder(repo, config, fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'called-shots-')));
  try {
    if (command === 'grade') {
      const file = positional[0] ?? fail('grade needs a shot file');
      const { report, text } = await gradeOne(repo, config, builder, file, { base: options.base, candidate: options.candidate, candidateOutput: options['candidate-output'] });
      if (options.json) writeJson(options.json, report);
      console.log(text);
      return report.made ? 0 : 1;
    }
    const base = options.base ?? fail('pr needs --base <ref>');
    const shots = addedShots(repo, config, base);
    if (!shots.length) {
      const message = `No called shots added under ${config.calledDir} since ${base.slice(0, 12)}.`;
      console.log(message);
      githubOutputs({ made: options['require-shot'] ? 'false' : 'true', shots: 0 }, `### Called shots\n\n${message}`);
      return options['require-shot'] ? 1 : 0;
    }
    const results = [];
    for (const { file, at } of shots) {
      if (at) console.error(`[called-shots] ${file}: graded at ${at.slice(0, 12)}, the last commit with this shot and no other shot's change`);
      const graded = await gradeOne(repo, config, builder, path.join(repo, file), at ? { candidate: at } : { candidateOutput: options['candidate-output'] });
      console.log(graded.text + '\n');
      results.push({ file, ...graded });
    }
    // A missed shot superseded by a shot made in this run does not fail it.
    const supersessions = events().filter(e => e.event === 'shot.superseded');
    for (const r of results) {
      const s = supersessions.findLast(e => e.shot === r.report.shot);
      if (!r.report.made && s && results.some(o => o.report.shot === s.by && o.report.made)) r.superseded = s;
    }
    const made = results.every(r => r.report.made || r.superseded);
    githubOutputs({ made: String(made), shots: results.length },
      ['### Called shots', '', ...results.map(r => `**${r.report.made ? 'Made' : r.superseded ? `Missed, superseded by \`${r.superseded.by}\`` : 'Missed'}**: \`${r.file}\``), '',
        ...results.map(r => '```text\n' + r.text + '\n```')].join('\n'), results);
    return made ? 0 : 1;
  } finally {
    builder.close();
  }
}

main().then(code => process.exit(code ?? 0), error => { console.error(error.message); process.exit(2); });
