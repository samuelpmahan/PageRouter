// Generated from D:/t-t-1/packages/engine/src/replay.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * Replay a match from its log: re-run setup and resolve on the recorded actions with the recorded
 * seed and compare every state hash. A mismatch means the game (or its version) is not deterministic,
 * which disqualifies the match from verified benchmarks.
 */
import { createRng, hashState } from '../core/index.mjs';
export function replay(game, log) {
    const start = log.find((e) => e.t === 'match_started');
    if (!start || start.t !== 'match_started')
        throw new Error('log has no match_started event');
    if (start.game.id !== game.id)
        throw new Error(`log is for ${start.game.id}, not ${game.id}`);
    const players = start.participants.map((p) => p.player);
    const rng = createRng(`${start.seed}/game`);
    let state = game.setup({ config: start.config, players, rng });
    const frames = [{ turn: -1, state: structuredClone(state) }];
    const mismatches = [];
    const firstHash = hashState(state);
    if (firstHash !== start.stateHash)
        mismatches.push({ turn: -1, expected: start.stateHash, got: firstHash });
    for (const e of log) {
        if (e.t === 'fallback' && e.kind === 'forfeit') {
            const next = game.removePlayer?.(state, e.player);
            if (next)
                state = next;
        }
        if (e.t !== 'resolved')
            continue;
        const res = game.resolve(state, e.actions, rng);
        state = res.state;
        const h = hashState(state);
        if (h !== e.stateHash)
            mismatches.push({ turn: e.turn, expected: e.stateHash, got: h });
        frames.push({ turn: e.turn, state: structuredClone(state), actions: e.actions, events: res.events ?? [] });
    }
    return { frames, ok: mismatches.length === 0, mismatches };
}
