// Generated from D:/t-t-1/packages/cli/src/tournament.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * Experiment runner (rules v2). Independent variables: policy × opponent × seat × budget split × information rules
 * × switch cooldown. Dependent variables per match and seat: result, GOs, boards claimed, mark rate, blind marks lost,
 * clashes, switches applied/refused, planning spent, memory used, calibration of reported markLands (Brier).
 *
 * npx tsx packages/cli/src/tournament.ts [--out results/v2] [--policies a,b] [--splits 40:0,20:4,8:8,0:9]
 *   [--info pub-hid,hid-hid,pub-pub,hid-pub] [--cooldowns 3]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { AUTHORED } from '../tac-x-tic/contrib/index.mjs';
import { runMatch, replay } from '../engine/index.mjs';
import { resolveConfig } from '../core/index.mjs';
import { seededRandom } from '../policies/index.mjs';
import { tacXTic, stayer, scout, planner } from '../tac-x-tic/index.mjs';
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] ?? d) : d; };
const library = { 'txt-stayer': stayer, 'txt-scout': scout, 'txt-planner': planner, 'seeded-random': seededRandom };
const factories = { 'base:stayer': library['txt-stayer'], 'base:scout': library['txt-scout'], 'base:planner': library['txt-planner'], 'base:random': seededRandom };
// tsx does not typecheck: two authored policies once ran with type errors that silently invalidated their plans.
// Refuse to run an experiment on code that fails tsc (skip with --no-typecheck).
if (!args.includes('--no-typecheck')) {
    try {
        execSync('npx tsc -p tsconfig.json --noEmit', { stdio: 'pipe' });
    }
    catch (e) {
        console.error('Typecheck failed; fix these before running the experiment:\n' + String(e.stdout ?? e));
        process.exit(1);
    }
}
for (const [name, a] of Object.entries(AUTHORED))
    factories[`author:${name}`] = a.factory;
const only = flag('policies', '');
const names = Object.keys(factories).filter((n) => !only || only.split(',').some((o) => n.endsWith(o)));
const splits = flag('splits', '40:0,20:4,8:8,0:9').split(',').map((s) => { const [p, m] = s.split(':').map(Number); return { id: s, planningUnits: p, memorySlots: m }; });
const INFO = {
    'pub-hid': { positions: 'public', otherBoards: 'hidden' }, 'hid-hid': { positions: 'hidden', otherBoards: 'hidden' },
    'pub-pub': { positions: 'public', otherBoards: 'public' }, 'hid-pub': { positions: 'hidden', otherBoards: 'public' },
};
const infos = flag('info', 'pub-hid,hid-hid,pub-pub').split(',');
const cooldowns = flag('cooldowns', '3').split(',').map(Number);
const rows = [];
let n = 0;
const t0 = Date.now();
// Both start orientations for every pairing: the start cell carries a real advantage for policies with asymmetric
// tie-breaks (Stayer self-play: whoever starts on cell 3 wins ~16/20), so an unbalanced design reports it as a seat effect.
const orientations = [[3, 5], [5, 3]];
for (const sp of splits)
    for (const info of infos)
        for (const cd of cooldowns)
            for (const [startA, startB] of orientations)
                for (const pa of names)
                    for (const pb of names) {
                        // Several seeds per pairing: the seeded clash coin and seeded policies would otherwise draw the SAME sequence in every
                        // match, correlating results across the whole run (it produced a spurious 0.61/0.39 seat effect).
                        const seeds = Array.from({ length: Number(flag('seeds', '5')) }, (_, i) => `s${i + 1}`);
                        for (const seedBase of seeds) {
                            // One seed per MATCH, not per run: a shared seed gives every match the same clash-coin sequence, so coin-decided
                            // games all break the same way (it produced a spurious 0.37/0.63 seat-label effect with 5 shared seeds).
                            const seed = `${seedBase}|${pa}|${pb}|${sp.id}|${info}|${cd}|${startA}-${startB}`;
                            const { config, errors } = resolveConfig(tacXTic, { ...INFO[info], switchCooldown: cd, startA, startB }, 2);
                            if (errors.length)
                                throw new Error(errors.join('; '));
                            const budgets = { planningUnits: sp.planningUnits, memorySlots: sp.memorySlots };
                            const res = await runMatch({ game: tacXTic, config, seed, policyLibrary: library,
                                participants: [{ player: 'A', policy: factories[pa](), budgets }, { player: 'B', policy: factories[pb](), budgets }],
                                settings: { budget: { decisionMs: 5000, matchMs: null } } });
                            const s = res.finalState;
                            const ok = replay(tacXTic, res.log).ok;
                            for (const [me, pol, opp] of [['A', pa, pb], ['B', pb, pa]]) {
                                const eff = s.history.map((g) => g.effects[me]).filter((e) => !!e);
                                const decisions = res.log.filter((e) => e.t === 'decision' && e.player === me);
                                const okDec = decisions.filter((d) => d.status === 'ok');
                                // Calibration: reported P(mark lands) for the committed plan vs. what happened that GO.
                                const scored = [];
                                for (const d of okDec) {
                                    const p = d.meta?.predictions?.markLands;
                                    const e = s.history[d.turn]?.effects[me];
                                    if (typeof p === 'number' && p >= 0 && p <= 1 && e) {
                                        const y = e.markResult === 'placed' || e.markResult === 'redirected' ? 1 : 0;
                                        scored.push((p - y) ** 2);
                                    }
                                }
                                rows.push({
                                    split: sp.id, info, cooldown: cd, seed, seat: me, start: me === 'A' ? startA : startB, policy: pol, opponent: opp,
                                    result: res.outcome.winners.includes(me) ? 'win' : res.outcome.winners.length ? 'loss' : 'draw', gos: s.go, reason: res.outcome.reason,
                                    boardsClaimed: s.status.filter((x) => x.kind === 'won' && x.by === me).length,
                                    markRate: eff.length ? eff.filter((e) => e.markResult === 'placed' || e.markResult === 'redirected').length / eff.length : 0,
                                    blindLost: eff.filter((e) => e.mark?.blind && e.markResult === 'taken').length,
                                    clashes: eff.filter((e) => e.markResult === 'clash').length,
                                    switches: eff.filter((e) => e.applied === 'switch').length,
                                    switchRefused: eff.filter((e) => e.switchRefused !== null).length,
                                    planningPerGo: okDec.length ? okDec.reduce((a, d) => a + (d.planningSpent ?? 0), 0) / okDec.length : 0,
                                    memoryMax: Math.max(0, ...okDec.map((d) => Object.keys(d.memoryAfter ?? {}).length)),
                                    brier: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null, predictions: scored.length,
                                    fallbacks: res.log.filter((e) => e.t === 'fallback' && e.player === me).length,
                                    invalid: decisions.filter((d) => d.status !== 'ok').length, replayOk: ok,
                                });
                            }
                            n++;
                        }
                    }
// Guard against the shared-seed bug class: every match must have had its own seed.
{
    const perMatch = new Set(rows.filter((r) => r.seat === 'A').map((r) => r.seed));
    if (perMatch.size !== n)
        throw new Error(`seed reuse: ${n} matches but only ${perMatch.size} distinct seeds; results would be correlated`);
}
const out = flag('out', 'results/v2');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.json`, JSON.stringify(rows, null, 1));
const avg = (xs) => { const v = xs.filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const f = (x, d = 2) => (x === null ? '—' : x.toFixed(d));
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const score = (r) => (r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0);
const short = (s) => s.replace(/^\w+:/, '');
const L = [`# Tac-x-Tic v2 experiment: ${n} matches in ${Math.round((Date.now() - t0) / 1000)} s`, '',
    `Policies: ${names.map(short).join(', ')}. Splits (planning:memory, both seats): ${splits.map((s) => s.id).join(', ')}. Info rules: ${infos.join(', ')} (positions-otherBoards). Cooldowns: ${cooldowns.join(', ')}.`,
    `Replay: ${rows.every((r) => r.replayOk) ? 'every match replays exactly' : rows.filter((r) => !r.replayOk).length + ' rows FAILED replay'}.`, '',
    '## Overall, per policy', '', '| policy | n | score | win | GOs | boards | mark rate | blind lost | clashes | switches | refused | plan/GO | mem | Brier (n) | fallbacks |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const p of names) {
    const r = rows.filter((x) => x.policy === p);
    const br = r.filter((x) => x.brier !== null);
    L.push(`| ${short(p)} | ${r.length} | ${f(avg(r.map(score)))} | ${pct(avg(r.map((x) => (x.result === 'win' ? 1 : 0))))} | ${f(avg(r.map((x) => x.gos)), 0)} | ${f(avg(r.map((x) => x.boardsClaimed)), 1)} | ${pct(avg(r.map((x) => x.markRate)))} | ${f(avg(r.map((x) => x.blindLost)), 1)} | ${f(avg(r.map((x) => x.clashes)), 1)} | ${f(avg(r.map((x) => x.switches)), 1)} | ${f(avg(r.map((x) => x.switchRefused)), 1)} | ${f(avg(r.map((x) => x.planningPerGo)), 1)} | ${f(avg(r.map((x) => x.memoryMax)), 1)} | ${br.length ? `${f(avg(br.map((x) => x.brier)), 3)} (${br.reduce((a, x) => a + x.predictions, 0)})` : '—'} | ${f(avg(r.map((x) => x.fallbacks)), 1)} |`);
}
const pivot = (title, key, cols) => {
    L.push('', `## Score by ${title}`, '', `| policy | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
    for (const p of names)
        L.push(`| ${short(p)} | ${cols.map((c) => f(avg(rows.filter((x) => x.policy === p && key(x) === c).map(score)))).join(' | ')} |`);
};
pivot('budget split (planning:memory)', (r) => r.split, splits.map((s) => s.id));
pivot('information rules (positions-otherBoards)', (r) => r.info, infos);
if (cooldowns.length > 1)
    pivot('switch cooldown', (r) => String(r.cooldown), cooldowns.map(String));
L.push('', '## Head-to-head (row score vs column, all conditions)', '', `| | ${names.map(short).join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
for (const p of names)
    L.push(`| ${short(p)} | ${names.map((q) => f(avg(rows.filter((x) => x.policy === p && x.opponent === q).map(score)))).join(' | ')} |`);
L.push('', '## Role effects (balanced: every pairing plays both start orientations)', '', '| factor | level | score |', '|---|---|---|', `| seat label | A | ${f(avg(rows.filter((x) => x.seat === 'A').map(score)), 3)} |`, `| seat label | B | ${f(avg(rows.filter((x) => x.seat === 'B').map(score)), 3)} |`, `| start cell | 3 | ${f(avg(rows.filter((x) => x.start === 3).map(score)), 3)} |`, `| start cell | 5 | ${f(avg(rows.filter((x) => x.start === 5).map(score)), 3)} |`);
L.push('', '### Start-cell effect per policy', '', '| policy | from 3 | from 5 |', '|---|---|---|');
for (const p of names)
    L.push(`| ${short(p)} | ${f(avg(rows.filter((x) => x.policy === p && x.start === 3).map(score)))} | ${f(avg(rows.filter((x) => x.policy === p && x.start === 5).map(score)))} |`);
writeFileSync(`${out}.md`, L.join('\n'));
console.log(L.join('\n'));
