// Generated from D:/t-t-1/packages/policies/src/random.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
import { createRng } from '../core/index.mjs';
/**
 * Seeded random over the game's enumerable legal actions. Game-agnostic: works for any game that
 * implements legalActions. Memory is per instance; the factory makes a fresh instance per seat per match.
 */
export function seededRandom() {
    let rng = null;
    return {
        info: { id: 'seeded-random', name: 'Seeded random', kind: 'scripted', games: ['*'], version: '1.0.0', deterministic: true,
            description: 'Picks uniformly among legal actions using a per-seat seed.' },
        start: ({ seed }) => { rng = createRng(seed); },
        decide: async (req) => {
            if (!req.legalActions?.length)
                return { action: null, rationale: 'no enumerable legal actions' };
            rng ??= createRng(`${req.matchId}/${req.player}`);
            return { action: rng.pick(req.legalActions), meta: { provider: 'scripted' } };
        },
    };
}
