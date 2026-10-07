import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyGeneratedRunPrune, planGeneratedRunPrune } from '../prune-generated-runs.mjs';

const id = suffix => `2026-09-16T00-0${suffix}-00-000Z-abcdef${suffix}${suffix}`;

test('generated-run pruning is opt-in, retains latest plus newest runs, and cannot target arbitrary directories', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pxcube-prune-'));
  try {
    const runs = path.join(repo, '.pxcube', 'runs'); fs.mkdirSync(runs, { recursive: true });
    const ids = [id(1), id(2), id(3), id(4)];
    ids.forEach((run, index) => { const dir = path.join(runs, run); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'attempt.txt'), String(index)); fs.utimesSync(dir, new Date(1000 * index), new Date(1000 * index)); });
    fs.writeFileSync(path.join(repo, '.pxcube', 'latest.json'), JSON.stringify({ runId: ids[0] }));
    const plan = planGeneratedRunPrune(repo, { keep: 2 });
    assert.deepEqual(plan.retained.map(entry => entry.name).sort(), [ids[0], ids[2], ids[3]].sort());
    assert.deepEqual(plan.remove.map(entry => entry.name), [ids[1]]);
    assert.ok(fs.existsSync(path.join(runs, ids[1])), 'planning is dry-run only');
    assert.throws(() => applyGeneratedRunPrune({ ...plan, runs: os.tmpdir() }), /outside this repository/);
    assert.equal(applyGeneratedRunPrune(plan, repo), 1);
    assert.equal(fs.existsSync(path.join(runs, ids[1])), false);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
