// Generated from D:/t-t-1/packages/cli/src/flick.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * Flick Puck headless match + round robin. Uses the SAME engine and PxC driver as Tac-x-Tic: nothing in the engine
 * knows about discs, physics or flicks (extension proof).
 *   npx tsx packages/cli/src/flick.ts match sniper spray [--rules aimNoise=3]
 *   npx tsx packages/cli/src/flick.ts robin [--seeds 5] [--rules ...]
 */
import { runMatch, replay } from '../engine/index.mjs';
import { runPxcMatch } from '../pxc/index.mjs';
import { resolveConfig } from '../core/index.mjs';
import { flickPuck, sniper, spray, patient, planner, sideOf } from '../flick-puck/index.mjs';
import { flagReader } from './args.mjs';
const LIB = { 'fp-sniper': sniper, 'fp-spray': spray, 'fp-patient': patient, 'fp-planner': planner };
const SHORT = { sniper: 'fp-sniper', spray: 'fp-spray', patient: 'fp-patient', planner: 'fp-planner' };
const args = process.argv.slice(2);
const flag = flagReader(args);
const rules = {};
for (const kv of flag('rules', '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    rules[k] = /^\d+$/.test(v) ? Number(v) : v;
}
const { config, errors } = resolveConfig(flickPuck, rules, 2);
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(2);
}
const budgets = { planningUnits: 30, memorySlots: 4 };
function ascii(s) {
    const c = s.config, cols = 40, rows = 24, grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
    const wy = Math.round(rows / 2);
    const g0 = Math.round(((c.width - c.gap) / 2 / c.width) * cols), g1 = Math.round(((c.width + c.gap) / 2 / c.width) * cols);
    for (let x = 0; x < cols; x++)
        if (x < g0 || x >= g1)
            grid[wy][x] = '=';
    for (const d of s.discs) {
        const x = Math.min(cols - 1, Math.floor((d.x / (c.width * 100)) * cols)), y = Math.min(rows - 1, Math.floor((d.y / (c.height * 100)) * rows));
        grid[y][x] = sideOf(s, d) === s.seats[0] ? 'a' : sideOf(s, d) === s.seats[1] ? 'b' : '*';
    }
    return ['+' + '-'.repeat(cols) + '+', ...grid.map((r) => '|' + r.join('') + '|'), '+' + '-'.repeat(cols) + '+'].join('\n');
}
if (args[0] === 'match') {
    const [pa = 'sniper', pb = 'spray'] = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));
    const fa = LIB[SHORT[pa] ?? pa], fb = LIB[SHORT[pb] ?? pb];
    if (!fa || !fb) {
        console.error(`policies: ${Object.keys(SHORT).join(', ')}`);
        process.exit(2);
    }
    const res = await runMatch({ game: flickPuck, config, seed: flag('seed', 'fp'), policyLibrary: LIB,
        participants: [{ player: 'A', policy: fa(), budgets }, { player: 'B', policy: fb(), budgets }], settings: { budget: { decisionMs: 5000, matchMs: null } } });
    const s = res.finalState;
    for (const h of s.history.filter((h) => h.crossings.length || h.go % 10 === 0)) {
        const side = (p) => h.go >= 0 ? `${p}:${(h.flicks[p] ?? []).length} flicks` : '';
        console.log(`GO ${String(h.go).padStart(3)}  ${side('A').padEnd(12)} ${side('B').padEnd(12)} ${h.crossings.map((c) => `#${c.id}→${c.to}`).join(' ')}`);
    }
    console.log(ascii(s));
    console.log(`Result: ${res.outcome.winners.length ? res.outcome.winners.join(',') + ' wins' : 'draw'} (${res.outcome.reason}) after ${s.go} GOs`);
    console.log(`Metrics: ${JSON.stringify(res.log.at(-1).metrics)}`);
    const rp = replay(flickPuck, res.log);
    console.log(`Replay: ${rp.ok ? 'every state hash matches' : `${rp.mismatches.length} MISMATCHES`}`);
    const px = await runPxcMatch({ game: flickPuck, config, seed: flag('seed', 'fp'), policyLibrary: LIB,
        seats: [{ player: 'A', policy: fa(), budgets }, { player: 'B', policy: fb(), budgets }] });
    const old = res.log.filter((e) => e.t === 'resolved').map((e) => e.stateHash);
    console.log(`PxC-composed run: ${JSON.stringify(px.stateHashes.slice(1)) === JSON.stringify(old) ? 'identical, GO for GO' : 'DIFFERS'} (${px.pxc.receipts().length} receipts)`);
}
else {
    const names = Object.keys(LIB), seeds = Number(flag('seeds', '5'));
    const score = {};
    let n = 0, replayOk = 0;
    for (const a of names)
        for (const b of names)
            for (let i = 0; i < seeds; i++) {
                const res = await runMatch({ game: flickPuck, config, seed: `robin|${a}|${b}|${i}`, policyLibrary: LIB,
                    participants: [{ player: 'A', policy: LIB[a](), budgets }, { player: 'B', policy: LIB[b](), budgets }], settings: { budget: { decisionMs: 5000, matchMs: null } } });
                const sc = (p) => (res.outcome.winners.includes(p) ? 1 : res.outcome.winners.length ? 0 : 0.5);
                (score[`${a}|${b}`] ??= []).push(sc('A'));
                n++;
                if (replay(flickPuck, res.log).ok)
                    replayOk++;
            }
    const avg = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
    console.log(`${n} matches, rules ${JSON.stringify(rules)}; replay exact: ${replayOk}/${n}`);
    console.log('row score vs column (both seats):');
    console.log(['', ...names.map((x) => x.slice(3))].map((x) => x.padEnd(9)).join(''));
    for (const a of names)
        console.log([a.slice(3), ...names.map((b) => ((avg(score[`${a}|${b}`]) + 1 - avg(score[`${b}|${a}`])) / 2).toFixed(2))].map((x) => x.padEnd(9)).join(''));
}
