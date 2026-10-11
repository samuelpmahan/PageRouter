// Generated from D:/t-t-1/packages/engine/src/match.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * Match orchestration. Logical turns are separate from real-time scheduling: the loop below only
 * advances when all active players have an action; the optional `pace` hook decides how much
 * wall-clock time passes between turns (0 for benchmarks, a delay for live viewing).
 *
 * Isolation guarantees enforced here (tested in test/isolation.test.ts):
 *  - a policy receives game.observe(state, itsSeat) only, deep-copied, never the state itself;
 *  - actions are JSON round-tripped before validation, so policies cannot smuggle objects/functions;
 *  - every action goes through game.validateAction; nothing a policy returns is trusted;
 *  - per-decision timeouts abort the policy's signal; a match clock can bound total time.
 */
import { createRng, hashState, } from '../core/index.mjs';
import { createMemory, simulateFrom } from './simulate.mjs';
export const DEFAULT_SETTINGS = {
    budget: { decisionMs: 10_000, matchMs: null },
    maxRetries: 1,
    onInvalid: 'retry-then-default',
    onTimeout: 'default-action',
    maxTurns: 500,
};
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
class TimeoutError extends Error {
}
async function decideWithTimeout(policy, req, ms, outer, env) {
    const ac = new AbortController();
    const onOuter = () => ac.abort();
    outer?.addEventListener('abort', onOuter, { once: true });
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(() => policy.decide(req, ac.signal, env)),
            new Promise((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new TimeoutError(`no decision within ${ms} ms`)); }, ms); }),
        ]);
    }
    finally {
        clearTimeout(timer);
        outer?.removeEventListener('abort', onOuter);
    }
}
export async function runMatch(opts) {
    const { game, config, participants, seed } = opts;
    const settings = { ...DEFAULT_SETTINGS, ...opts.settings, budget: { ...DEFAULT_SETTINGS.budget, ...opts.settings?.budget } };
    const now = opts.now ?? (() => Date.now());
    const matchId = opts.matchId ?? `m-${seed}-${Math.floor(now()).toString(36)}`;
    const players = participants.map((p) => p.player);
    if (new Set(players).size !== players.length)
        throw new Error('duplicate player ids');
    const byPlayer = new Map(participants.map((p) => [p.player, p]));
    const log = [];
    const emit = (e) => { log.push(e); opts.onEvent?.(e); };
    // Separate streams: the game's rng is a pure function of the seed and the action sequence,
    // so replays reproduce it; fallback/default actions draw from their own stream.
    const gameRng = createRng(`${seed}/game`);
    const fallbackRng = createRng(`${seed}/fallback`);
    let state = game.setup({ config, players, rng: gameRng });
    const states = [clone(state)];
    const actionsLog = [];
    const started = now();
    const clockLeft = new Map(players.map((p) => [p, settings.budget.matchMs]));
    const forfeited = new Set();
    const budgetOf = (p) => ({
        planningUnits: p.budgets?.planningUnits !== undefined ? p.budgets.planningUnits : settings.planningUnits ?? null,
        memorySlots: p.budgets?.memorySlots !== undefined ? p.budgets.memorySlots : settings.memorySlots ?? null,
    });
    const memories = new Map(participants.map((p) => [p.player, createMemory(budgetOf(p).memorySlots)]));
    const records = participants.map((p) => ({
        player: p.player, policyId: p.policy.info.id, policyVersion: p.policy.info.version, kind: p.policy.info.kind,
        deterministic: p.policy.info.deterministic, label: p.label ?? p.policy.info.name, ...budgetOf(p),
    }));
    emit({ t: 'match_started', at: new Date(started).toISOString(), matchId, game: { id: game.id, version: game.version }, config, seed,
        participants: records, settings, tags: opts.tags ?? [], stateHash: hashState(state),
        environments: Object.fromEntries(participants.map((p) => [p.player, p.environment ? clone(p.environment.description) : null])) });
    // Per-GO commit board: who committed, in what order. Used for pending-action exposure (an explicit, recorded condition).
    let commits = [];
    let seq = 0;
    for (const p of participants)
        await p.policy.start?.({ matchId, player: p.player, seed: `${seed}/policy/${p.player}`, gameId: game.id });
    let turn = 0;
    let endReason = 'terminal';
    const rules = game.rulesText?.(config);
    while (!game.isTerminal(state)) {
        if (opts.signal?.aborted) {
            endReason = 'aborted';
            break;
        }
        if (turn >= settings.maxTurns) {
            endReason = 'max-turns';
            break;
        }
        const active = game.activePlayers(state).filter((p) => !forfeited.has(p));
        if (active.length === 0) {
            endReason = 'forfeit';
            break;
        }
        emit({ t: 'turn_started', turn, active, stateHash: hashState(state) });
        commits = [];
        // Simultaneous turns: every active player decides on the same state, concurrently.
        const chosen = await Promise.all(active.map((player) => decideFor(player)));
        const actions = {};
        for (const [i, player] of active.entries()) {
            const c = chosen[i];
            if (c === undefined)
                continue;
            if (c.kind === 'action')
                actions[player] = c.action;
            else {
                forfeited.add(player);
                const next = game.removePlayer?.(state, player);
                if (next)
                    state = next;
                else {
                    endReason = 'forfeit';
                }
            }
        }
        if (endReason === 'forfeit')
            break;
        if (Object.keys(actions).length > 0) {
            const res = game.resolve(state, actions, gameRng);
            state = res.state;
            actionsLog.push(clone(actions));
            states.push(clone(state));
            emit({ t: 'resolved', turn, actions: clone(actions), events: res.events ?? [], stateHash: hashState(state) });
        }
        turn++;
        if (opts.pace && !game.isTerminal(state))
            await opts.pace(turn);
    }
    let outcome;
    if (endReason === 'terminal')
        outcome = game.outcome(state);
    else {
        // Non-terminal end: forfeiting players score lowest; others share the remaining result.
        const scores = {};
        for (const p of players)
            scores[p] = forfeited.has(p) ? -1 : 0;
        const winners = endReason === 'forfeit' ? players.filter((p) => !forfeited.has(p)) : [];
        outcome = { scores, winners, reason: endReason === 'max-turns' ? `stopped after ${settings.maxTurns} turns` : endReason === 'aborted' ? 'stopped by user' : 'opponent forfeited' };
    }
    const metrics = {};
    for (const p of players)
        metrics[p] = game.computeMetrics?.({ states: states, actions: actionsLog, players }, p) ?? {};
    emit({ t: 'match_ended', turn, outcome, reason: endReason, metrics, durationMs: now() - started });
    for (const p of participants)
        await p.policy.end?.({ matchId, outcome });
    return { log, outcome, finalState: state };
    async function decideFor(player) {
        const part = byPlayer.get(player);
        if (!part)
            throw new Error(`no participant for active player ${player}`);
        const observation = clone(game.observe(state, player));
        const legal = game.legalActions?.(state, player);
        const goState = clone(state);
        const env = part.environment?.create({
            matchId, turn, player, state: goState,
            pendingCommits: () => (part.environment?.exposePendingCommits ? clone(commits.filter((c) => c.player !== player)) : []),
            log: () => clone(log),
        }, (r) => emit({ t: 'tool_call', turn, player, seq: seq++, tool: r.tool, args: clone(r.args), result: clone(r.result), cost: r.cost, violation: r.violation }));
        let retry;
        const budget = budgetOf(part);
        const memory = memories.get(player);
        // Planning units are per decision (all attempts of this GO share them).
        let planningLeft = budget.planningUnits ?? Number.POSITIVE_INFINITY;
        let planningSpent = 0;
        const opponents = players.filter((p) => p !== player);
        const library = opts.policyLibrary ?? {};
        // Simulation seeds depend only on (match seed, GO, player, this player's own call number) — never on the global event
        // counter, which interleaves with the other player's concurrent calls and made planning results order-dependent.
        let simCalls = 0;
        const simulate = game.hypothesize && opponents.length === 1 ? async (req) => {
            const res = await simulateFrom({ game, config, observation, asker: player, opponent: opponents[0], library, req,
                maxUnits: Number.isFinite(planningLeft) ? planningLeft : 10_000, seed: `${seed}/plan/${turn}/${player}/${simCalls++}` });
            planningLeft -= res.unitsCharged;
            planningSpent += res.unitsCharged;
            emit({ t: 'tool_call', turn, player, seq: seq++, tool: 'simulate', args: clone(req), result: clone({ ...res }), cost: res.unitsCharged, violation: false });
            return res;
        } : undefined;
        for (let attempt = 0;; attempt++) {
            const left = clockLeft.get(player) ?? null;
            const limit = left === null ? settings.budget.decisionMs : Math.max(0, Math.min(settings.budget.decisionMs, left));
            const t0 = now();
            let status = 'ok';
            let reason;
            let action;
            let decision;
            try {
                decision = await decideWithTimeout(part.policy, {
                    matchId, game: { id: game.id, version: game.version, title: game.title, ...(rules ? { rules } : {}) }, player, turn,
                    observation: clone(observation), ...(legal ? { legalActions: clone(legal) } : {}),
                    budget: settings.budget, remainingMatchMs: left, ...(retry ? { retry } : {}),
                    memory, ...(simulate ? { simulate } : {}),
                    budgets: { planningUnits: budget.planningUnits, planningLeft: () => (Number.isFinite(planningLeft) ? planningLeft : Number.MAX_SAFE_INTEGER), memorySlots: budget.memorySlots },
                }, limit, opts.signal, env);
                action = safeJson(decision?.action);
            }
            catch (e) {
                status = e instanceof TimeoutError ? 'timeout' : 'error';
                reason = e instanceof Error ? e.message : String(e);
            }
            const latency = now() - t0;
            if (left !== null)
                clockLeft.set(player, left - latency);
            if (status === 'ok') {
                const v = game.validateAction(state, player, action);
                if (v.ok) {
                    emit({ t: 'decision', turn, player, attempt, observation, legalActionCount: legal?.length, action, rationale: str(decision?.rationale), meta: decision?.meta, latencyMs: latency, status, planningSpent, memoryAfter: memory.snapshot() });
                    const c = { player, action: clone(v.action), seq: seq++ };
                    commits.push(c);
                    emit({ t: 'commit', turn, player, seq: c.seq });
                    return { kind: 'action', action: v.action };
                }
                status = 'invalid';
                reason = v.reason;
            }
            emit({ t: 'decision', turn, player, attempt, observation, legalActionCount: legal?.length, action, rationale: str(decision?.rationale), meta: decision?.meta, latencyMs: latency, status, reason, planningSpent, memoryAfter: memory.snapshot() });
            const rule = status === 'timeout' ? settings.onTimeout : settings.onInvalid;
            const canRetry = (rule === 'retry-then-forfeit' || rule === 'retry-then-default') && attempt < settings.maxRetries && status !== 'timeout';
            if (canRetry) {
                retry = { attempt: attempt + 1, previousAction: action, reason: reason ?? status };
                continue;
            }
            const wantsDefault = rule === 'default-action' || rule === 'retry-then-default';
            const fallback = wantsDefault ? game.defaultAction?.(state, player, fallbackRng) ?? null : null;
            if (fallback !== null) {
                emit({ t: 'fallback', turn, player, kind: 'default-action', action: fallback, reason: `${status}: ${reason ?? ''}`.trim() });
                return { kind: 'action', action: fallback };
            }
            emit({ t: 'fallback', turn, player, kind: 'forfeit', reason: `${status}: ${reason ?? ''}`.trim() });
            return { kind: 'forfeit' };
        }
    }
}
function safeJson(v) {
    try {
        return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    }
    catch {
        return undefined;
    }
}
function str(v) { return typeof v === 'string' ? v.slice(0, 4000) : undefined; }
