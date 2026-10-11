// Generated from D:/t-t-1/games/tac-x-tic/src/capabilities.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * Tac-x-Tic's capability graph: contracts (what is implemented), implementations, and the slots each one supports.
 * Every check actually runs (through PxC, see CapabilityGraph.prove) and produces a conformance receipt.
 *
 *   tac-x-tic (implements "game")             supports clash â† "txt.clash-rule", seatA/seatB â† "txt.policy"
 *   txt-stayer, â€¦, contrib-classifier          implement "txt.policy"
 *   seeded-coin | incumbent | both-fail        implement "txt.clash-rule"
 */
import { createRng, hashState, resolveConfig } from '../core/index.mjs';
import { CapabilityGraph } from '../pxc/index.mjs';
import { tacXTic, CLASH_RULES } from './game.mjs';
/** Reachable (state, seat, observation) samples from seeded random play, under several rule settings. */
export function samplePositions(n = 60, seed = 'cap') {
    const out = [];
    const settings = [{}, { positions: 'hidden' }, { switchCooldown: 1 }, { startA: 4, startB: 4 }];
    for (let k = 0; out.length < n && k < 40; k++) {
        const { config } = resolveConfig(tacXTic, settings[k % settings.length], 2);
        const rng = createRng(`${seed}/${k}`);
        let s = tacXTic.setup({ config: config, players: ['A', 'B'], rng });
        for (let go = 0; go < 30 && !tacXTic.isTerminal(s); go++) {
            const acts = {};
            for (const p of tacXTic.activePlayers(s)) {
                if (rng.next() < 0.25)
                    out.push({ state: s, seat: p, obs: tacXTic.observe(s, p) });
                const legal = tacXTic.legalActions(s, p);
                if (legal.length)
                    acts[p] = rng.pick(legal);
            }
            s = tacXTic.resolve(s, acts, rng).state;
        }
    }
    return out.slice(0, n);
}
const ok = (pass, detail) => ({ ok: pass, ...(pass || !detail ? {} : { detail }) });
export function buildTxtGraph(policies) {
    const g = new CapabilityGraph();
    g.contract({
        id: 'game', description: 'A PolicyBench game: pure functions over JSON state (setup, observe, validate, resolve, outcome).',
        consumes: { config: { description: 'validated rule settings' }, actions: { description: 'one action per active player' } },
        emits: { state: { description: 'next JSON state' }, observation: { description: 'per-seat projection' }, outcome: { description: 'scores and winners' } },
        checks: [
            { id: 'rejects-junk', description: 'validateAction refuses malformed input without throwing', run: (game) => {
                    const { config } = resolveConfig(game, {}, 2);
                    const s = game.setup({ config, players: ['A', 'B'], rng: createRng('x') });
                    const junk = [null, 7, 'place', {}, { intent: 'S' }, { intent: 'M', stay: { mark: 99 } }, { kind: 'place', cell: 1 }];
                    const bad = junk.filter((j) => { try {
                        return game.validateAction(s, 'A', j).ok;
                    }
                    catch {
                        return true;
                    } });
                    return ok(bad.length === 0, `accepted or threw on ${JSON.stringify(bad)}`);
                } },
            { id: 'deterministic', description: 'same seed and actions give the same state hashes', run: (game) => {
                    const run = () => {
                        const { config } = resolveConfig(game, {}, 2);
                        const rng = createRng('det');
                        let s = game.setup({ config, players: ['A', 'B'], rng });
                        const hs = [];
                        for (let i = 0; i < 25 && !game.isTerminal(s); i++) {
                            const a = {};
                            for (const p of game.activePlayers(s)) {
                                const l = game.legalActions?.(s, p) ?? [];
                                if (l.length)
                                    a[p] = l[i % l.length];
                            }
                            s = game.resolve(s, a, rng).state;
                            hs.push(hashState(s));
                        }
                        return hs.join(',');
                    };
                    return ok(run() === run(), 'two identical runs diverged');
                } },
            { id: 'observation-hides-other-boards', description: 'with default rules a seat does not observe boards it is not on', run: (game) => {
                    const sample = samplePositions(30).filter((x) => x.state.config.otherBoards === 'hidden');
                    const leak = sample.find((x) => x.obs.allBoards !== null);
                    return ok(!leak, 'allBoards present under otherBoards=hidden');
                } },
        ],
    });
    g.contract({
        id: 'txt.policy', description: 'A Tac-x-Tic policy: observation (+ metered memory, simulator) â†’ a plan for both branches.',
        consumes: { observation: { description: 'TxtObservation with sourced facts' }, memory: { description: 'metered, optional' }, simulate: { description: 'planning units, optional' }, legalActions: { description: 'every legal plan, as the engine supplies them' } },
        emits: { plan: { description: '{ intent, stay, switch? }' }, predictions: { description: 'optional calibrated markLands' } },
        checks: [
            { id: 'valid-plans', description: 'returns a valid plan on 60 reachable positions, never throws', run: async (factory) => {
                    const fails = [];
                    for (const [i, x] of samplePositions().entries()) {
                        try {
                            const d = await factory().decide({ matchId: 'cap', game: { id: 'tac-x-tic', version: '2', title: 'Tac-x-Tic' }, player: x.seat, turn: x.state.go, observation: x.obs, legalActions: tacXTic.legalActions(x.state, x.seat), budget: { decisionMs: 2000, matchMs: null }, remainingMatchMs: null }, new AbortController().signal);
                            const v = tacXTic.validateAction(x.state, x.seat, d.action);
                            if (!v.ok)
                                fails.push(`#${i}: ${v.reason}`);
                        }
                        catch (e) {
                            fails.push(`#${i}: threw ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                    return ok(fails.length === 0, `${fails.length}/60 invalid, e.g. ${fails.slice(0, 2).join('; ')}`);
                } },
            { id: 'fresh-instances-agree', description: 'two fresh instances give the same action (no shared module state, deterministic)', run: async (factory) => {
                    const diffs = [];
                    for (const [i, x] of samplePositions(30, 'cap2').entries()) {
                        const req = { matchId: 'cap', game: { id: 'tac-x-tic', version: '2', title: 'Tac-x-Tic' }, player: x.seat, turn: x.state.go, observation: x.obs, legalActions: tacXTic.legalActions(x.state, x.seat), budget: { decisionMs: 2000, matchMs: null }, remainingMatchMs: null };
                        const a = await factory().decide(req, new AbortController().signal);
                        const b = await factory().decide(req, new AbortController().signal);
                        if (JSON.stringify(a.action) !== JSON.stringify(b.action))
                            diffs.push(i);
                    }
                    return ok(diffs.length === 0, `differed at positions ${diffs.join(',')}`);
                } },
            { id: 'predictions-are-probabilities', description: 'meta.predictions.markLands, when reported, is within [0, 1]', run: async (factory) => {
                    const bad = [];
                    for (const x of samplePositions(30, 'cap3')) {
                        const d = await factory().decide({ matchId: 'cap', game: { id: 'tac-x-tic', version: '2', title: 'Tac-x-Tic' }, player: x.seat, turn: x.state.go, observation: x.obs, legalActions: tacXTic.legalActions(x.state, x.seat), budget: { decisionMs: 2000, matchMs: null }, remainingMatchMs: null }, new AbortController().signal);
                        const p = d.meta?.predictions?.markLands;
                        if (p !== undefined && !(typeof p === 'number' && p >= 0 && p <= 1))
                            bad.push(String(p));
                    }
                    return ok(bad.length === 0, `out-of-range predictions: ${bad.slice(0, 3).join(', ')}`);
                } },
        ],
    });
    g.contract({
        id: 'txt.clash-rule', description: 'Given marks contending for one cell, choose the one that lands (or none).',
        consumes: { contenders: { description: '[{player, blind, arrivedGo}]' }, rng: { description: 'the match game RNG' } },
        emits: { winner: { description: 'index into contenders, or null' } },
        checks: [
            { id: 'at-most-one-in-range', description: 'returns null or a valid index, for 2-4 contenders', run: (rule) => {
                    const rng = createRng('clash');
                    for (let k = 0; k < 200; k++) {
                        const n = 2 + (k % 3);
                        const cs = Array.from({ length: n }, (_, i) => ({ player: `P${i}`, blind: (k + i) % 2 === 0, arrivedGo: (k * 7 + i * 3) % 5 }));
                        const w = rule(cs, rng);
                        if (!(w === null || (Number.isInteger(w) && w >= 0 && w < n)))
                            return ok(false, `returned ${w} for ${n} contenders`);
                    }
                    return ok(true);
                } },
            { id: 'replayable', description: 'same RNG seed gives the same choices', run: (rule) => {
                    const seq = () => { const rng = createRng('rep'); return Array.from({ length: 50 }, (_, k) => rule([{ player: 'A', blind: false, arrivedGo: k % 3 }, { player: 'B', blind: true, arrivedGo: k % 2 }], rng)).join(','); };
                    return ok(seq() === seq(), 'different choices from the same seed');
                } },
        ],
    });
    g.implement({ id: 'tac-x-tic', implements: 'game', description: tacXTic.summary, value: tacXTic, origin: 'games/tac-x-tic/src/game.ts (v2.0.0)',
        supports: { clash: { contract: 'txt.clash-rule', default: 'clash:seeded-coin' }, seatA: { contract: 'txt.policy', default: 'txt-stayer' }, seatB: { contract: 'txt.policy', default: 'txt-stayer' } } });
    for (const [id, r] of Object.entries(CLASH_RULES))
        g.implement({ id: `clash:${id}`, implements: 'txt.clash-rule', description: r.label, value: r.rule, origin: 'games/tac-x-tic/src/game.ts CLASH_RULES' });
    for (const [id, p] of Object.entries(policies))
        g.implement({ id, implements: 'txt.policy', description: p.description, value: p.factory, origin: p.origin });
    return g;
}
