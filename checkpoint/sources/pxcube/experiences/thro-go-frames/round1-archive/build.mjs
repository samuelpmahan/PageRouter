// node build.mjs [seed]  -> data/toy-world.json (generated frame instances + Cases) and data/results.json (enriched links, metrics, verdicts, witness reports)
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runPipeline, DEFAULT_SEED } from './pipeline.mjs';
import { serializeWorld } from './world-json.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const seed = process.argv[2] ? Number(process.argv[2]) : DEFAULT_SEED;
const r = runPipeline(seed);
mkdirSync(join(here, 'data'), { recursive: true });
writeFileSync(join(here, 'data', 'toy-world.json'), serializeWorld(r.world));
const verdicts = Object.fromEntries(Object.entries(r.verdicts).map(([id, v]) => [id, { pass: v.pass, meaning: v.meaning, checks: v.checks }]));
writeFileSync(join(here, 'data', 'results.json'), JSON.stringify({ seed, reports: r.reports, enriched: r.enriched, metrics: r.metrics, verdicts }, null, 1) + '\n');
const failing = Object.values(r.verdicts).filter((v) => !v.pass).length;
console.log(`seed ${seed}: ${r.world.caseCount} Cases, ${r.world.instances.length} instances, ${failing} failing; wrote data/toy-world.json and data/results.json`);
for (const rep of r.reports) console.log(`  ${rep.status}  ${rep.calculationId}  (${rep.guarantees.map((g) => (g.passed ? '+' : '-') + g.id).join(' ')})`);
process.exit(failing ? 1 : 0);
