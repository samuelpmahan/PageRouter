// Generated from D:/t-t-1/games/tac-x-tic/src/game.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
const linesCache = new Map();
export function linesOf(n) {
    let out = linesCache.get(n);
    if (out)
        return out;
    out = [];
    for (let r = 0; r < n; r++)
        out.push(Array.from({ length: n }, (_, c) => r * n + c));
    for (let c = 0; c < n; c++)
        out.push(Array.from({ length: n }, (_, r) => r * n + c));
    out.push(Array.from({ length: n }, (_, i) => i * n + i));
    out.push(Array.from({ length: n }, (_, i) => i * n + (n - 1 - i)));
    linesCache.set(n, out);
    return out;
}
const winningLine = (cells, who, n) => linesOf(n).find((l) => l.every((i) => cells[i] === who)) ?? null;
const anyLineOpen = (cells, n) => linesOf(n).some((l) => { const o = new Set(l.map((i) => cells[i]).filter((v) => v !== null)); return !o.has('x') && o.size <= 1; });
const other = (s, p) => (s.seats[0] === p ? s.seats[1] : s.seats[0]);
const isOpen = (s, o) => s.status[o]?.kind === 'open';
const empties = (b) => b.map((m, i) => (m === null ? i : -1)).filter((i) => i >= 0);
/** Why a switch by `p` to `to` would not apply now (null = it applies). Exported so tools and docs share one rule. */
export function switchRefusal(s, p, to) {
    const ready = (s.lastSwitch[p] ?? 0) + s.config.switchCooldown;
    if (s.go < ready)
        return `cooldown: next switch applies at GO ${ready}`;
    if (to === s.pos[p])
        return 'already on that board';
    if (!isOpen(s, to))
        return `outer cell ${to} is closed`;
    return null;
}
export const CLASH_RULES = {
    'seeded-coin': { label: 'one lands, by seeded coin', rule: (cs, rng) => rng.int(cs.length) },
    incumbent: { label: 'the player there longer lands', rule: (cs, rng) => {
            const best = Math.min(...cs.map((c) => c.arrivedGo));
            const oldest = cs.map((c, i) => (c.arrivedGo === best ? i : -1)).filter((i) => i >= 0);
            return oldest.length === 1 ? oldest[0] : oldest[rng.int(oldest.length)];
        } },
    'both-fail': { label: 'neither lands', rule: () => null },
};
/** Register a new clash rule; it becomes a valid `clash` setting immediately. */
export function registerClashRule(id, label, rule) {
    if (CLASH_RULES[id])
        throw new Error(`clash rule ${id} already registered`);
    CLASH_RULES[id] = { label, rule };
    const field = tacXTic.config.find((f) => f.key === 'clash');
    if (field && field.kind === 'choice')
        field.options.push({ value: id, label });
}
export const DEFAULT_CONFIG = { size: 3, startA: 3, startB: 5, switchCooldown: 3, blindMarkTaken: 'lose', clash: 'seeded-coin', positions: 'public', otherBoards: 'hidden', opponentLastGo: 'public', maxGos: 120 };
export const tacXTic = {
    id: 'tac-x-tic',
    version: '2.0.0',
    title: 'Tac-x-Tic',
    summary: 'A board of boards. Each GO both players commit a plan for staying and for switching; a switch marks blind on arrival.',
    config: [
        { key: 'size', label: 'Board size', kind: 'int', min: 3, max: 3, default: 3, help: 'Fixed at 3 in this version.' },
        { key: 'startA', label: 'Seat A starts on outer cell', kind: 'int', min: 0, max: 8, default: 3 },
        { key: 'startB', label: 'Seat B starts on outer cell', kind: 'int', min: 0, max: 8, default: 5 },
        { key: 'switchCooldown', label: 'GOs between switches (also before the first)', kind: 'int', min: 0, max: 20, default: 3 },
        { key: 'blindMarkTaken', label: 'Blind arrival mark onto a taken cell', kind: 'choice', default: 'lose', options: [
                { value: 'lose', label: 'is lost this GO' }, { value: 'nearest-empty', label: 'goes to the nearest empty cell' }
            ] },
        { key: 'clash', label: 'Two marks on the same cell in one GO', kind: 'choice', default: 'seeded-coin',
            options: Object.entries(CLASH_RULES).map(([value, r]) => ({ value, label: r.label })) },
        { key: 'positions', label: 'Opponent position', kind: 'choice', default: 'public', options: [
                { value: 'public', label: 'public' }, { value: 'hidden', label: 'hidden' }
            ] },
        { key: 'otherBoards', label: 'Other inner boards', kind: 'choice', default: 'hidden', options: [
                { value: 'hidden', label: 'hidden (see only the board you stand on)' }, { value: 'public', label: 'public' }
            ] },
        { key: 'opponentLastGo', label: 'Opponent\'s last GO', kind: 'choice', default: 'public', options: [
                { value: 'public', label: 'branch and mark result are public' }, { value: 'none', label: 'not revealed' }
            ] },
        { key: 'maxGos', label: 'Draw after this many GOs', kind: 'int', min: 10, max: 1000, default: 120 },
    ],
    players: () => ({ min: 2, max: 2 }),
    validateConfig: (c) => (c.startA > 8 || c.startB > 8 ? ['starting cells must be 0..8'] : []),
    setup: ({ config, players }) => {
        const [a, b] = players;
        return {
            config, seats: [a, b], pos: { [a]: config.startA, [b]: config.startB }, lastSwitch: { [a]: 0, [b]: 0 },
            boards: Array.from({ length: 9 }, () => Array(9).fill(null)), status: Array.from({ length: 9 }, () => ({ kind: 'open' })),
            go: 0, history: [], result: null, forfeited: [],
        };
    },
    activePlayers: (s) => (s.result ? [] : s.seats.filter((p) => !s.forfeited.includes(p))),
    observe: (s, player) => {
        const you = player ?? s.seats[0];
        const opp = other(s, you);
        const pos = s.pos[you];
        const go = s.go;
        const last = s.history[s.history.length - 1];
        const spectator = player === null;
        const fe = last?.effects[opp];
        return {
            you, opponent: opp, go, size: 3,
            position: { value: pos, source: 'live', asOf: go },
            board: { value: s.boards[pos].slice(), source: 'live', asOf: go },
            outer: { value: s.status.map((st, cell) => ({ cell, status: st.kind, owner: st.kind === 'won' ? st.by : null })), source: 'public', asOf: go },
            opponentPosition: s.config.positions === 'public' || spectator || s.pos[opp] === pos ? { value: s.pos[opp], source: s.pos[opp] === pos && s.config.positions === 'hidden' ? 'live' : 'public', asOf: go } : null,
            allBoards: s.config.otherBoards === 'public' || spectator ? { value: s.boards.map((b) => b.slice()), source: 'public', asOf: go } : null,
            yourLastGo: last ? { value: JSON.parse(JSON.stringify(last.effects[you])), source: 'live', asOf: last.go } : null,
            opponentLastGo: last && fe && (s.config.opponentLastGo === 'public' || spectator) ? { value: { applied: fe.applied, moved: fe.moved !== null, markResult: fe.markResult }, source: 'public', asOf: last.go } : null,
            switchAppliesFrom: { value: (s.lastSwitch[you] ?? 0) + s.config.switchCooldown, source: 'rule', asOf: go },
            legal: legalOf(s, you),
            rules: { switchCooldown: s.config.switchCooldown, blindMarkTaken: s.config.blindMarkTaken, clash: s.config.clash, positions: s.config.positions, otherBoards: s.config.otherBoards, opponentLastGo: s.config.opponentLastGo, maxGos: s.config.maxGos },
        };
    },
    // Every distinct plan: each stay mark, plus each (switch target × blind mark) paired with the first stay mark.
    // At most 9 + 8×9 = 81 plans; game-agnostic policies (e.g. seeded random) can choose among them.
    legalActions: (s, player) => {
        const l = legalOf(s, player);
        const stay = l.stayMarks[0] ?? 4;
        const plans = l.stayMarks.map((mark) => ({ intent: 'M', stay: { mark } }));
        if (l.switchNow || !l.stayMarks.length)
            for (const to of l.switchTargets)
                for (let mark = 0; mark < 9; mark++)
                    plans.push({ intent: 'S', switch: { to, mark }, stay: { mark: stay } });
        return plans;
    },
    validateAction: (s, player, raw) => {
        if (!raw || typeof raw !== 'object')
            return { ok: false, reason: 'send {"intent":"M","stay":{"mark":4}} or {"intent":"S","switch":{"to":2,"mark":4},"stay":{"mark":4}}' };
        const a = raw;
        if (a.intent !== 'S' && a.intent !== 'M')
            return { ok: false, reason: 'intent must be "S" (switch) or "M" (mark here)' };
        const cell = (v) => Number.isInteger(v) && v >= 0 && v < 9;
        if (!a.stay || !cell(a.stay.mark))
            return { ok: false, reason: 'stay.mark (0-8) is required: it is used when you stay or your switch does not apply' };
        if (a.intent === 'S' && (!a.switch || !cell(a.switch.to) || !cell(a.switch.mark)))
            return { ok: false, reason: 'intent "S" needs switch.to (0-8) and switch.mark (0-8)' };
        if (a.switch !== undefined && (!cell(a.switch?.to) || !cell(a.switch?.mark)))
            return { ok: false, reason: 'switch needs to (0-8) and mark (0-8)' };
        // The stay mark must be an empty cell of your current board if that board is open (you can see it live).
        const pos = s.pos[player];
        if (isOpen(s, pos) && s.boards[pos][a.stay.mark] !== null)
            return { ok: false, reason: `stay.mark ${a.stay.mark} is taken on your board` };
        return { ok: true, action: { intent: a.intent, stay: { mark: a.stay.mark }, ...(a.switch ? { switch: { to: a.switch.to, mark: a.switch.mark } } : {}) } };
    },
    resolve: (s, actions, rng) => {
        const next = { ...s, pos: { ...s.pos }, lastSwitch: { ...s.lastSwitch }, boards: s.boards.map((b) => b.slice()), status: s.status.slice(), history: s.history.slice() };
        const events = [];
        const effects = {};
        const intended = [];
        // 1. Decide which branch applies for each player, against the pre-resolution state.
        for (const p of s.seats) {
            const a = actions[p];
            const e = { intent: a?.intent ?? 'M', applied: 'none', switchRefused: null, moved: null, mark: null, markResult: null, placedAt: null };
            effects[p] = e;
            if (!a)
                continue;
            const refusal = a.intent === 'S' && a.switch ? switchRefusal(s, p, a.switch.to) : null;
            if (a.intent === 'S' && a.switch && refusal === null) {
                e.applied = 'switch';
                e.moved = { from: s.pos[p], to: a.switch.to };
                next.pos[p] = a.switch.to;
                next.lastSwitch[p] = s.go;
                e.mark = { outer: a.switch.to, cell: a.switch.mark, blind: true };
                intended.push({ p, outer: a.switch.to, cell: a.switch.mark, blind: true });
                events.push({ type: 'switch', player: p, from: e.moved.from, to: a.switch.to });
            }
            else {
                if (a.intent === 'S') {
                    e.switchRefused = refusal ?? 'no switch given';
                    events.push({ type: 'switch-refused', player: p, reason: e.switchRefused });
                }
                e.applied = 'stay';
                const pos = s.pos[p];
                if (!isOpen(s, pos)) {
                    e.markResult = 'board-closed';
                    e.mark = { outer: pos, cell: a.stay.mark, blind: false };
                }
                else {
                    e.mark = { outer: pos, cell: a.stay.mark, blind: false };
                    intended.push({ p, outer: pos, cell: a.stay.mark, blind: false });
                }
            }
        }
        // 2. Marks: clashes first (same board, same cell, same GO), then taken cells for blind marks.
        //    The clash rule picks at most one mark to proceed; the coin draw comes from the game RNG, so replays agree.
        const losers = new Set();
        const clashWinner = new Map();
        for (const m of intended) {
            if (losers.has(m) || clashWinner.has(m))
                continue;
            const group = intended.filter((o) => o.outer === m.outer && o.cell === m.cell);
            if (group.length < 2)
                continue;
            // Arrival on this board: a switcher arriving now is newest; otherwise their last switch GO (earlier = longer there).
            const contenders = group.map((o) => ({ player: o.p, blind: o.blind, arrivedGo: o.blind ? s.go : s.lastSwitch[o.p] ?? 0 }));
            const rule = CLASH_RULES[s.config.clash];
            if (!rule)
                throw new Error(`unknown clash rule ${s.config.clash}`);
            const idx = rule.rule(contenders, rng);
            const winner = idx === null ? null : group[idx] ?? null;
            for (const o of group) {
                if (o === winner)
                    clashWinner.set(o, true);
                else
                    losers.add(o);
            }
            events.push({ type: 'clash', outer: m.outer, cell: m.cell, rule: s.config.clash, winner: winner?.p ?? null });
        }
        for (const m of intended) {
            const e = effects[m.p];
            if (losers.has(m)) {
                e.markResult = 'clash';
                continue;
            }
            const board = s.boards[m.outer];
            if (!isOpen(s, m.outer)) {
                e.markResult = 'board-closed';
                continue;
            }
            if (board[m.cell] !== null) {
                if (s.config.blindMarkTaken === 'nearest-empty') {
                    const taken = new Set(intended.filter((o) => o !== m && o.outer === m.outer && !losers.has(o)).map((o) => o.cell));
                    const alt = empties(next.boards[m.outer]).filter((c) => !taken.has(c)).sort((a, b) => dist(a, m.cell) - dist(b, m.cell) || a - b)[0];
                    if (alt !== undefined) {
                        next.boards[m.outer][alt] = m.p;
                        e.markResult = 'redirected';
                        e.placedAt = alt;
                        continue;
                    }
                }
                e.markResult = 'taken';
                continue;
            }
            next.boards[m.outer][m.cell] = m.p;
            e.markResult = 'placed';
            e.placedAt = m.cell;
        }
        for (const p of s.seats) {
            const e = effects[p];
            if (e.mark)
                events.push({ type: 'mark', player: p, outer: e.mark.outer, cell: e.mark.cell, blind: e.mark.blind, result: e.markResult, placedAt: e.placedAt });
        }
        // 3. Inner boards.
        const [a, b] = s.seats;
        const captures = [];
        for (let o = 0; o < 9; o++) {
            if (!isOpen(s, o))
                continue;
            const cells = next.boards[o];
            const la = winningLine(cells, a, 3), lb = winningLine(cells, b, 3);
            if (la && lb) {
                next.status[o] = { kind: 'drawn', reason: 'both completed a line in the same GO' };
                captures.push({ board: o, by: null, reason: 'contested' });
            }
            else if (la || lb) {
                const by = la ? a : b;
                next.status[o] = { kind: 'won', by, line: (la ?? lb) };
                captures.push({ board: o, by, reason: 'line' });
            }
            else if (!anyLineOpen(cells, 3)) {
                next.status[o] = { kind: 'drawn', reason: 'no line can be completed' };
                captures.push({ board: o, by: null, reason: 'dead' });
            }
        }
        for (const c of captures)
            events.push({ type: c.by ? 'capture' : 'board-drawn', board: c.board, by: c.by, reason: c.reason });
        next.history.push({ go: s.go, actions: JSON.parse(JSON.stringify(actions)), effects, captures });
        next.go = s.go + 1;
        // 4. Outer board.
        const outer = next.status.map((st) => (st.kind === 'won' ? st.by : st.kind === 'drawn' ? 'x' : null));
        const oa = winningLine(outer, a, 3), ob = winningLine(outer, b, 3);
        if (oa && ob)
            next.result = { winners: [], reason: 'both completed an outer line in the same GO', line: null };
        else if (oa || ob)
            next.result = { winners: [oa ? a : b], reason: 'three claimed boards in a line', line: (oa ?? ob) };
        else if (!anyLineOpen(outer, 3))
            next.result = { winners: [], reason: 'no outer line can still be completed', line: null };
        else if (next.go >= s.config.maxGos)
            next.result = { winners: [], reason: `draw after ${s.config.maxGos} GOs`, line: null };
        if (next.result)
            events.push({ type: 'match-over', ...next.result });
        return { state: next, events };
    },
    isTerminal: (s) => s.result !== null,
    outcome: (s) => {
        const r = s.result ?? { winners: [], reason: 'unfinished', line: null };
        const scores = {};
        for (const p of s.seats)
            scores[p] = r.winners.includes(p) ? 1 : r.winners.length ? 0 : 0.5;
        return { scores, winners: r.winners, reason: r.reason };
    },
    /** Fallback plan: stay on the first empty cell; if the board is closed, switch to the lowest open cell, marking its centre. */
    defaultAction: (s, player) => {
        const l = legalOf(s, player);
        const stay = l.stayMarks[0] ?? 4;
        if (l.stayMarks.length)
            return { intent: 'M', stay: { mark: stay } };
        if (l.switchTargets.length)
            return { intent: 'S', switch: { to: l.switchTargets[0], mark: 4 }, stay: { mark: stay } };
        return { intent: 'M', stay: { mark: stay } };
    },
    removePlayer: (s, player) => ({ ...s, forfeited: [...s.forfeited, player], result: { winners: [other(s, player)], reason: `${player} forfeited`, line: null } }),
    /** Simulator support: build a full hypothetical state from what a player observed plus its own assumptions.
     *  Unknown boards come from `assumptions.boards` (e.g. the player's remembered snapshots) or are empty. */
    hypothesize: (obs, assumptions, config) => {
        const boards = Array.from({ length: 9 }, (_, o) => (o === obs.position.value ? obs.board.value.slice() : obs.allBoards?.value[o]?.slice() ?? assumptions.boards?.[o]?.slice() ?? Array(9).fill(null)));
        const opp = obs.opponentPosition?.value ?? assumptions.opponentPosition ?? obs.position.value;
        const status = obs.outer.value.map((c) => (c.status === 'won' ? { kind: 'won', by: c.owner, line: [] } : c.status === 'drawn' ? { kind: 'drawn', reason: 'observed' } : { kind: 'open' }));
        const seats = (obs.you < obs.opponent ? [obs.you, obs.opponent] : [obs.opponent, obs.you]);
        return {
            config: { ...config, ...assumptions.config }, seats, pos: { [obs.you]: obs.position.value, [obs.opponent]: opp },
            lastSwitch: { [obs.you]: obs.switchAppliesFrom.value - config.switchCooldown, [obs.opponent]: obs.go - config.switchCooldown },
            boards, status, go: obs.go, history: [], result: null, forfeited: [],
        };
    },
    summarize: (s) => ({
        go: s.go,
        claimed: Object.fromEntries(s.seats.map((p) => [p, s.status.filter((st) => st.kind === 'won' && st.by === p).length])),
        open: s.status.filter((st) => st.kind === 'open').length,
        marks: Object.fromEntries(s.seats.map((p) => [p, s.boards.flat().filter((m) => m === p).length])),
    }),
    metrics: [
        { key: 'boardsClaimed', label: 'Inner boards claimed', higherIsBetter: true },
        { key: 'switches', label: 'Switches applied', higherIsBetter: false },
        { key: 'switchRefused', label: 'Switch intents refused (cooldown etc.)', higherIsBetter: false },
        { key: 'blindLost', label: 'Blind marks lost (taken cell)', higherIsBetter: false },
        { key: 'clashes', label: 'Marks lost to clashes', higherIsBetter: false },
        { key: 'markRate', label: 'Share of GOs that placed a mark', higherIsBetter: true },
    ],
    computeMetrics: ({ states }, player) => {
        const last = states[states.length - 1];
        if (!last)
            return {};
        const h = last.history.map((g) => g.effects[player]).filter((e) => !!e);
        return {
            boardsClaimed: last.status.filter((st) => st.kind === 'won' && st.by === player).length,
            switches: h.filter((e) => e.applied === 'switch').length,
            switchRefused: h.filter((e) => e.switchRefused !== null).length,
            blindLost: h.filter((e) => e.mark?.blind && e.markResult === 'taken').length,
            clashes: h.filter((e) => e.markResult === 'clash').length,
            markRate: h.length ? h.filter((e) => e.markResult === 'placed' || e.markResult === 'redirected').length / h.length : 0,
        };
    },
    describeAction: (a) => (a.intent === 'S' && a.switch ? `SWITCH→${a.switch.to} mark ${a.switch.mark} (else stay ${a.stay.mark})` : `STAY mark ${a.stay.mark}`),
    rulesText: (c) => [
        'Tac-x-Tic: an outer 3x3 board whose cells are inner 3x3 tic-tac-toe boards; cells are numbered 0-8 row-major.',
        'Each GO you and your opponent commit at the same time a plan: {"intent":"M"|"S","stay":{"mark":c},"switch":{"to":o,"mark":c}}.',
        `If intent is "S" and the switch applies, you move to outer cell "to" and immediately place a blind mark on "mark" there; you see that board from the next GO. A switch applies only if at least ${c.switchCooldown} GOs have passed since your last switch (and since the start), the target is open, and it is not your current cell.`,
        `Otherwise you place stay.mark on your current board. A blind mark onto a taken cell ${c.blindMarkTaken === 'lose' ? 'is lost' : 'goes to the nearest empty cell'}. If both of you mark the same cell in the same GO, ${c.clash === 'both-fail' ? 'neither mark lands' : c.clash === 'incumbent' ? 'the player who has been on that board longer lands (coin flip if tied)' : 'a fair coin decides which one lands'}.`,
        'A line on an inner board claims that outer cell; three claimed outer cells in a line wins. Draw when no outer line is possible or after ' + c.maxGos + ' GOs.',
        `You see your own board live${c.otherBoards === 'public' ? ' and every other board' : ''}, every outer cell's status, ${c.positions === 'public' ? "your opponent's position" : "your opponent's position only when you share a board"}${c.opponentLastGo === 'public' ? ", and which branch your opponent used last GO and whether its mark landed" : ''}.`,
    ].join(' '),
};
function dist(a, b) { return Math.max(Math.abs(Math.floor(a / 3) - Math.floor(b / 3)), Math.abs((a % 3) - (b % 3))); }
function legalOf(s, player) {
    if (s.result || s.forfeited.includes(player))
        return { stayMarks: [], switchTargets: [], switchNow: false };
    const pos = s.pos[player];
    const stayMarks = isOpen(s, pos) ? empties(s.boards[pos]) : [];
    const switchTargets = s.status.map((st, i) => (st.kind === 'open' && i !== pos ? i : -1)).filter((i) => i >= 0);
    const switchNow = s.go >= (s.lastSwitch[player] ?? 0) + s.config.switchCooldown;
    return { stayMarks, switchTargets, switchNow };
}
