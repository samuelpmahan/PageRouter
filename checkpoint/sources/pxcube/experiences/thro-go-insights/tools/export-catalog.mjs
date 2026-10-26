import { writeFileSync } from 'node:fs';
import { capabilities } from '../thro-capabilities/index.mjs';
import { registry } from '../insights.mjs';
const out = { domain: 'thro', capabilities: capabilities.map(({ run, ...d }) => d) };
writeFileSync(new URL('../thro-capabilities/catalog.json', import.meta.url), JSON.stringify(out, null, 2));
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
// run each declared example through the registry as a check
for (const c of capabilities) for (const ex of c.examples) { const r = registry.execute(c.id, ex.input).result; if (canon(r) !== canon(ex.expected)) throw new Error('example failed ' + c.id); }
console.log('exported', capabilities.map((c) => c.id), 'examples pass');
