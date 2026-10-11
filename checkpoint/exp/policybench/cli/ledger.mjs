// Generated from D:/t-t-1/packages/cli/src/ledger.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * Build Tac-x-Tic's capability graph, run every conformance check (through PxC), and write the ledger.
 * npx tsx packages/cli/src/ledger.ts [--out results/ledger.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AUTHORED } from '../tac-x-tic/contrib/index.mjs';
import { seededRandom } from '../policies/index.mjs';
import { stayer, scout, planner } from '../tac-x-tic/index.mjs';
import { buildTxtGraph } from '../tac-x-tic/capabilities.mjs';
const policies = {
    'txt-stayer': { factory: stayer, origin: 'games/tac-x-tic/src/policies.ts (baseline)', description: 'never switches unless forced' },
    'txt-scout': { factory: scout, origin: 'games/tac-x-tic/src/policies.ts (baseline)', description: 'switches when allowed, remembers boards' },
    'txt-planner': { factory: planner, origin: 'games/tac-x-tic/src/policies.ts (baseline)', description: 'simulates stay vs switch' },
    'seeded-random': { factory: seededRandom, origin: 'packages/policies (game-agnostic)', description: 'uniform over legal plans' },
};
for (const [name, a] of Object.entries(AUTHORED))
    policies[`contrib-${name}`] = { factory: a.factory, origin: `games/tac-x-tic/src/${a.file} (Sonnet author, v2 brief)`, description: `authored policy: ${name}` };
const g = buildTxtGraph(policies);
const at = new Date().toISOString();
for (const c of g.ledger())
    for (const i of c.implementations)
        await g.prove(i.id, at);
const ledger = g.ledger();
const args = process.argv.slice(2);
const out = args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : 'results/ledger.json';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ at, ledger }, null, 1));
for (const c of ledger) {
    console.log(`\n${c.contract}: ${c.description}`);
    for (const i of c.implementations)
        console.log(`  ${i.status.padEnd(9)} ${i.id}${Object.keys(i.supports).length ? `  supports ${JSON.stringify(i.supports)}` : ''}${i.failed.length ? `\n            ✗ ${i.failed.join('\n            ✗ ')}` : ''}`);
}
console.log(`\nledger → ${out}`);
