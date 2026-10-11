// Generated from D:/t-t-1/packages/core/src/registry.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
export class Registry {
    games = new Map();
    policies = new Map();
    registerGame(game) {
        const key = game.id;
        if (this.games.has(key))
            throw new Error(`game ${key} is already registered`);
        this.games.set(key, game);
    }
    game(id) {
        const g = this.games.get(id);
        if (!g)
            throw new Error(`unknown game "${id}" (registered: ${[...this.games.keys()].join(', ') || 'none'})`);
        return g;
    }
    listGames() { return [...this.games.values()]; }
    registerPolicy(info, create) {
        if (this.policies.has(info.id))
            throw new Error(`policy ${info.id} is already registered`);
        this.policies.set(info.id, { info, create });
    }
    policy(id) {
        const p = this.policies.get(id);
        if (!p)
            throw new Error(`unknown policy "${id}"`);
        return p;
    }
    /** Policies usable for a game (game-agnostic ones included). */
    policiesFor(gameId) {
        return [...this.policies.values()].map((p) => p.info).filter((i) => i.games.includes('*') || i.games.includes(gameId));
    }
}
/** Fill defaults and check a config against the game's declared fields. */
export function resolveConfig(game, partial, playerCount) {
    const config = {};
    const errors = [];
    for (const f of game.config) {
        const v = partial?.[f.key] ?? f.default;
        errors.push(...checkField(f, v));
        config[f.key] = v;
    }
    for (const k of Object.keys(partial ?? {}))
        if (!game.config.some((f) => f.key === k))
            errors.push(`unknown rule "${k}"`);
    const pc = game.players(config);
    if (playerCount < pc.min || playerCount > pc.max)
        errors.push(`${game.title} needs ${pc.min === pc.max ? pc.min : `${pc.min}-${pc.max}`} players with these rules, got ${playerCount}`);
    if (!errors.length && game.validateConfig)
        errors.push(...game.validateConfig(config, playerCount));
    return { config, errors };
}
function checkField(f, v) {
    if (f.kind === 'int')
        return Number.isInteger(v) && v >= f.min && v <= f.max ? [] : [`${f.label} must be a whole number from ${f.min} to ${f.max}`];
    if (f.kind === 'bool')
        return typeof v === 'boolean' ? [] : [`${f.label} must be on or off`];
    return f.options.some((o) => o.value === v) ? [] : [`${f.label} must be one of ${f.options.map((o) => o.value).join(', ')}`];
}
