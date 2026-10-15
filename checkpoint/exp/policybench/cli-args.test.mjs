// The shared `--key value` reader in cli/args.mjs, which flick.mjs, match.mjs and tournament.mjs used to
// define as three identical copies. Authored here (the modules in cli/ are emitted from TypeScript; this test is not).
//
// Three kinds of check, each with concrete argv arrays:
//   1. the answers it gives, written out as a table;
//   2. agreement with node:util parseArgs, the trusted reference for what a command line means, on the
//      usage the CLIs document (`--key value`, each key at most once);
//   3. the places it differs from parseArgs, pinned on both sides so a change on either side shows up here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { flagReader } from './cli/args.mjs';

const CLI_DIR = path.join(import.meta.dirname, 'cli');

// Every flag each CLI reads through flag(), with the fallback its call site passes.
const CLI_FLAGS = {
  'flick.mjs': { rules: '', seed: 'fp', seeds: '5' },
  'match.mjs': { seed: 'demo', rules: '', budgetA: '', budgetB: '', log: '' },
  'tournament.mjs': { policies: '', splits: '40:0,20:4,8:8,0:9', info: 'pub-hid,hid-hid,pub-pub', cooldowns: '3', seeds: '5', out: 'results/v2' },
};

const source = (file) => fs.readFileSync(path.join(CLI_DIR, file), 'utf8');

test('the table of flags above is what each CLI source actually reads', () => {
  for (const [file, expected] of Object.entries(CLI_FLAGS)) {
    const found = {};
    for (const [, key, fallback] of source(file).matchAll(/\bflag\(\s*'([\w-]+)'\s*,\s*'([^']*)'\s*\)/g)) found[key] = fallback;
    assert.deepEqual(found, expected, file);
  }
});

test('flick.mjs, match.mjs and tournament.mjs build flag from flagReader and define no reader of their own', () => {
  for (const file of Object.keys(CLI_FLAGS)) {
    const text = source(file);
    assert.ok(text.includes("import { flagReader } from './args.mjs';"), `${file} imports flagReader`);
    const declarations = text.split('\n').filter((line) => /^\s*(?:const|let|var)\s+flag\b|^\s*function\s+flag\b/.test(line));
    assert.deepEqual(declarations, ['const flag = flagReader(args);'], `${file} declares flag once, from flagReader`);
  }
});

// [argv, key, fallback, expected answer, why]
const ANSWERS = [
  [['--seed', '7'], 'seed', 'demo', '7', 'the token after the first exact --seed'],
  [[], 'seed', 'demo', 'demo', '--seed is absent'],
  [['match', 'sniper', 'spray'], 'seed', 'demo', 'demo', 'positionals only'],
  [['--seed'], 'seed', 'demo', 'demo', '--seed is the last token: nothing follows it'],
  [['--seed', ''], 'seed', 'demo', '', 'an empty string is a value, not a missing one'],
  [['--seed', '--rules', 'a=1'], 'seed', 'demo', '--rules', 'the next token is taken whatever it looks like'],
  [['--seed', '--rules', 'a=1'], 'rules', 'x', 'a=1', 'and --rules is still found after it'],
  [['--seed', '-5'], 'seed', 'demo', '-5', 'a value that starts with - is a value'],
  [['--seed=7'], 'seed', 'demo', 'demo', '--key=value is not recognised'],
  [['--seed=7', 'x'], 'seed', 'demo', 'demo', '--key=value is not recognised, and does not hand the token after it to --seed'],
  [['--seed', '1', '--seed', '2'], 'seed', 'demo', '1', 'the first --seed wins'],
  [['--seeds', '9'], 'seed', 'demo', 'demo', 'the token must equal --seed exactly'],
  [['--seed', '9'], 'see', 'demo', 'demo', 'a prefix of a flag is not that flag'],
  [['--Seed', '9'], 'seed', 'demo', 'demo', 'case matters'],
  [['--', '--seed', '7'], 'seed', 'demo', '7', '-- does not end option parsing'],
  [['match', 'sniper', 'spray', '--rules', 'aimNoise=3', '--seed', '9'], 'rules', '', 'aimNoise=3', 'flick.mjs: positionals first, then flags'],
  [['match', 'sniper', 'spray', '--rules', 'aimNoise=3', '--seed', '9'], 'seed', 'fp', '9', 'flick.mjs: the same argv, the other flag'],
  [['planner', 'scout', '--budgetA', '10:2', '--budgetB', ':1'], 'budgetB', '', ':1', 'match.mjs: a budget with an empty planning part'],
  [['--no-typecheck', '--policies', 'stayer,scout', '--splits', '40:0'], 'splits', 'x', '40:0', 'tournament.mjs: a boolean flag before the valued ones'],
];

test('answers on concrete argv arrays', () => {
  for (const [argv, key, fallback, expected, why] of ANSWERS) {
    assert.equal(flagReader(argv)(key, fallback), expected, `${JSON.stringify(argv)} flag(${JSON.stringify(key)}, ${JSON.stringify(fallback)}): ${why}`);
  }
});

test('the fallback comes back untouched: same object, undefined stays undefined', () => {
  const fallback = { budget: 1 };
  assert.equal(flagReader([])('seed', fallback), fallback);
  assert.equal(flagReader([])('seed'), undefined);
  assert.equal(flagReader(['--seed'])('seed', null), null);
});

test('the array is read on every call, not copied when the reader is made', () => {
  const argv = [];
  const flag = flagReader(argv);
  assert.equal(flag('seed', 'demo'), 'demo');
  argv.push('--seed', '7');
  assert.equal(flag('seed', 'demo'), '7');
  argv.length = 0;
  assert.equal(flag('seed', 'demo'), 'demo');
});

// Deterministic generator (mulberry32) so a failure names the same argv every run.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('agrees with node:util parseArgs on `--key value`, each key at most once', () => {
  const VALUES = ['7', '', 'x', 'x y', 'a=1,b=2', 'aimNoise=3', '40:0', ':4', '5:', 'inf', 'file:./policy.mjs', '日本語', '0', 'undefined'];
  const POSITIONALS = ['match', 'robin', 'sniper', 'spray', 'planner', 'scout'];
  let compared = 0, found = 0;
  for (const [index, [file, flags]] of Object.entries(CLI_FLAGS).entries()) {
    const options = Object.fromEntries(Object.keys(flags).map((key) => [key, { type: 'string' }]));
    const next = random(1000 + index);
    const pick = (list) => list[Math.floor(next() * list.length)];
    const shuffled = (list) => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
    for (let round = 0; round < 400; round++) {
      const argv = [];
      for (let n = Math.floor(next() * 3); n > 0; n--) argv.push(pick(POSITIONALS));
      for (const key of shuffled(Object.keys(flags)).filter(() => next() < 0.6)) {
        argv.push(`--${key}`, pick(VALUES));
        if (next() < 0.3) argv.push(pick(POSITIONALS));
      }
      const parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true }).values;
      const flag = flagReader(argv);
      for (const [key, fallback] of Object.entries(flags)) {
        assert.equal(flag(key, fallback), parsed[key] ?? fallback, `${file} ${JSON.stringify(argv)} --${key}`);
        compared++;
        if (key in parsed) found++;
      }
    }
  }
  assert.ok(compared >= 5000 && found >= 2000, `the comparison must exercise present flags (compared ${compared}, present ${found})`);
});

// What parseArgs does with one string option, as {value} or {throws: code}.
function parsed(argv, key, others = []) {
  const options = Object.fromEntries([key, ...others].map((name) => [name, { type: 'string' }]));
  try { return { value: parseArgs({ args: argv, options, allowPositionals: true, strict: true }).values[key] }; }
  catch (error) { return { throws: error.code }; }
}

// [argv, key, what flag answers, what parseArgs does]: the places the two differ.
const DIFFERENCES = [
  ['--key=value is read by parseArgs, ignored by flag', ['--seed=7'], 'seed', 'demo', { value: '7' }],
  ['a repeated flag: flag takes the first, parseArgs the last', ['--seed', '1', '--seed', '2'], 'seed', '1', { value: '2' }],
  ['after --, parseArgs stops reading options; flag keeps reading', ['--', '--seed', '7'], 'seed', '7', { value: undefined }],
  ['a value that starts with -: flag takes it, parseArgs refuses', ['--seed', '-5'], 'seed', '-5', { throws: 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' }],
  ['a value that is another flag: flag takes it, parseArgs refuses', ['--seed', '--rules', 'a=1'], 'seed', '--rules', { throws: 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' }],
  ['a flag with nothing after it: flag falls back, parseArgs refuses', ['--seed'], 'seed', 'demo', { throws: 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' }],
];

test('where it differs from parseArgs, both sides pinned', () => {
  for (const [why, argv, key, flagAnswer, parseArgsOutcome] of DIFFERENCES) {
    assert.equal(flagReader(argv)(key, 'demo'), flagAnswer, `flag: ${why}`);
    assert.deepEqual(parsed(argv, key, ['rules']), parseArgsOutcome, `parseArgs: ${why}`);
  }
});
