import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const leaf = path.join(root, 'dist/compiled/capability-lab');
const references = path.join(leaf, 'references');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

test('CapabilityLab competition overlay is assembled into its digest-covered static project', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'dist/data/catalog.json'), 'utf8'));
  const project = catalog.projects.find(item => item.id === 'capability-lab');
  assert.ok(project);
  assert.match(project.digest, /^[0-9a-f]{64}$/);
  assert.ok(project.fileCount > 40);
  const html = fs.readFileSync(path.join(leaf, 'index.html'), 'utf8');
  assert.match(html, /references\/browser\/entry\.mjs/);
  const stylesheet = fs.readFileSync(path.join(references, 'browser/panel.css'));
  const expectedVersion = createHash('sha256').update(stylesheet).digest('hex').slice(0, 12);
  const stylesheetLink = html.match(/<link rel="stylesheet" href="\.\/references\/browser\/panel\.css\?v=([a-f0-9]{12})">/);
  assert.ok(stylesheetLink, 'assembled CSS link must include a content version');
  assert.equal(stylesheetLink[1], expectedVersion, 'assembled CSS URL version must match its built bytes');
  const pin = JSON.parse(fs.readFileSync(path.join(root, 'vendor/capability-lab/SOURCE-PIN.json'), 'utf8'));
  assert.equal(Object.keys(pin.files).length, 40);
});

test('all overlay ES module relative imports remain present inside the built CapabilityLab project', () => {
  for (const file of walk(references).filter(file => file.endsWith('.mjs'))) {
    const relative = path.relative(leaf, file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), match[1]);
      assert.ok(target.startsWith(`${leaf}${path.sep}`), `overlay import escaped Lab project: ${relative} -> ${match[1]}`);
      assert.ok(fs.existsSync(target), `missing built import from ${relative}: ${match[1]}`);
    }
  }
  const source = fs.readFileSync(path.join(references, 'capabilities.mjs'), 'utf8');
  assert.doesNotMatch(source, /\.\.\/\.\.\/vendor\/capability-lab/);
  assert.match(source, /from ['"]\.\.\/src\/runtime\/index\.mjs['"]/);
});

test('built native composed descriptors execute synthetic 18-label and unequal-play examples and replay exactly', async () => {
  const modulePath = pathToFileURL(path.join(references, 'capabilities.mjs')).href;
  const { createCompetitionRegistry, NTL_LABELS, REPORT_SCHEMA } = await import(modulePath);
  const registry = createCompetitionRegistry();
  const ntllm = { schema: REPORT_SCHEMA, experiment: 'name-that-llm', sourceKind: 'synthetic-fixture', status: 'inconclusive', provenance: {}, evaluation: { labels: [...NTL_LABELS], actual: [...NTL_LABELS], baselinePredicted: [...NTL_LABELS], candidatePredicted: [...NTL_LABELS], groupIds: NTL_LABELS.map((_, index) => `p-${index}`) } };
  const nfl = { schema: REPORT_SCHEMA, experiment: 'nfl-wr-cut-recovery', sourceKind: 'synthetic-fixture', status: 'inconclusive', provenance: {}, evaluation: { actual: [0, 0, 0, 0, 0], baselinePredicted: [2, 2, 2, 2, 0], candidatePredicted: [0, 0, 0, 0, 1], groupIds: ['a', 'a', 'a', 'a', 'b'] } };
  const ntllmRun = registry.execute('ntllm.evaluatePredictions', { report: ntllm }, { seed: 'built-overlay-test' });
  const nflRun = registry.execute('nfl.evaluatePredictions', { report: nfl }, { seed: 'built-overlay-test' });
  assert.equal(ntllmRun.result.candidate.macroRecall, 1);
  assert.equal(registry.replay(ntllmRun).matches, true);
  assert.equal(nflRun.result.rowWeighted.baseline.mae, 1.6);
  assert.equal(nflRun.result.playerWeighted.baselineMae, 1);
  assert.equal(nflRun.result.playerWeighted.candidateMae, 0.5);
  assert.equal(registry.replay(nflRun).matches, true);
});
