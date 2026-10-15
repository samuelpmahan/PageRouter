// Generated from D:/t-t-1/packages/cli/src/match.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * Headless match: npx tsx packages/cli/src/match.ts [policyA] [policyB] [--seed s] [--rules k=v,k=v]
 *   [--budgetA planning:memory] [--budgetB planning:memory] [--log out.json]
 * Policies: stayer, scout, planner, random, or file:<path> (default-exported factory).
 * Prints every GO in plain text so the outcome can be checked by hand, then verifies replay.
 */
import { writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMatch, replay } from '../engine/index.mjs';
import { resolveConfig } from '../core/index.mjs';
import { seededRandom } from '../policies/index.mjs';
import { tacXTic, stayer, scout, planner } from '../tac-x-tic/index.mjs';
import { AUTHORED } from '../tac-x-tic/contrib/index.mjs';
import { flagReader } from './args.mjs';
export const LIBRARY = {
    'txt-stayer': stayer, 'txt-scout': scout, 'txt-planner': planner, 'seeded-random': seededRandom,
};
const SHORT = { stayer: 'txt-stayer', scout: 'txt-scout', planner: 'txt-planner', random: 'seeded-random' };
const args = process.argv.slice(2);
const flag = flagReader(args);
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && (args[i - 1] ?? '').startsWith('--')));
const [pa = 'planner', pb = 'scout'] = pos;
const seed = flag('seed', 'demo');
const rules = {};
for (const kv of flag('rules', '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    rules[k] = /^\d+$/.test(v) ? Number(v) : v;
}
const { config, errors } = resolveConfig(tacXTic, rules, 2);
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(2);
}
const budget = (s) => { if (!s)
    return undefined; const [p, m] = s.split(':'); return { planningUnits: p === '' || p === 'inf' ? null : Number(p), memorySlots: m === undefined || m === 'inf' ? null : Number(m) }; };
async function load(name) {
    if (name.startsWith('file:')) {
        const mod = await import(pathToFileURL(resolvePath(name.slice(5))).href);
        if (typeof mod.default !== 'function')
            throw new Error(`${name} must default-export a policy factory`);
        return mod.default;
    }
    const f = LIBRARY[SHORT[name] ?? name] ?? AUTHORED[name]?.factory;
    if (!f)
        throw new Error(`unknown policy ${name}; choose ${[...Object.keys(SHORT), ...Object.keys(AUTHORED)].join(', ')} or file:<path>`);
    return f;
}
const [fa, fb] = [await load(pa), await load(pb)];
const res = await runMatch({
    game: tacXTic, config, seed, policyLibrary: LIBRARY,
    participants: [{ player: 'A', policy: fa(), budgets: budget(flag('budgetA', '')) }, { player: 'B', policy: fb(), budgets: budget(flag('budgetB', '')) }],
    settings: { budget: { decisionMs: 5000, matchMs: null }, planningUnits: 40, memorySlots: 9 },
});
const final = res.finalState;
const plan = {};
for (const e of res.log)
    if (e.t === 'decision' && e.status === 'ok')
        plan[`${e.turn}/${e.player}`] = e.planningSpent ?? 0;
for (const g of final.history) {
    const fx = (p) => {
        const e = g.effects[p];
        const what = e.applied === 'switch' ? `SW ${e.moved.from}→${e.moved.to} blind@${e.mark.cell}` : `STAY @${e.mark?.cell ?? '-'}${e.switchRefused ? ' (switch refused)' : ''}`;
        return `${p}: ${what.padEnd(26)} ${String(e.markResult ?? '').padEnd(10)} plan ${String(plan[`${g.go}/${p}`] ?? 0).padStart(2)}`;
    };
    const caps = g.captures.map((c) => `board ${c.board} ${c.by ? 'won by ' + c.by : 'drawn (' + c.reason + ')'}`).join('; ');
    console.log(`GO ${String(g.go).padStart(3)}  ${fx('A')}   ${fx('B')}${caps ? '   ' + caps : ''}`);
}
console.log(`\nResult: ${res.outcome.winners.length ? res.outcome.winners.join(', ') + ' wins' : 'draw'} (${res.outcome.reason}) after ${final.go} GOs`);
console.log('Outer board:', final.status.map((s) => (s.kind === 'won' ? s.by : s.kind === 'drawn' ? 'x' : '.')).join(''));
// Per seat: a combined count once made one player's simulator use look like the other's.
for (const p of ['A', 'B']) {
    const calls = res.log.filter((e) => e.t === 'tool_call' && e.tool === 'simulate' && e.player === p);
    const ok = calls.filter((c) => c.result.ok).length;
    const dec = res.log.filter((e) => e.t === 'decision' && e.player === p && e.status === 'ok');
    const start = res.log[0];
    const rec = start.participants.find((x) => x.player === p);
    console.log(`${p} (${rec.label}): budget planning ${rec.planningUnits ?? '∞'} / memory ${rec.memorySlots ?? '∞'}; simulate calls ${calls.length} (${ok} ok, ${calls.length - ok} refused); planning spent ${dec.reduce((a, d) => a + (d.planningSpent ?? 0), 0)}; max memory keys ${Math.max(0, ...dec.map((d) => Object.keys(d.memoryAfter ?? {}).length))}`);
}
console.log(`Metrics: ${JSON.stringify(res.log.at(-1).metrics)}`);
const rp = replay(tacXTic, res.log);
console.log(`Replay from log: ${rp.ok ? 'every state hash matches' : `${rp.mismatches.length} MISMATCHES`} (${rp.frames.length - 1} GOs)`);
const out = flag('log', '');
if (out) {
    writeFileSync(out, JSON.stringify(res.log, null, 1));
    console.log(`log → ${out}`);
}
