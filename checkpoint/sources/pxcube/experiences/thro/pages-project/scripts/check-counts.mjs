// Verifies feedback_counts / feedback_daily agree with the raw feedback table by running sql/check-counts.sql through wrangler.
//   node scripts/check-counts.mjs --local                 (the local dev database)
//   node scripts/check-counts.mjs --remote                (production; needs your wrangler login, read-only query)
// Options: --persist-to <dir> (local state dir), --cwd <dir> (directory holding the wrangler config). Exit 0 = agree, 1 = disagree, 2 = could not run.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), project = resolve(here, '..');
const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const mode = args.includes('--remote') ? '--remote' : '--local';
const cwd = resolve(opt('--cwd') ?? project), persist = opt('--persist-to');
const wrangler = join(project, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const run = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'thro-feedback', mode, '--file', join(project, 'sql', 'check-counts.sql'), '--json', ...(persist ? ['--persist-to', persist] : [])],
  { cwd, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
const start = run.stdout.indexOf('[');
if (run.status !== 0 || start < 0) { console.error(`could not run the check (${mode}):\n${run.stderr || run.stdout}`); process.exit(2); }
const rows = JSON.parse(run.stdout.slice(start)).flatMap(r => r.results ?? []);
if (!rows.length) { console.log(`OK (${mode.slice(2)}): feedback_counts and feedback_daily agree with the raw feedback table.`); process.exit(0); }
console.error(`MISMATCH (${mode.slice(2)}): ${rows.length} derived value(s) disagree with the raw table. Fix: run sql/recompute-counts.sql, then this check again.`);
console.table(rows);
process.exit(1);
