// Generated from D:/t-t-1/packages/pxc/src/match.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * A match composed on the real PxC kernel. Same GameDefinition and Policy contracts as @pb/engine, but every value is a
 * write-once Part and every step is a composition with a receipt:
 *
 *   config, seats, game.*, policy/<seat>       set once (Calculations and inputs)
 *   state/0      = compose(game.setup,   {config, seats})
 *   obs/n/<p>    = compose(game.observe, {state: state/n, seat: seat/<p>})
 *   plan/n/<p>   = compose(policy/<p>,   {obs: obs/n/<p>, turn: turn/n})          (both seats concurrently)
 *   accepted/n/<p> = compose(game.accept, {state: state/n, seat, plan: plan/n/<p>})  (validate or fallback)
 *   state/n+1    = compose(game.resolve, {state: state/n, A: accepted/n/A, B: accepted/n/B, rng: rng/n})
 *
 * Simultaneity is structural: state/n+1 cannot be composed until both accepted plans exist, and neither policy's
 * input mentions the other's plan. Provenance ("what did A know when it chose?") is a walk over receipts.
 * Engine-held metered memory and the simulator are passed in the request as in @pb/engine; memory snapshots are
 * recorded as Parts mem/n/<p> so a branch can restore them.
 */
import { createRng, hashState } from '../core/index.mjs';
import { createMemory, simulateFrom } from '../engine/index.mjs';
import { Part, PxC } from '../../../sources/pxcube/vendor/studio/part-first-kernel/src/pxc.mjs';
export async function runPxcMatch(opts) {
    const { game, config, seats, seed } = opts;
    const players = seats.map((s) => s.player);
    const pxc = new PxC();
    const gameRng = createRng(`${seed}/game`);
    const fallbackRng = createRng(`${seed}/fallback`);
    const decisionMs = opts.decisionMs ?? 5000;
    const maxTurns = opts.maxTurns ?? 500;
    // Calculations. Game functions are wrapped so their inputs are the named Parts; the RNG is threaded explicitly.
    pxc.set('config', new Part(config));
    pxc.set('players', new Part(players));
    pxc.set('game.setup', new Part(({ config: c, players: ps }) => game.setup({ config: c, players: ps, rng: gameRng })));
    pxc.set('game.observe', new Part(({ state, seat }) => JSON.parse(JSON.stringify(game.observe(state, seat)))));
    pxc.set('game.accept', new Part(({ state, seat, plan }) => {
        const v = game.validateAction(state, seat, plan?.action);
        if (v.ok)
            return { action: v.action, status: 'ok' };
        const fb = game.defaultAction?.(state, seat, fallbackRng) ?? null;
        return { action: fb, status: 'fallback', reason: v.reason };
    }));
    pxc.set('game.resolve', new Part(({ state, ...accepted }) => {
        const actions = {};
        for (const p of players) {
            const a = accepted[`seat_${p}`];
            if (a?.action !== null && a?.action !== undefined)
                actions[p] = a.action;
        }
        return game.resolve(state, actions, gameRng).state;
    }));
    for (const p of players)
        pxc.set(`seat/${p}`, new Part(p));
    const memories = new Map(seats.map((s) => [s.player, createMemory(s.budgets?.memorySlots ?? null)]));
    for (const s of seats) {
        await s.policy.start?.({ matchId: `pxc-${seed}`, player: s.player, seed: `${seed}/policy/${s.player}`, gameId: game.id });
        // The policy as a Calculation: observation in, plan (action + rationale + meta) out.
        pxc.set(`policy/${s.player}`, new Part(async ({ obs, turn }) => {
            const memory = memories.get(s.player);
            let planningLeft = s.budgets?.planningUnits ?? Number.POSITIVE_INFINITY;
            const opponent = players.find((q) => q !== s.player);
            let simCalls = 0; // same seeding rule as @pb/engine: (seed, GO, player, own call number)
            const simulate = game.hypothesize ? async (req) => {
                const r = await simulateFrom({ game, config, observation: obs, asker: s.player, opponent, library: opts.policyLibrary ?? {}, req,
                    maxUnits: Number.isFinite(planningLeft) ? planningLeft : 10_000, seed: `${seed}/plan/${turn}/${s.player}/${simCalls++}` });
                planningLeft -= r.unitsCharged;
                return r;
            } : undefined;
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), decisionMs);
            try {
                const d = await Promise.race([
                    s.policy.decide({ matchId: `pxc-${seed}`, game: { id: game.id, version: game.version, title: game.title }, player: s.player, turn,
                        observation: JSON.parse(JSON.stringify(obs)), budget: { decisionMs, matchMs: null }, remainingMatchMs: null, memory, ...(simulate ? { simulate } : {}),
                        budgets: { planningUnits: s.budgets?.planningUnits ?? null, planningLeft: () => (Number.isFinite(planningLeft) ? planningLeft : Number.MAX_SAFE_INTEGER), memorySlots: s.budgets?.memorySlots ?? null } }, ac.signal),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), decisionMs)),
                ]);
                return { action: JSON.parse(JSON.stringify(d.action ?? null)), rationale: typeof d.rationale === 'string' ? d.rationale : null, meta: d.meta ?? null, memory: memory.snapshot() };
            }
            catch (e) {
                return { action: null, rationale: null, meta: { error: e instanceof Error ? e.message : String(e) }, memory: memory.snapshot() };
            }
            finally {
                clearTimeout(timer);
            }
        }));
    }
    await pxc.compose({ into: 'state/0', calculation: 'game.setup', inputs: { config: 'config', players: 'players' } });
    const stateHashes = [hashState(pxc.get('state/0').value)];
    let n = 0;
    for (; n < maxTurns && !game.isTerminal(pxc.get(`state/${n}`).value); n++) {
        pxc.set(`turn/${n}`, new Part(n));
        const active = game.activePlayers(pxc.get(`state/${n}`).value);
        for (const p of active)
            await pxc.compose({ into: `obs/${n}/${p}`, calculation: 'game.observe', inputs: { state: `state/${n}`, seat: `seat/${p}` } });
        // Concurrent decisions; neither plan's inputs include the other's.
        await Promise.all(active.map((p) => pxc.compose({ into: `plan/${n}/${p}`, calculation: `policy/${p}`, inputs: { obs: `obs/${n}/${p}`, turn: `turn/${n}` } })));
        for (const p of active)
            await pxc.compose({ into: `accepted/${n}/${p}`, calculation: 'game.accept', inputs: { state: `state/${n}`, seat: `seat/${p}`, plan: `plan/${n}/${p}` } });
        await pxc.compose({ into: `state/${n + 1}`, calculation: 'game.resolve',
            inputs: { state: `state/${n}`, ...Object.fromEntries(active.map((p) => [`seat_${p}`, `accepted/${n}/${p}`])) } });
        stateHashes.push(hashState(pxc.get(`state/${n + 1}`).value));
    }
    const finalState = pxc.get(`state/${n}`).value;
    const outcome = game.isTerminal(finalState) ? game.outcome(finalState)
        : { scores: Object.fromEntries(players.map((p) => [p, 0])), winners: [], reason: `stopped after ${maxTurns} turns` };
    for (const s of seats)
        await s.policy.end?.({ matchId: `pxc-${seed}`, outcome });
    return { pxc, outcome, finalState, turns: n, stateHashes };
}
/** "What did <player> know when it chose at turn n?" — walk the receipt graph back from plan/n/<player>. */
export function provenance(pxc, address) {
    const byPart = new Map(pxc.entries().map(([a, p]) => [p, a]));
    const seen = new Set();
    const walk = (addr) => {
        if (seen.has(addr))
            return;
        seen.add(addr);
        const comp = pxc.get(addr).composition;
        if (!comp)
            return;
        for (const part of Object.values(comp.inputs)) {
            const a = byPart.get(part);
            if (a)
                walk(a);
        }
    };
    walk(address);
    return [...seen];
}
