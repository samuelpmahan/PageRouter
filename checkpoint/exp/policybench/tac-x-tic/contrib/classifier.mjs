// Generated from D:/t-t-1/games/tac-x-tic/src/contrib/classifier.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
import { linesOf } from '../game.mjs';
// Prior P(mark lands) per category, worth PRIOR_N pseudo-observations; replaced by the empirical rate as data arrives.
const PRIOR = { 'stay-solo': 0.97, 'stay-shared': 0.85, 'switch-seen': 0.85, 'switch-unseen': 0.85, 'switch-public': 0.95 };
const PRIOR_N = 4;
const d = (a, b) => Math.max(Math.abs(Math.floor(a / 3) - Math.floor(b / 3)), Math.abs((a % 3) - (b % 3)));
const free = (b) => b.map((m, i) => (m === null ? i : -1)).filter((i) => i >= 0);
/** Cell scores for `me` on a board: 100 win, 80 block, else line potential + centre/corner bias; -1 = taken. */
function cellScores(b, me, them) {
    const s = Array(9).fill(-1);
    for (const i of free(b))
        s[i] = i === 4 ? 3 : i % 2 === 0 ? 2 : 1;
    for (const l of linesOf(3)) {
        const m = l.filter((i) => b[i] === me).length, t = l.filter((i) => b[i] === them).length;
        for (const i of l) {
            if (b[i] !== null)
                continue;
            if (m === 2 && t === 0)
                s[i] = Math.max(s[i], 100);
            else if (t === 2 && m === 0)
                s[i] = Math.max(s[i], 80);
            else if (t === 0)
                s[i] += m === 1 ? 4 : 0.5;
            else if (m === 0)
                s[i] += 0.3;
        }
    }
    return s;
}
const argmax = (s, skip = []) => { let bi = -1; s.forEach((v, i) => { if (v >= 0 && !skip.includes(i) && (bi < 0 || v > s[bi]))
    bi = i; }); return bi; };
export default function classifier() {
    return {
        info: { id: 'contrib-classifier', name: 'The Classifier', kind: 'scripted', games: ['tac-x-tic'], version: '1.0.0', deterministic: true, description: 'Feature -> calibrated-question policy, no lookahead.' },
        decide: async ({ observation: o, memory }) => {
            try {
                let st = { boards: {}, cal: {}, pend: null };
                try {
                    const m = memory?.get('st');
                    if (m && m.cal)
                        st = m;
                }
                catch { /* ignore */ }
                // 1. Learn from last GO's outcome (calibration update).
                const ly = o.yourLastGo?.value;
                if (st.pend && ly) {
                    const hit = ly.markResult === 'placed' || ly.markResult === 'redirected' ? 1 : 0;
                    const c = st.cal[st.pend] ?? [0, 0];
                    st.cal[st.pend] = [c[0] + hit, c[1] + 1];
                }
                st.pend = null;
                const rate = (cat) => { const c = st.cal[cat] ?? [0, 0]; return (PRIOR[cat] * PRIOR_N + c[0]) / (PRIOR_N + c[1]); };
                const pub = o.allBoards?.value;
                const pos = o.position.value, go = o.go;
                st.boards[pos] = { cells: o.board.value.slice(), asOf: go };
                const know = (t) => pub ? { cells: pub[t], fresh: true } : st.boards[t] ? { cells: st.boards[t].cells, fresh: st.boards[t].asOf === go } : null;
                // 2. Features of the current board.
                const b = o.board.value, me = o.you, them = o.opponent;
                const sc = cellScores(b, me, them);
                const stayCell = o.legal.stayMarks.length ? argmax(sc) : -1;
                const oppPos = o.opponentPosition?.value ?? null;
                const shared = oppPos === pos;
                const oppCell = shared ? argmax(cellScores(b, them, me)) : -1;
                let stayMark = stayCell;
                if (shared && stayCell === oppCell && o.legal.stayMarks.length > 1) {
                    const alt = argmax(sc, [stayCell]);
                    if (alt >= 0 && sc[alt] >= 3)
                        stayMark = alt;
                }
                if (stayMark < 0)
                    stayMark = o.legal.stayMarks[0] ?? 4;
                const nFree = o.legal.stayMarks.length;
                const myWin = (sc[stayCell] ?? 0) >= 100;
                const mustBlock = (sc[stayCell] ?? 0) >= 80 && !myWin;
                const closed = nFree === 0;
                // 3. Q2: which target board; Q1: P(switch better than stay).
                const own = o.outer.value.map((c) => (c.status === 'won' ? c.owner : c.status === 'drawn' ? 'x' : null));
                const outerValue = (t) => {
                    let v = t === 4 ? 0.6 : t % 2 === 0 ? 0.3 : 0;
                    for (const l of linesOf(3)) {
                        if (!l.includes(t))
                            continue;
                        const m = l.filter((i) => own[i] === me).length, th = l.filter((i) => own[i] === them).length, x = l.filter((i) => own[i] === 'x').length;
                        if (x)
                            continue;
                        if (th === 0)
                            v += 0.4 * m + 0.2;
                        if (m === 0 && th === 2)
                            v += 3;
                        if (m === 2 && th === 0)
                            v += 3;
                    }
                    return v;
                };
                const predOppTarget = oppPos === null ? -1 : o.legal.switchTargets.concat(oppPos === pos ? [] : [pos]).filter((t) => t !== oppPos).sort((a, c) => d(oppPos, a) - d(oppPos, c) || a - c)[0] ?? -1;
                let targets = [];
                if (o.legal.switchNow) {
                    targets = o.legal.switchTargets.map((to) => {
                        const k = know(to);
                        const cells = k ? k.cells : Array(9).fill(null);
                        const bs = cellScores(cells, me, them);
                        const blindCell = argmax(bs) >= 0 ? argmax(bs) : 4;
                        const mine = cells.filter((m) => m === me).length, theirs = cells.filter((m) => m === them).length;
                        let score = 1 + 0.5 * mine - 0.4 * theirs - 0.15 * d(pos, to) + (k ? 0 : 0.6) + ((bs[blindCell] ?? 0) >= 100 ? 2 : 0);
                        if (oppPos === to)
                            score -= 1.5;
                        if (oppPos !== null && oppPos !== pos && to === predOppTarget)
                            score -= 1.2;
                        score += outerValue(to);
                        const cat = pub ? 'switch-public' : k ? 'switch-seen' : 'switch-unseen';
                        return { to, blind: blindCell, score, cat };
                    });
                }
                const best = targets.slice().sort((a, c) => c.score - a.score || a.to - c.to)[0];
                let z = -2.0;
                if (closed)
                    z = 6;
                if (nFree <= 3)
                    z += 1.2;
                if (shared)
                    z += 0.8;
                if (myWin)
                    z -= 4;
                if (mustBlock)
                    z -= 2;
                const pSwitch = best ? 1 / (1 + Math.exp(-z)) : 0;
                const doSwitch = !!best && pSwitch > 0.5;
                // 4. Commit argmax plan; report calibrated probabilities.
                const tw = targets.map((t) => Math.exp(t.score)), tz = tw.reduce((a, c) => a + c, 0) || 1;
                const stayCat = shared ? 'stay-shared' : 'stay-solo';
                let landP;
                let action;
                if (doSwitch && best) {
                    let p = rate(best.cat);
                    const k = know(best.to);
                    if (k && !k.fresh)
                        p *= 0.9;
                    landP = Math.max(0.02, Math.min(0.98, p));
                    st.pend = best.cat;
                    action = { intent: 'S', switch: { to: best.to, mark: best.blind }, stay: { mark: stayMark } };
                }
                else {
                    landP = nFree ? rate(stayCat) : 0.02;
                    if (nFree)
                        st.pend = stayCat;
                    action = { intent: 'M', stay: { mark: stayMark } };
                }
                const dist = { [`stay:${stayMark}`]: +(1 - pSwitch).toFixed(3) };
                targets.forEach((t, i) => { dist[`switch:${t.to}@${t.blind}`] = +((pSwitch * tw[i]) / tz).toFixed(3); });
                try {
                    memory?.set('st', st);
                }
                catch { /* memory full: carry on */ }
                return {
                    action,
                    rationale: doSwitch && best ? `Q1 switch p=${pSwitch.toFixed(2)}; Q2 board ${best.to}; Q3 blind ${best.blind}` : `Q1 stay (switch p=${pSwitch.toFixed(2)}); mark ${stayMark}`,
                    meta: { predictions: { markLands: +landP.toFixed(3) }, distribution: dist, beliefs: { oppPos: oppPos === null ? 'unknown' : oppPos, shared } },
                };
            }
            catch {
                return { action: { intent: 'M', stay: { mark: o.legal.stayMarks[0] ?? 4 } } };
            }
        },
    };
}
