// Generated from D:/t-t-1/games/tac-x-tic/src/contrib/allocator.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
import { linesOf } from '../game.mjs';
function best(board, me, them, allowed) {
    const free = (allowed ?? board.map((_, i) => i)).filter((i) => board[i] === null);
    if (!free.length)
        return null;
    for (const who of [me, them])
        for (const l of linesOf(3)) {
            const e = l.filter((i) => board[i] === null);
            if (l.filter((i) => board[i] === who).length === 2 && e.length === 1 && free.includes(e[0]))
                return e[0];
        }
    for (const c of [4, 0, 2, 6, 8, 1, 3, 5, 7])
        if (free.includes(c))
            return c;
    return free[0];
}
/** 2 = I can win now, 1 = one mark from two-in-line, 0 = nothing */
function heat(b, me) {
    let h = 0;
    for (const l of linesOf(3)) {
        const m = l.filter((i) => b[i] === me).length, e = l.filter((i) => b[i] === null).length;
        if (m === 2 && e === 1)
            return 2;
        if (m === 1 && e === 2)
            h = 1;
    }
    return h;
}
export default function allocator() {
    return {
        info: { id: 'contrib-allocator', name: 'The Allocator', kind: 'scripted', games: ['tac-x-tic'], version: '1.0.0', deterministic: true,
            description: 'Stays on live info; spends planning only when a switch is available and remembered info is fresh enough to be worth checking.' },
        decide: async ({ observation: o, memory, simulate, budgets }) => {
            try {
                const me = o.you, them = o.opponent, here = o.position.value;
                try {
                    memory?.set(`b${here}`, { c: o.board.value, t: o.go });
                }
                catch { /* capacity */ }
                const lastClash = o.yourLastGo?.value.markResult === 'clash' && o.yourLastGo.value.applied === 'stay';
                const shared = (o.opponentPosition ? o.opponentPosition.value === here : false) || lastClash;
                let stayM = best(o.board.value, me, them, o.legal.stayMarks) ?? o.legal.stayMarks[0] ?? 4;
                if (shared && o.legal.stayMarks.length > 1) {
                    // a mirror opponent will take the same obvious mark: break symmetry unless it is my win
                    const win = heat(o.board.value, me) === 2;
                    if (!win)
                        stayM = best(o.board.value, me, them, o.legal.stayMarks.filter((m) => m !== stayM)) ?? stayM;
                }
                const stay = { intent: 'M', stay: { mark: stayM } };
                const closed = o.legal.stayMarks.length === 0;
                const openT = o.legal.switchTargets;
                // clash risk: opponent known to share my board
                const unknownOpp = o.opponentPosition === null;
                const stayP = closed ? 0.05 : shared ? 0.5 : unknownOpp ? 0.9 : 0.97;
                const stayRes = (why, p = stayP, planned = 0) => ({ action: stay, rationale: why,
                    meta: { predictions: { markLands: p }, distribution: { [`stay:${stayM}`]: 1 }, beliefs: { allocation: `planning spent ${planned}`, oppPos: unknownOpp ? 'unknown (hidden)' : 'known' } } });
                if (!o.legal.switchNow || !openT.length)
                    return stayRes(closed ? 'closed, cooldown: wait' : 'switch unavailable: act on live info, 0 planning');
                // candidate: remembered board with the highest heat, discounted by age (staleness = uncertainty)
                let cand = null;
                for (const t of openT) {
                    let s;
                    try {
                        s = memory?.get(`b${t}`);
                    }
                    catch {
                        s = undefined;
                    }
                    if (!s)
                        continue;
                    const age = o.go - s.t, h = heat(s.c, me);
                    const mk = best(s.c, me, them);
                    if (mk === null)
                        continue;
                    const score = h * 3 - age * 0.5;
                    if (!cand || score > cand.h * 3 - cand.age * 0.5)
                        cand = { to: t, mark: mk, h, age };
                }
                const stayHeat = heat(o.board.value, me);
                const blindP = (age) => Math.max(0.3, 0.9 - 0.12 * age);
                const sw = (to, mark) => ({ intent: 'S', switch: { to, mark }, stay: { mark: stayM } });
                const swRes = (c, why, planned) => ({ action: sw(c.to, c.mark), rationale: why,
                    meta: { predictions: { markLands: blindP(c.age) }, distribution: { [`switch:${c.to}@${c.mark}`]: 0.8, [`stay:${stayM}`]: 0.2 }, beliefs: { allocation: `planning spent ${planned}`, staleness: `board ${c.to} age ${c.age} GOs` } } });
                if (closed) {
                    const c = cand ?? { to: openT[0], mark: 4, h: 0, age: 99 };
                    return swRes(c, 'board closed: forced switch', 0);
                }
                // shared board and switch available: leave, the mirror clash wastes both of us
                if (shared && !cand)
                    cand = { to: openT.find((t) => t !== o.opponentPosition?.value) ?? openT[0], mark: 4, h: 0, age: 99 };
                if (shared && cand)
                    return swRes(cand, 'sharing a board (clash risk): leave, 0 planning', 0);
                // fresh and decisive -> act fast, no planning
                if (cand && cand.h === 2 && cand.age <= 2 && stayHeat < 2)
                    return swRes(cand, `fresh win-ready board ${cand.to} (age ${cand.age}): act, 0 planning`, 0);
                // uncertain and stakes high -> verify with the simulator if budget allows
                const horizon = 6;
                if (cand && cand.h >= 1 && simulate && budgets && (budgets.planningLeft() ?? 0) >= horizon * 2) {
                    const boards = {};
                    for (const k of memory?.keys() ?? [])
                        if (k.startsWith('b')) {
                            const s = memory.get(k);
                            if (s?.c)
                                boards[Number(k.slice(1))] = s.c;
                        }
                    const score = (r) => {
                        if (!r.ok)
                            return -Infinity;
                        if (r.outcome)
                            return r.outcome.winners.includes(me) ? 100 : r.outcome.winners.length ? -100 : 0;
                        const s = r.summary;
                        return s ? (s.claimed[me] ?? 0) - (s.claimed[them] ?? 0) : 0;
                    };
                    const a = await simulate({ assumptions: { boards }, me: 'txt-stayer', opponent: 'txt-stayer', gos: horizon, firstAction: stay });
                    const b = await simulate({ assumptions: { boards }, me: 'txt-stayer', opponent: 'txt-stayer', gos: horizon, firstAction: sw(cand.to, cand.mark) });
                    if (score(b) > score(a))
                        return swRes(cand, `simulated: switch ${score(b)} > stay ${score(a)}`, horizon * 2);
                    return stayRes(`simulated: stay ${score(a)} >= switch ${score(b)}`, stayP, horizon * 2);
                }
                return stayRes('no cheap evidence for switching: stay');
            }
            catch {
                const m = o.legal.stayMarks[0] ?? 4;
                return { action: { intent: 'M', stay: { mark: m } }, rationale: 'fallback', meta: { predictions: { markLands: 0.7 } } };
            }
        },
    };
}
