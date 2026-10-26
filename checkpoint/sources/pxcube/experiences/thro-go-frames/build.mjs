// node build.mjs [seed] [--check]
//   data/toy-world.json   the one shared season (instances) and the Cases (situations inside it, with their changes)
//   data/results.json     verdicts and deltas per Case, the Calculation reports, graph metrics (Round 1 and now), the terminal audit, the base projection digest
//   --check               run the whole pipeline a second time and compare the bytes
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runPipeline, DEFAULT_SEED, ROUND1_GRAPH } from './pipeline.mjs';
import { serializeWorld, SCHEMA } from './world-json.mjs';
import { fnv32 } from './util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const seed = args.find((a) => /^\d+$/.test(a)) ? Number(args.find((a) => /^\d+$/.test(a))) : DEFAULT_SEED;
const check = args.includes('--check');

export function buildOutputs(seed) {
  const r = runPipeline(seed);
  const world = serializeWorld({ seed, summary: r.summary, instances: r.instances, cases: r.cases });
  const verdicts = {};
  for (const c of r.cases) { const v = r.verdicts[c.id]; verdicts[c.id] = { pass: v.pass, checks: v.checks, meaning: v.meaning, delta: v.delta, deltaCount: v.deltaCount, sentenceDelta: v.sentenceDelta, selected: v.selected, chainLength: v.chainLength, entities: r.entitiesByCase[c.id] }; }
  const mutantsPath = join(here, 'data', 'mutants.json');
  const mutants = existsSync(mutantsPath) ? JSON.parse(readFileSync(mutantsPath, 'utf8')) : null;
  const results = {
    schema: SCHEMA, seed, summary: r.summary, reports: r.reports, kinds: r.kinds, rejected: r.rejected, audit: r.audit,
    graph: { before: ROUND1_GRAPH, after: { ...r.metrics.world, crossCaseEdges: r.metrics.cases.crossCaseEdges, entitiesInMoreThanOneCase: r.metrics.cases.entitiesInMoreThanOneCase, strictSharedEntities: r.metrics.cases.strictSharedEntities, caseComponents: r.metrics.cases.caseComponents, islandCases: r.metrics.cases.islandCases.length }, rollups: r.metrics.rollups, sharing: { histogram: r.metrics.cases.histogram, topShared: r.metrics.cases.topShared, avgEntitiesPerCase: r.metrics.cases.avgEntitiesPerCase } },
    baseProjectionDigest: fnv32(JSON.stringify(r.base.P)), verdicts, mutants,
  };
  return { r, world, results: JSON.stringify(results, null, 1) + '\n' };
}

const out = buildOutputs(seed);
mkdirSync(join(here, 'data'), { recursive: true });
writeFileSync(join(here, 'data', 'toy-world.json'), out.world);
writeFileSync(join(here, 'data', 'results.json'), out.results);
const failing = Object.values(out.r.verdicts).filter((v) => !v.pass).length;
console.log(`seed ${seed}: ${out.r.cases.length} Cases (${Object.entries(out.r.kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), ${out.r.instances.length} instances, ${failing} failing; wrote data/toy-world.json and data/results.json`);
for (const rep of out.r.reports) console.log(`  ${rep.status}  ${rep.calculationId}  (${rep.guarantees.map((g) => (g.passed ? '+' : '-') + g.id).join(' ')})`);
let bad = failing > 0 || out.r.reports.some((x) => x.status !== 'PASS');
if (check) {
  const again = buildOutputs(seed);
  const same = again.world === out.world && again.results === out.results;
  console.log(`byte check: ${same ? 'identical' : 'DIFFERENT'} (toy-world ${fnv32(out.world).toString(16)}, results ${fnv32(out.results).toString(16)})`);
  if (!same) bad = true;
}
process.exit(bad ? 1 : 0);
