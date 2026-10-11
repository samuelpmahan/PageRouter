// Generated from D:/t-t-1/games/tac-x-tic/src/contrib/simulator.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
import { bestMark, nearestTarget } from '../policies.mjs';
export default function simulatorPolicy() {
    return {
        info: { id: 'contrib-simulator', name: 'The Simulator', kind: 'scripted', games: ['tac-x-tic'], version: '1.0.0', deterministic: true,
            description: 'Spends planning units comparing stay vs pruned switch candidates; minimal memory.' },
        decide: async ({ observation: o, memory, simulate, budgets }) => {
            const fallback = () => ({ action: { intent: 'M', stay: { mark: o?.legal?.stayMarks?.[0] ?? 4 } }, rationale: 'fallback', meta: { predictions: { markLands: 0.8 } } });
            try {
                const m = memory;
                const safe = (f, d) => { try {
                    return f();
                }
                catch {
                    return d;
                } };
                // --- minimal memory: boards I have stood on, plus one blind-mark calibration slot ---
                const bkey = `b${o.position.value}`;
                safe(() => {
                    if (!m)
                        return;
                    const keys = m.keys();
                    const cap = typeof m.capacity === 'number' ? m.capacity : Infinity;
                    if (!keys.includes(bkey) && keys.length >= cap) {
                        const old = keys.filter((k) => k.startsWith('b')).sort((a, b) => (m.get(a)?.asOf ?? 0) - (m.get(b)?.asOf ?? 0))[0];
                        if (old)
                            m.delete(old);
                    }
                    m.set(bkey, { cells: o.board.value.slice(), asOf: o.go });
                }, undefined);
                const snap = (t) => safe(() => m?.get(`b${t}`), undefined);
                let cal = safe(() => m?.get('cal') ?? { n: 0, ok: 0 }, { n: 0, ok: 0 });
                const y = o.yourLastGo?.value;
                if (y && y.applied === 'switch' && y.mark?.blind) {
                    cal = { n: cal.n + 1, ok: cal.ok + (y.markResult === 'placed' || y.markResult === 'redirected' ? 1 : 0) };
                    safe(() => m?.set('cal', cal), undefined);
                }
                const blindP = (t) => {
                    const s = snap(t);
                    const pr = s ? Math.max(0.5, 0.9 - 0.02 * (o.go - s.asOf)) : 0.75; // unseen: assume mostly empty; remembered: decays with age
                    return (pr * 3 + (cal.n ? cal.ok / cal.n : pr) * cal.n) / (3 + cal.n);
                };
                let stayM = bestMark(o.board.value, o.you, o.opponent, o.legal.stayMarks) ?? o.legal.stayMarks[0] ?? 4;
                // Clash breaker: a repeated same-cell clash is a deadlock; deviate to another good cell (seat-offset so mirrors differ).
                const lastClash = y && y.applied === 'stay' && y.markResult === 'clash' && o.legal.stayMarks.length > 1;
                if (lastClash) {
                    const ranked = [];
                    let pool = o.legal.stayMarks.filter((c) => c !== y.mark?.cell);
                    while (pool.length) {
                        const b = bestMark(o.board.value, o.you, o.opponent, pool);
                        if (b === null)
                            break;
                        ranked.push(b);
                        pool = pool.filter((c) => c !== b);
                    }
                    if (ranked.length)
                        stayM = ranked[(o.go + (o.you < o.opponent ? 0 : 1)) % ranked.length];
                }
                const stay = { intent: 'M', stay: { mark: stayM } };
                const closed = !o.legal.stayMarks.length || (!!y && y.applied === 'stay' && y.markResult === 'clash' && o.legal.stayMarks.length <= 1 && o.legal.switchNow);
                const clashRisk = lastClash ? 0.5 : o.opponentPosition && o.opponentPosition.value === o.position.value ? 0.3 : o.opponentPosition ? 0.02 : 0.1;
                const stayP = closed ? 0 : 1 - clashRisk;
                const out = (action, rationale, p, dist) => ({ action, rationale, meta: { predictions: { markLands: Math.min(0.97, Math.max(0.03, p)) }, ...(dist ? { distribution: dist } : {}),
                        beliefs: { unseenBoards: 'assumed empty (no live info)', remembered: 'own snapshots, stale by age', opponentPosition: o.opponentPosition ? 'public/shared' : 'unknown: not assumed' } } });
                if (!o.legal.switchNow || !o.legal.switchTargets.length)
                    return out(stay, closed ? 'board closed, cooldown: wait' : 'no switch available: stay', stayP);
                const outerCell = (t) => (t === 4 ? 3 : t % 2 === 0 ? 2 : 1);
                const prior = (t) => {
                    const s = snap(t);
                    const mine = s ? s.cells.filter((c) => c === o.you).length : 0, theirs = s ? s.cells.filter((c) => c === o.opponent).length : 0;
                    return outerCell(t) + (mine - theirs) * 0.7 + (s ? 0 : 0.5) - (o.opponentPosition?.value === t ? 1.5 : 0);
                };
                const targets = o.legal.switchTargets.slice().sort((a, b) => prior(b) - prior(a) || a - b);
                const blindFor = (t) => { const s = snap(t); return (s ? bestMark(s.cells, o.you, o.opponent) : null) ?? 4; };
                // COORDINATOR PATCH (2026-10-11): was `stay` (the whole plan), which made every switch plan invalid and fall back
                // to the engine default. Original kept in simulator.as-written.ts.txt.
                const mk = (t) => ({ intent: 'S', switch: { to: t, mark: blindFor(t) }, stay: stay.stay });
                const left = () => { const v = safe(() => budgets?.planningLeft(), 0); return v === null || v === undefined ? (budgets ? Infinity : 0) : v; };
                if (!simulate || left() < 2) {
                    if (!closed)
                        return out(stay, 'no planning: stay on live board', stayP);
                    const t = targets[0] ?? nearestTarget(o) ?? 0;
                    return out(mk(t), `no planning: board closed, switch to ${t}`, blindP(t));
                }
                const total = left();
                const nCand = Math.min(targets.length, total === Infinity ? targets.length : Math.max(1, Math.floor(total / 6)));
                const horizon = total === Infinity ? 10 : Math.max(2, Math.min(10, Math.floor(total / ((closed ? 0 : 1) + nCand))));
                const boards = {};
                for (let t = 0; t < 9; t++) {
                    const s = snap(t);
                    if (s && t !== o.position.value)
                        boards[t] = s.cells;
                }
                const oppModel = o.opponentLastGo?.value.applied === 'switch' ? 'txt-scout' : 'txt-stayer';
                const assumptions = { boards };
                const score = (r) => {
                    if (!r?.ok)
                        return -Infinity;
                    if (r.outcome)
                        return r.outcome.winners.includes(o.you) ? 1000 : r.outcome.winners.length ? -1000 : 0;
                    const s = r.summary;
                    return s ? 10 * ((s.claimed[o.you] ?? 0) - (s.claimed[o.opponent] ?? 0)) + ((s.marks[o.you] ?? 0) - (s.marks[o.opponent] ?? 0)) : 0;
                };
                const results = [];
                const run = async (key, a, p) => {
                    if (left() < 1)
                        return;
                    const h = Math.min(horizon, Math.floor(left()));
                    const r = await simulate({ assumptions, me: 'txt-stayer', opponent: oppModel, gos: h, firstAction: a });
                    results.push({ key, a, sc: score(r), p });
                };
                if (!closed)
                    await run('stay', stay, stayP);
                for (const t of targets.slice(0, nCand))
                    await run(`switch:${t}@${blindFor(t)}`, mk(t), blindP(t));
                if (!results.length)
                    return out(closed ? mk(targets[0]) : stay, 'planning exhausted', closed ? blindP(targets[0]) : stayP);
                // Switches must beat stay by a margin (blind-mark risk, stale beliefs), discounted by landing probability.
                const adj = (r) => (r.key === 'stay' ? r.sc : r.sc * (0.5 + 0.5 * r.p) - 1.5);
                let best = results[0];
                for (const r of results)
                    if (adj(r) > adj(best))
                        best = r;
                const dist = {};
                for (const r of results)
                    dist[r.key] = r === best ? 0.7 : 0.3 / Math.max(1, results.length - 1);
                return out(best.a, `simulated ${results.length}/${targets.length + (closed ? 0 : 1)} plans at horizon ${horizon} vs ${oppModel}; chose ${best.key} (adj ${adj(best).toFixed(1)})`, best.p, dist);
            }
            catch (e) {
                if (process.env.SIMDBG)
                    console.error(e);
                return fallback();
            }
        },
    };
}
