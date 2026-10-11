// Generated from D:/t-t-1/games/tac-x-tic/src/contrib/cartographer.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
import { linesOf } from '../game.mjs';
const META = 'meta';
const LINES = linesOf(3);
/** Preference of marking cell i on board b for player me: win 10, block 6, centre 3, corner 2, edge 1. */
function cellPref(b, i, me, them) {
    if (b[i] !== null)
        return 0;
    let v = i === 4 ? 3 : i % 2 === 0 ? 2 : 1;
    for (const l of LINES) {
        if (!l.includes(i))
            continue;
        const mine = l.filter((j) => b[j] === me).length, theirs = l.filter((j) => b[j] === them).length;
        if (mine === 2 && theirs === 0)
            return 10;
        if (theirs === 2 && mine === 0)
            v = Math.max(v, 6);
        else if (mine === 1 && theirs === 0)
            v += 0.5;
    }
    return v;
}
export default function cartographer() {
    return {
        info: { id: 'contrib-cartographer', name: 'Cartographer', kind: 'scripted', games: ['tac-x-tic'], version: '1.0.0', deterministic: true,
            description: 'Memory-heavy: stores every board with asOf, estimates staleness, refreshes by switching, blind-marks from the map.' },
        decide: async ({ observation: o, memory }) => {
            const fallback = () => ({ intent: 'M', stay: { mark: o.legal.stayMarks[0] ?? 4 } });
            try {
                const get = (k) => { try {
                    return memory?.get(k);
                }
                catch {
                    return undefined;
                } };
                const slots = memory ? memory.capacity : 0;
                const hasMem = !!memory && (slots === null || slots > 0);
                const meta = get(META) ?? { k: 0, a: 0, pend: null };
                // Learn the per-cell-per-GO "taken since seen" rate from my last blind mark.
                const last = o.yourLastGo?.value;
                if (meta.pend !== null && last && last.mark?.blind) {
                    meta.a += meta.pend;
                    if (last.markResult === 'taken')
                        meta.k += 1;
                }
                meta.pend = null;
                const rate = (meta.k + 0.2) / (meta.a + 5);
                const surv = (age) => Math.pow(1 - Math.min(rate, 0.5), Math.max(0, age));
                const save = (key, v, protect) => {
                    if (!memory)
                        return;
                    try {
                        let r = memory.set(key, v);
                        if (!r.ok) { // evict the stalest remembered board that is not protected
                            const old = memory.keys().filter((k) => k.startsWith('b') && !protect.includes(k))
                                .sort((x, y) => (get(x)?.t ?? 0) - (get(y)?.t ?? 0))[0];
                            if (old) {
                                memory.delete(old);
                                r = memory.set(key, v);
                            }
                        }
                    }
                    catch { /* memory unavailable */ }
                };
                const here = o.position.value;
                if (hasMem)
                    save('b' + here, { c: o.board.value, t: o.go }, ['b' + here]);
                const boardAt = (t) => {
                    if (t === here)
                        return { c: o.board.value, t: o.go };
                    if (o.allBoards)
                        return { c: o.allBoards.value[t], t: o.allBoards.asOf };
                    const r = get('b' + t);
                    return r && Array.isArray(r.c) ? r : null;
                };
                // Stay branch: live board, certain knowledge.
                let stayMark = o.legal.stayMarks[0] ?? 4, stayVal = -1;
                const shared = o.opponentPosition ? o.opponentPosition.value === here : false;
                const ranked = o.legal.stayMarks.map((i) => ({ i, v: cellPref(o.board.value, i, o.you, o.opponent) })).sort((x, y) => y.v - x.v || x.i - y.i);
                if (ranked.length) {
                    stayMark = ranked[0].i;
                    stayVal = ranked[0].v;
                }
                // Sharing a board: the opponent likely takes the obvious cell; dodge the clash unless it is a winning cell.
                if (shared && ranked.length > 1 && ranked[0].v < 10) {
                    stayMark = ranked[1].i;
                    stayVal = ranked[1].v * 0.8;
                }
                if (o.yourLastGo?.value.markResult === 'clash')
                    stayVal = Math.min(stayVal, 0.5); // clash loops: leave
                const stayLands = o.legal.stayMarks.length ? (shared ? 0.8 : o.opponentPosition ? 0.97 : 0.92) : 0.02;
                const stayPlan = (rationale) => ({
                    action: { intent: 'M', stay: { mark: stayMark } }, rationale,
                    meta: { predictions: { markLands: stayLands }, distribution: { [`stay:${stayMark}`]: 1 },
                        beliefs: { board: { source: 'live', asOf: o.go } } },
                });
                const finish = (p, pend) => {
                    meta.pend = pend;
                    if (hasMem)
                        save(META, meta, ['b' + here]);
                    return p;
                };
                if (!o.legal.switchNow || !o.legal.switchTargets.length)
                    return finish(stayPlan('cooldown or no target: stay on live board'), null);
                // Switch branch: score each open target by the map.
                const nearest = o.rules.blindMarkTaken === 'nearest-empty';
                let best = null;
                for (const to of o.legal.switchTargets) {
                    const rec = boardAt(to);
                    const oppThere = o.opponentPosition?.value === to ? 0.7 : 1;
                    let mark = 4, val, lands, age, known = false;
                    if (rec) {
                        known = true;
                        age = Math.max(0, o.go - rec.t);
                        const s = surv(age) * oppThere;
                        let bv = -1;
                        for (let i = 0; i < 9; i++) {
                            const v = cellPref(rec.c, i, o.you, o.opponent) * s;
                            if (rec.c[i] === null && v > bv) {
                                bv = v;
                                mark = i;
                            }
                        }
                        if (bv < 0)
                            continue; // remembered as full
                        lands = nearest ? Math.min(0.97, s + (1 - s) * 0.85) : s * 0.97;
                        val = bv + Math.min(age, 10) * 0.2; // refresh bonus: old maps are worth renewing
                    }
                    else {
                        age = 12;
                        const s = Math.pow(surv(1), 6) * oppThere; // unseen: modest prior that the centre is still free
                        if (oppThere < 1)
                            mark = 0;
                        lands = nearest ? 0.9 : s * 0.95;
                        val = 3 * s + 2.5; // exploration bonus: fill a blank on the map
                    }
                    if (!best || val > best.val || (val === best.val && to < best.to))
                        best = { to, mark, val, lands, age, known };
                }
                const closed = !o.legal.stayMarks.length;
                if (best && (closed || best.val > stayVal + 0.5)) {
                    const action = { intent: 'S', switch: { to: best.to, mark: best.mark }, stay: { mark: stayMark } };
                    return finish({ action, rationale: `switch to ${best.to} (${best.known ? `map age ${best.age}` : 'unseen'}), blind ${best.mark}; staleness rate ${rate.toFixed(3)}`,
                        meta: { predictions: { markLands: Math.max(0.02, Math.min(0.98, best.lands)) },
                            distribution: { [`switch:${best.to}@${best.mark}`]: 0.8, [`stay:${stayMark}`]: 0.2 },
                            beliefs: { staleness: { source: best.known ? 'memory' : 'prior', asOf: best.known ? o.go - best.age : -1, ratePerGo: rate } } } }, best.age);
                }
                return finish(stayPlan('map says staying beats switching'), null);
            }
            catch {
                return { action: fallback(), rationale: 'fallback', meta: { predictions: { markLands: 0.7 } } };
            }
        },
    };
}
