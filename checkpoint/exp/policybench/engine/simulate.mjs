// Generated from D:/t-t-1/packages/engine/src/simulate.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * Hypothetical play for planning. Starts from game.hypothesize(observation, assumptions): a state built only from
 * what the asking player observed plus what it chose to assume, so simulating can never reveal hidden state.
 * Simulated policies get no memory, no simulator and no environment (no recursion), and a short decision timeout.
 */
import { createRng } from '../core/index.mjs';
export async function simulateFrom(args) {
    const { game, req } = args;
    const fail = (error) => ({ ok: false, error, gosRun: 0, outcome: null, summary: null, unitsCharged: 0 });
    if (!game.hypothesize)
        return fail('this game has no simulator');
    const mk = (id) => args.library[id];
    const me = mk(req.me), opp = mk(req.opponent);
    if (!me || !opp)
        return fail(`unknown policy id; available: ${Object.keys(args.library).join(', ')}`);
    const gos = Math.max(0, Math.min(Math.floor(Number(req.gos) || 0), args.maxUnits));
    if (gos === 0)
        return fail(args.maxUnits <= 0 ? 'planning budget exhausted' : 'gos must be at least 1');
    let state;
    try {
        state = game.hypothesize(JSON.parse(JSON.stringify(args.observation)), req.assumptions ?? {}, args.config);
    }
    catch (e) {
        return fail(`could not build a hypothetical state: ${e instanceof Error ? e.message : String(e)}`);
    }
    const policies = { [args.asker]: me(), [args.opponent]: opp() };
    const rng = createRng(`${args.seed}/sim`);
    for (const [p, pol] of Object.entries(policies))
        await pol.start?.({ matchId: 'sim', player: p, seed: `${args.seed}/sim/${p}`, gameId: game.id });
    let run = 0;
    for (; run < gos && !game.isTerminal(state); run++) {
        const actions = {};
        for (const p of game.activePlayers(state)) {
            let action = run === 0 && p === args.asker && req.firstAction !== undefined ? req.firstAction : undefined;
            if (action === undefined) {
                const ac = new AbortController();
                const t = setTimeout(() => ac.abort(), 200);
                try {
                    const d = await policies[p].decide({ matchId: 'sim', game: { id: game.id, version: game.version, title: game.title }, player: p, turn: run,
                        observation: game.observe(state, p), budget: { decisionMs: 200, matchMs: null }, remainingMatchMs: null }, ac.signal);
                    action = JSON.parse(JSON.stringify(d.action ?? null));
                }
                catch {
                    action = null;
                }
                finally {
                    clearTimeout(t);
                }
            }
            const v = game.validateAction(state, p, action);
            const final = v.ok ? v.action : game.defaultAction?.(state, p, rng) ?? null;
            if (final !== null)
                actions[p] = final;
        }
        state = game.resolve(state, actions, rng).state;
    }
    const outcome = game.isTerminal(state) ? game.outcome(state) : null;
    return { ok: true, gosRun: run, outcome: outcome ? { winners: outcome.winners, reason: outcome.reason } : null,
        summary: game.summarize?.(state) ?? null, unitsCharged: Math.max(1, run) };
}
/** Metered key-value memory (one slot per key). */
export function createMemory(capacity) {
    const data = new Map();
    return {
        capacity,
        get: (k) => { const v = data.get(k); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); },
        set: (k, v) => {
            if (typeof k !== 'string' || !k)
                return { ok: false, reason: 'key must be a non-empty string' };
            let json;
            try {
                json = JSON.stringify(v);
            }
            catch {
                return { ok: false, reason: 'value must be JSON' };
            }
            if (json === undefined)
                return { ok: false, reason: 'value must be JSON' };
            if (json.length > 4096)
                return { ok: false, reason: 'value larger than 4096 characters' };
            if (!data.has(k) && capacity !== null && data.size >= capacity)
                return { ok: false, reason: `memory full (${capacity} slots); delete a key first` };
            data.set(k, JSON.parse(json));
            return { ok: true };
        },
        delete: (k) => { data.delete(k); },
        keys: () => [...data.keys()],
        used: () => data.size,
        snapshot: () => Object.fromEntries([...data.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
        restore: (m) => { data.clear(); for (const [k, v] of Object.entries(m))
            data.set(k, v); },
    };
}
