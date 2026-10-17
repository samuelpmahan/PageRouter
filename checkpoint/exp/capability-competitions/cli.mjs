#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompetitionRegistry } from './capabilities.mjs';
import { evaluateReport, validateRunnerReport } from './index.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const registry = createCompetitionRegistry();

function usage() {
  return `CapabilityLab competition reference experiments

Usage:
  node cli.mjs list
  node cli.mjs fixture
  node cli.mjs run ntllm --train PATH
  node cli.mjs run nfl --data-dir DIR --drill NAME --route-family LABEL
  node cli.mjs evaluate --report PATH
`;
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    if (!args[i].startsWith('--')) throw new Error(`unexpected argument ${args[i]}`);
    const key = args[i].slice(2);
    if (flags[key] !== undefined) throw new Error(`duplicate --${key}`);
    if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error(`--${key} requires a value`);
    flags[key] = args[++i];
  }
  return flags;
}

function reportReceipt(report, raw, runnerExitCode = 0, runnerStderr = '') {
  validateRunnerReport(report, report.experiment);
  const evaluated = evaluateReport(report, { registry, seed: 'capability-competition-v1' });
  return {
    name: report.experiment,
    runnerExitCode,
    runnerStderr: runnerStderr.trim(),
    schema: report.schema,
    mode: report.sourceKind === 'synthetic-fixture' ? 'fixture' : 'competition',
    experiment: report.experiment,
    status: evaluated.status,
    sourceKind: report.sourceKind,
    reason: evaluated.reason,
    reportSha256: createHash('sha256').update(raw).digest('hex'),
    evaluation: evaluated.metrics,
    execution: evaluated.execution,
    replay: { matches: evaluated.replay.matches, exact: evaluated.replay.exact, hash: evaluated.replay.hash, mismatches: evaluated.replay.mismatches },
    runnerReport: report,
  };
}

function executeRunner(experiment, runnerArgs) {
  const folder = mkdtempSync(path.join(tmpdir(), 'capability-competition-'));
  const output = path.join(folder, 'runner-report.json');
  const script = path.join(root, experiment === 'ntllm' ? 'ntllm/run.py' : 'nfl/run.py');
  try {
    const processResult = spawnSync(process.env.PYTHON || 'python3', [script, ...runnerArgs, '--output', output], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (processResult.error) throw processResult.error;
    let raw;
    try { raw = readFileSync(output); }
    catch { throw new Error(`runner produced no report (exit ${processResult.status ?? 'unknown'}): ${processResult.stderr || processResult.stdout}`); }
    const report = JSON.parse(raw.toString('utf8'));
    const receipt = reportReceipt(report, raw, processResult.status ?? 1, processResult.stderr || '');
    const blocked = report.status === 'blocked';
    return { receipt, exitCode: blocked ? (processResult.status && processResult.status !== 0 ? processResult.status : 2) : 0 };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

export function aggregateRunReceipts(runs, mode) {
  return {
    schema: 'capability-competition-aggregate.v1',
    mode,
    status: runs.some(run => run.status === 'blocked') ? 'blocked' : runs.some(run => run.status === 'inconclusive') ? 'inconclusive' : 'completed',
    sourceKinds: [...new Set(runs.map(run => run.sourceKind))],
    runs,
  };
}

function show(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'list') {
    show(registry.list().filter(capability => capability.source === 'pagerouter-capability-competitions').map(({ id, title, kind, dependsOn }) => ({ id, title, kind, dependsOn })));
    return 0;
  }
  if (command === 'fixture') {
    const ntllm = executeRunner('ntllm', ['--fixture']);
    const nfl = executeRunner('nfl', ['--fixture', '--drill', 'fixture drill', '--route-family', 'OUT']);
    show(aggregateRunReceipts([ntllm.receipt, nfl.receipt], 'fixture'));
    return ntllm.exitCode || nfl.exitCode;
  }
  if (command === 'run') {
    const [lane, ...flagArgs] = rest;
    if (!['ntllm', 'nfl'].includes(lane)) throw new Error('run requires ntllm or nfl');
    const flags = parseFlags(flagArgs);
    const allowed = lane === 'ntllm' ? ['train'] : ['data-dir', 'drill', 'route-family'];
    for (const key of Object.keys(flags)) if (!allowed.includes(key)) throw new Error(`unknown option --${key}`);
    const runnerArgs = [];
    for (const key of allowed) if (flags[key] !== undefined) runnerArgs.push(`--${key}`, flags[key]);
    const missing = lane === 'ntllm' ? !flags.train : !flags['data-dir'] || !flags.drill || !flags['route-family'];
    if (missing) throw new Error(lane === 'ntllm' ? 'run ntllm requires --train PATH' : 'run nfl requires --data-dir DIR --drill NAME --route-family LABEL');
    const result = executeRunner(lane, runnerArgs);
    show(result.receipt);
    return result.exitCode;
  }
  if (command === 'evaluate') {
    const flags = parseFlags(rest);
    if (Object.keys(flags).some(key => key !== 'report') || !flags.report) throw new Error('evaluate requires --report PATH');
    const raw = readFileSync(flags.report);
    const report = JSON.parse(raw.toString('utf8'));
    const receipt = reportReceipt(report, raw);
    show(receipt);
    return report.status === 'blocked' ? 2 : 0;
  }
  throw new Error(usage());
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    if (process.env.CAPABILITY_COMPETITIONS_USAGE) process.stderr.write(usage());
    process.exitCode = 2;
  });
}
