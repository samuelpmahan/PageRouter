// Generated from D:/t-t-1/games/tac-x-tic/src/policies.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
import { linesOf } from './game.mjs';
/** Best mark on a known board: win, else block, else centre, else corner, else first empty. */
export function bestMark(board, me, them, allowed) {
    const free = (allowed ?? board.map((m, i) => (m === null ? i : -1)).filter((i) => i >= 0)).filter((i) => board[i] === null);
    if (!free.length)
        return null;
    for (const who of [me, them])
        for (const l of linesOf(3)) {
            const mine = l.filter((i) => board[i] === who).length, empty = l.filter((i) => board[i] === null);
            if (mine === 2 && empty.length === 1 && free.includes(empty[0]))
                return empty[0];
        }
    for (const c of [4, 0, 2, 6, 8, 1, 3, 5, 7])
        if (free.includes(c))
            return c;
    return free[0];
}
/** Nearest open outer cell to `from` (Chebyshev), lowest index on ties. */
export function nearestTarget(o, from = o.position.value) {
    const d = (a, b) => Math.max(Math.abs(Math.floor(a / 3) - Math.floor(b / 3)), Math.abs((a % 3) - (b % 3)));
    return o.legal.switchTargets.slice().sort((a, b) => d(from, a) - d(from, b) || a - b)[0] ?? null;
}
const info = (id, name, description) => ({ id, name, kind: 'scripted', games: ['tac-x-tic'], version: '2.0.0', deterministic: true, description });
const stayMark = (o) => bestMark(o.board.value, o.you, o.opponent, o.legal.stayMarks) ?? o.legal.stayMarks[0] ?? 4;
export function stayer() {
    return {
        info: info('txt-stayer', 'Stayer', 'Never switches unless its board is closed; marks with win/block/centre logic.'),
        decide: async ({ observation: o }) => {
            if (o.legal.stayMarks.length)
                return { action: { intent: 'M', stay: { mark: stayMark(o) } }, rationale: 'stay: my board is live and open' };
            const to = nearestTarget(o);
            return { action: { intent: 'S', switch: { to: to ?? 0, mark: 4 }, stay: { mark: 4 } }, rationale: 'my board is closed; switch, blind-mark the centre' };
        },
    };
}
/** Switches whenever allowed, using metered memory to remember boards it has seen and blind-mark well on return. */
export function scout() {
    return {
        info: info('txt-scout', 'Scout', 'Switches whenever the cooldown allows; remembers seen boards in metered memory and blind-marks using them.'),
        decide: async ({ observation: o, memory }) => {
            memory?.set(`board:${o.position.value}`, { cells: o.board.value, asOf: o.go });
            const mark = stayMark(o);
            if (!o.legal.switchNow && o.legal.stayMarks.length)
                return { action: { intent: 'M', stay: { mark } }, rationale: 'cooldown: stay this GO' };
            // Prefer a board never seen (information), else the remembered board where I am closest to a line.
            const seen = (t) => memory?.get(`board:${t}`);
            const unseen = o.legal.switchTargets.filter((t) => !seen(t));
            const to = unseen[0] ?? nearestTarget(o);
            if (to === null)
                return { action: { intent: 'M', stay: { mark } }, rationale: 'nowhere to switch' };
            const remembered = seen(to);
            const blind = remembered ? bestMark(remembered.cells, o.you, o.opponent) ?? 4 : 4;
            return { action: { intent: 'S', switch: { to, mark: blind }, stay: { mark } },
                rationale: remembered ? `switch to ${to}; blind mark ${blind} from memory as of GO ${remembered.asOf} (may be stale)` : `switch to unseen board ${to}; blind mark centre` };
        },
    };
}
/** Compares stay vs each switch target with the simulator, within its planning units; falls back to stayer logic. */
export function planner() {
    return {
        info: info('txt-planner', 'Planner', 'When a switch is available, simulates stay vs each switch target (8 GOs ahead, opponent modelled as Stayer) within its planning budget.'),
        decide: async ({ observation: o, memory, simulate, budgets }) => {
            memory?.set(`board:${o.position.value}`, o.board.value);
            const mark = stayMark(o);
            const stay = { intent: 'M', stay: { mark } };
            const boardClosed = !o.legal.stayMarks.length;
            if (!o.legal.switchNow || !o.legal.switchTargets.length)
                return { action: stay, rationale: boardClosed ? 'board closed but switch on cooldown: wait' : 'no switch available: stay' };
            if (!simulate)
                return boardClosed ? { action: { intent: 'S', switch: { to: nearestTarget(o) ?? 0, mark: 4 }, stay: { mark } }, rationale: 'board closed, no simulator: nearest board' } : { action: stay, rationale: 'no simulator: stay' };
            const boards = {};
            for (const k of memory?.keys() ?? [])
                if (k.startsWith('board:'))
                    boards[Number(k.slice(6))] = memory.get(k);
            const score = (r) => {
                if (!r.ok)
                    return -Infinity;
                if (r.outcome)
                    return r.outcome.winners.includes(o.you) ? 100 : r.outcome.winners.length ? -100 : 0;
                const s = r.summary;
                return s ? (s.claimed[o.you] ?? 0) - (s.claimed[o.opponent] ?? 0) : 0;
            };
            const horizon = 8;
            const candidates = [...(boardClosed ? [] : [stay]), ...o.legal.switchTargets.map((to) => ({ intent: 'S', switch: { to, mark: bestMark(boards[to] ?? Array(9).fill(null), o.you, o.opponent) ?? 4 }, stay: { mark } }))];
            let best = candidates[0] ?? stay, bestScore = -Infinity, tried = 0;
            for (const c of candidates) {
                if ((budgets?.planningLeft() ?? 0) < horizon)
                    break;
                const r = await simulate({ assumptions: { boards }, me: 'txt-stayer', opponent: 'txt-stayer', gos: horizon, firstAction: c });
                tried++;
                const sc = score(r);
                if (sc > bestScore) {
                    bestScore = sc;
                    best = c;
                }
            }
            return { action: best, rationale: `simulated ${tried}/${candidates.length} candidates ${horizon} GOs ahead; chose ${best.intent === 'S' ? `switch to ${best.switch.to}` : 'stay'} (score ${bestScore})` };
        },
    };
}
