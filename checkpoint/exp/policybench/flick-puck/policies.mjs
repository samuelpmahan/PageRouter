// Generated from D:/t-t-1/games/flick-puck/src/policies.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
const info = (id, name, description) => ({ id, name, kind: 'scripted', games: ['flick-puck'], version: '0.1.0', deterministic: true, description });
/** Angle (integer degrees, 0 = +x, 90 = down) from a disc to the gap centre on the wall line. */
export function aimAtGap(o, d, offset = 0) {
    const tx = (o.board.gapFrom + o.board.gapTo) / 2 + offset;
    const deg = Math.round((Math.atan2(o.board.wallY - d.y, tx - d.x) * 180) / Math.PI);
    return ((deg % 360) + 360) % 360;
}
/** Is the straight line from disc to the gap centre free of other discs? */
export function laneClear(o, d) {
    const tx = (o.board.gapFrom + o.board.gapTo) / 2, ty = o.board.wallY;
    const r = o.board.discRadius;
    return o.discs.every((e) => {
        if (e.id === d.id)
            return true;
        const vx = tx - d.x, vy = ty - d.y, len2 = vx * vx + vy * vy;
        const t = Math.max(0, Math.min(1, ((e.x - d.x) * vx + (e.y - d.y) * vy) / len2));
        const px = d.x + t * vx - e.x, py = d.y + t * vy - e.y;
        return px * px + py * py > (2 * r) * (2 * r);
    });
}
const mine = (o) => o.discs.filter((d) => d.flickable).sort((a, b) => Math.abs(a.x - (o.board.gapFrom + o.board.gapTo) / 2) - Math.abs(b.x - (o.board.gapFrom + o.board.gapTo) / 2) || a.id - b.id);
/** One disc per GO: the one closest to the gap line, aimed at the gap centre, full power. */
export function sniper() {
    return {
        info: info('fp-sniper', 'Sniper', 'Flicks one disc per GO, the one best lined up with the gap, at full power.'),
        decide: async ({ observation: o }) => {
            const d = mine(o)[0];
            if (!d)
                return { action: { flicks: [] }, rationale: 'nothing resting on my side' };
            return { action: { flicks: [{ disc: d.id, angle: aimAtGap(o, d), power: 100 }] }, rationale: `disc ${d.id} at the gap` };
        },
    };
}
/** Every resting disc, every GO, aimed at the gap. Maximum throughput, maximum crowding. */
export function spray() {
    return {
        info: info('fp-spray', 'Spray', 'Flicks every resting disc every GO, all aimed at the gap.'),
        decide: async ({ observation: o }) => {
            const ds = mine(o);
            const cap = o.rules.flicksPerGo || ds.length;
            return { action: { flicks: ds.slice(0, cap).map((d) => ({ disc: d.id, angle: aimAtGap(o, d), power: 100 })) }, rationale: `${Math.min(cap, ds.length)} discs at once` };
        },
    };
}
/** Only shoots discs whose lane to the gap is clear; otherwise nudges the most central disc sideways toward the gap line. */
export function patient() {
    return {
        info: info('fp-patient', 'Patient', 'Shoots only discs with a clear lane to the gap; otherwise repositions one disc toward the gap line.'),
        decide: async ({ observation: o }) => {
            const ds = mine(o);
            const clear = ds.filter((d) => laneClear(o, d));
            if (clear.length) {
                const cap = o.rules.flicksPerGo || clear.length;
                return { action: { flicks: clear.slice(0, cap).map((d) => ({ disc: d.id, angle: aimAtGap(o, d), power: 100 })) }, rationale: `${clear.length} clear lane(s)` };
            }
            const d = ds[0];
            if (!d)
                return { action: { flicks: [] }, rationale: 'nothing to do' };
            const cx = (o.board.gapFrom + o.board.gapTo) / 2;
            return { action: { flicks: [{ disc: d.id, angle: d.x < cx ? 0 : 180, power: 15 }] }, rationale: `no clear lane: nudge disc ${d.id} toward the gap line` };
        },
    };
}
/**
 * Uses the simulator: for the best-placed disc, tries aim offsets across the gap and keeps the one whose simulated GO
 * sends it across (or, failing that, leaves fewest discs on its side). Spends planning units = candidates × GOs.
 */
export function planner() {
    return {
        info: info('fp-planner', 'Planner', 'Simulates a few aim offsets for its best disc and fires the one that crosses.'),
        decide: async ({ observation: o, simulate, budgets }) => {
            const ds = mine(o);
            const d = ds[0];
            if (!d)
                return { action: { flicks: [] }, rationale: 'nothing resting' };
            const base = { disc: d.id, angle: aimAtGap(o, d), power: 100 };
            if (!simulate)
                return { action: { flicks: [base] }, rationale: 'no simulator: aim at gap centre' };
            const half = (o.board.gapTo - o.board.gapFrom) / 2 - o.board.discRadius;
            const offsets = [0, -half / 2, half / 2, -half * 0.9, half * 0.9];
            let best = base, bestScore = -Infinity, tried = 0;
            for (const off of offsets) {
                if ((budgets?.planningLeft() ?? 0) < 3)
                    break;
                const cand = { disc: d.id, angle: aimAtGap(o, d, off), power: 100 };
                const r = await simulate({ assumptions: {}, me: 'fp-sniper', opponent: 'fp-sniper', gos: 3, firstAction: { flicks: [cand] } });
                tried++;
                const s = r.summary;
                const score = r.outcome ? (r.outcome.winners.includes(o.you) ? 100 : -100) : s ? (s.sides[o.opponent] ?? 0) - (s.sides[o.you] ?? 0) : 0;
                if (score > bestScore) {
                    bestScore = score;
                    best = cand;
                }
            }
            return { action: { flicks: [best] }, rationale: `simulated ${tried} aims; best offset scores ${bestScore}` };
        },
    };
}
