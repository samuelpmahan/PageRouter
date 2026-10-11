// Generated from D:/t-t-1/games/flick-puck/src/game.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/** sin(d°) × 10000 for d = 0..359, generated once and frozen as data (not computed at runtime). */
const SIN = Object.freeze([0, 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, 1736, 1908, 2079, 2250, 2419, 2588, 2756, 2924, 3090, 3256, 3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, 5000, 5150, 5299, 5446, 5592, 5736, 5878, 6018, 6157, 6293, 6428, 6561, 6691, 6820, 6947, 7071, 7193, 7314, 7431, 7547, 7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572, 8660, 8746, 8829, 8910, 8988, 9063, 9135, 9205, 9272, 9336, 9397, 9455, 9511, 9563, 9613, 9659, 9703, 9744, 9781, 9816, 9848, 9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, 10000, 9998, 9994, 9986, 9976, 9962, 9945, 9925, 9903, 9877, 9848, 9816, 9781, 9744, 9703, 9659, 9613, 9563, 9511, 9455, 9397, 9336, 9272, 9205, 9135, 9063, 8988, 8910, 8829, 8746, 8660, 8572, 8480, 8387, 8290, 8192, 8090, 7986, 7880, 7771, 7660, 7547, 7431, 7314, 7193, 7071, 6947, 6820, 6691, 6561, 6428, 6293, 6157, 6018, 5878, 5736, 5592, 5446, 5299, 5150, 5000, 4848, 4695, 4540, 4384, 4226, 4067, 3907, 3746, 3584, 3420, 3256, 3090, 2924, 2756, 2588, 2419, 2250, 2079, 1908, 1736, 1564, 1392, 1219, 1045, 872, 698, 523, 349, 175, 0, -175, -349, -523, -698, -872, -1045, -1219, -1392, -1564, -1736, -1908, -2079, -2250, -2419, -2588, -2756, -2924, -3090, -3256, -3420, -3584, -3746, -3907, -4067, -4226, -4384, -4540, -4695, -4848, -5000, -5150, -5299, -5446, -5592, -5736, -5878, -6018, -6157, -6293, -6428, -6561, -6691, -6820, -6947, -7071, -7193, -7314, -7431, -7547, -7660, -7771, -7880, -7986, -8090, -8192, -8290, -8387, -8480, -8572, -8660, -8746, -8829, -8910, -8988, -9063, -9135, -9205, -9272, -9336, -9397, -9455, -9511, -9563, -9613, -9659, -9703, -9744, -9781, -9816, -9848, -9877, -9903, -9925, -9945, -9962, -9976, -9986, -9994, -9998, -10000, -9998, -9994, -9986, -9976, -9962, -9945, -9925, -9903, -9877, -9848, -9816, -9781, -9744, -9703, -9659, -9613, -9563, -9511, -9455, -9397, -9336, -9272, -9205, -9135, -9063, -8988, -8910, -8829, -8746, -8660, -8572, -8480, -8387, -8290, -8192, -8090, -7986, -7880, -7771, -7660, -7547, -7431, -7314, -7193, -7071, -6947, -6820, -6691, -6561, -6428, -6293, -6157, -6018, -5878, -5736, -5592, -5446, -5299, -5150, -5000, -4848, -4695, -4540, -4384, -4226, -4067, -3907, -3746, -3584, -3420, -3256, -3090, -2924, -2756, -2588, -2419, -2250, -2079, -1908, -1736, -1564, -1392, -1219, -1045, -872, -698, -523, -349, -175]);
const sin = (deg) => SIN[((deg % 360) + 360) % 360];
const cos = (deg) => sin(deg + 90);
/** Integer square root (floor), exact for all safe integers. */
export function isqrt(n) {
    if (n <= 0)
        return 0;
    let x = Math.floor(Math.sqrt(n)); // initial guess only; corrected below so the result never depends on Math.sqrt rounding
    while (x * x > n)
        x--;
    while ((x + 1) * (x + 1) <= n)
        x++;
    return x;
}
export const U = 100; // fixed-point: 1 board unit = 100 internal units
const R = 9 * U; // disc radius
const WALL = 6 * U; // centre wall thickness
const VMAX = 40 * U; // max launch speed per tick
const REST = 6; // speed below which a disc is stopped dead (internal units / tick)
const RESTITUTION = 850; // per mille kept on wall bounce
const dims = (c) => ({ W: c.width * U, H: c.height * U, wallY: (c.height * U) / 2, g0: ((c.width - c.gap) * U) / 2, g1: ((c.width + c.gap) * U) / 2 });
export function sideOf(s, d) {
    const { wallY } = dims(s.config);
    if (d.y - R > wallY + WALL / 2)
        return s.seats[0];
    if (d.y + R < wallY - WALL / 2)
        return s.seats[1];
    return null;
}
const speed2 = (d) => d.vx * d.vx + d.vy * d.vy;
const resting = (d) => speed2(d) <= REST * REST;
/** One fixed physics step. Pure integer arithmetic; disc order is by id, so results never depend on iteration order. */
export function step(s) {
    const { W, H, wallY, g0, g1 } = dims(s.config);
    for (const d of s.discs) {
        d.x += d.vx;
        d.y += d.vy;
        // side walls and end walls
        if (d.x < R) {
            d.x = R;
            d.vx = Math.trunc((-d.vx * RESTITUTION) / 1000);
        }
        if (d.x > W - R) {
            d.x = W - R;
            d.vx = Math.trunc((-d.vx * RESTITUTION) / 1000);
        }
        if (d.y < R) {
            d.y = R;
            d.vy = Math.trunc((-d.vy * RESTITUTION) / 1000);
        }
        if (d.y > H - R) {
            d.y = H - R;
            d.vy = Math.trunc((-d.vy * RESTITUTION) / 1000);
        }
        // centre wall: a disc may be inside the wall band only if it fits entirely within the gap
        const inBand = d.y + R > wallY - WALL / 2 && d.y - R < wallY + WALL / 2;
        const fits = d.x - R >= g0 && d.x + R <= g1;
        if (inBand && !fits) {
            const fromBelow = d.vy < 0 || (d.vy === 0 && d.y > wallY);
            d.y = fromBelow ? wallY + WALL / 2 + R : wallY - WALL / 2 - R;
            d.vy = Math.trunc((-d.vy * RESTITUTION) / 1000);
        }
        d.vx = Math.trunc((d.vx * s.config.friction) / 1000);
        d.vy = Math.trunc((d.vy * s.config.friction) / 1000);
        if (resting(d)) {
            d.vx = 0;
            d.vy = 0;
        }
    }
    // disc–disc collisions (equal mass, along the line of centres), pairs in id order
    for (let i = 0; i < s.discs.length; i++)
        for (let j = i + 1; j < s.discs.length; j++) {
            const a = s.discs[i], b = s.discs[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 >= 4 * R * R || dist2 === 0)
                continue;
            const dist = isqrt(dist2) || 1;
            const vn = Math.trunc(((b.vx - a.vx) * dx + (b.vy - a.vy) * dy) / dist);
            if (vn < 0) {
                const ix = Math.trunc((vn * dx) / dist), iy = Math.trunc((vn * dy) / dist);
                a.vx += ix;
                a.vy += iy;
                b.vx -= ix;
                b.vy -= iy;
            }
            const push = Math.trunc((2 * R - dist) / 2) + 1;
            const px = Math.trunc((push * dx) / dist), py = Math.trunc((push * dy) / dist);
            a.x -= px;
            a.y -= py;
            b.x += px;
            b.y += py;
        }
}
function flickable(s, p) {
    const g = (s.config.grabSpeed * U) / 10;
    return s.discs.filter((d) => sideOf(s, d) === p && (resting(d) || speed2(d) <= g * g));
}
export const DEFAULT_FP = { width: 200, height: 360, gap: 30, discsPerSide: 5, flicksPerGo: 0, ticksPerGo: 12, aimNoise: 0, friction: 940, grabSpeed: 10, maxGos: 400 };
export const flickPuck = {
    // (friction and grabSpeed are rules: how fast pucks settle, and whether you may grab a still-moving one)
    id: 'flick-puck',
    version: '0.1.0',
    title: 'Flick Puck',
    summary: 'Flick your discs through the gap in the centre wall. Empty your side to win; the last one holding discs loses.',
    config: [
        { key: 'width', label: 'Board width', kind: 'int', min: 120, max: 400, default: 200 },
        { key: 'height', label: 'Board length', kind: 'int', min: 200, max: 600, default: 360 },
        { key: 'gap', label: 'Gap in the centre wall', kind: 'int', min: 20, max: 120, default: 30, help: 'A disc is 18 wide.' },
        { key: 'discsPerSide', label: 'Discs per side', kind: 'int', min: 1, max: 8, default: 5 },
        { key: 'flicksPerGo', label: 'Flicks per GO (0 = as many as you want)', kind: 'int', min: 0, max: 8, default: 0 },
        { key: 'ticksPerGo', label: 'Physics steps per GO', kind: 'int', min: 1, max: 60, default: 12 },
        { key: 'aimNoise', label: 'Aim noise (± degrees, seeded)', kind: 'int', min: 0, max: 30, default: 0 },
        { key: 'friction', label: 'Speed kept per physics step (per mille)', kind: 'int', min: 850, max: 995, default: 940 },
        { key: 'grabSpeed', label: 'Max speed you can still flick a disc at (units/step ×10; 0 = stopped only)', kind: 'int', min: 0, max: 100, default: 10 },
        { key: 'maxGos', label: 'Stop after this many GOs', kind: 'int', min: 20, max: 2000, default: 400 },
    ],
    players: () => ({ min: 2, max: 2 }),
    validateConfig: (c) => (c.gap * U < 2 * R ? [`the gap (${c.gap}) must be wider than a disc (${(2 * R) / U})`] : []),
    setup: ({ config, players }) => {
        const [a, b] = players;
        const { W, H } = dims(config);
        const discs = [];
        const n = config.discsPerSide;
        for (let i = 0; i < n; i++) {
            const x = Math.trunc((W * (i + 1)) / (n + 1));
            discs.push({ id: i, x, y: H - 4 * R, vx: 0, vy: 0 }); // A's side (bottom)
            discs.push({ id: n + i, x, y: 4 * R, vx: 0, vy: 0 }); // B's side (top)
        }
        discs.sort((p, q) => p.id - q.id);
        return { config, seats: [a, b], discs, go: 0, history: [], result: null, forfeited: [] };
    },
    activePlayers: (s) => (s.result ? [] : s.seats.filter((p) => !s.forfeited.includes(p))),
    observe: (s, player) => {
        const you = player ?? s.seats[0];
        const opp = s.seats[0] === you ? s.seats[1] : s.seats[0];
        const { wallY, g0, g1 } = dims(s.config);
        const mine = new Set(flickable(s, you).map((d) => d.id));
        const discs = s.discs.map((d) => {
            const side = sideOf(s, d);
            return { id: d.id, x: d.x / U, y: d.y / U, vx: d.vx / U, vy: d.vy / U, side: (side === you ? 'yours' : side === null ? 'wall' : 'theirs'), flickable: mine.has(d.id) };
        });
        return {
            you, opponent: opp, go: s.go, yourSide: you === s.seats[0] ? 'bottom' : 'top',
            board: { width: s.config.width, height: s.config.height, gap: s.config.gap, gapFrom: g0 / U, gapTo: g1 / U, wallY: wallY / U, discRadius: R / U },
            discs, counts: { yours: discs.filter((d) => d.side === 'yours').length, theirs: discs.filter((d) => d.side === 'theirs').length },
            rules: { flicksPerGo: s.config.flicksPerGo, ticksPerGo: s.config.ticksPerGo, aimNoise: s.config.aimNoise, friction: s.config.friction, grabSpeed: s.config.grabSpeed, maxGos: s.config.maxGos },
        };
    },
    // Flicks are continuous (angle × power), so there is no enumeration; policies get every disc in the observation.
    validateAction: (s, player, raw) => {
        const a = raw;
        if (!a || typeof a !== 'object' || !Array.isArray(a.flicks))
            return { ok: false, reason: 'send {"flicks":[{"disc":id,"angle":0-359,"power":1-100}, ...]} (an empty list means wait)' };
        const ok = new Set(flickable(s, player).map((d) => d.id));
        const seen = new Set();
        const flicks = [];
        for (const f of a.flicks) {
            if (!f || !Number.isInteger(f.disc) || !Number.isInteger(f.angle) || !Number.isInteger(f.power))
                return { ok: false, reason: 'each flick needs integer disc, angle (degrees) and power (1-100)' };
            const disc = f.disc, power = f.power;
            if (!ok.has(disc))
                return { ok: false, reason: `disc ${disc} is not on your side or is moving too fast to grab` };
            if (seen.has(disc))
                return { ok: false, reason: `disc ${disc} flicked twice in one GO` };
            if (power < 1 || power > 100)
                return { ok: false, reason: 'power must be 1-100' };
            seen.add(disc);
            flicks.push({ disc, angle: ((f.angle % 360) + 360) % 360, power });
        }
        if (s.config.flicksPerGo > 0 && flicks.length > s.config.flicksPerGo)
            return { ok: false, reason: `at most ${s.config.flicksPerGo} flicks per GO` };
        return { ok: true, action: { flicks } };
    },
    resolve: (s, actions, rng) => {
        const next = { ...s, discs: s.discs.map((d) => ({ ...d })), history: s.history.slice() };
        const events = [];
        const flicksBy = {};
        // Apply both players' flicks at the same instant (seat order is irrelevant: they touch disjoint resting discs).
        for (const p of s.seats) {
            const fl = actions[p]?.flicks ?? [];
            flicksBy[p] = fl;
            for (const f of fl) {
                const d = next.discs.find((x) => x.id === f.disc);
                const noise = s.config.aimNoise > 0 ? rng.int(2 * s.config.aimNoise + 1) - s.config.aimNoise : 0;
                const ang = f.angle + noise;
                const v = Math.trunc((VMAX * f.power) / 100);
                d.vx = Math.trunc((v * cos(ang)) / 10000);
                d.vy = Math.trunc((v * sin(ang)) / 10000);
                events.push({ type: 'flick', player: p, disc: f.disc, angle: f.angle, actualAngle: ang, power: f.power });
            }
        }
        const before = new Map(next.discs.map((d) => [d.id, sideOf(next, d)]));
        for (let t = 0; t < s.config.ticksPerGo; t++)
            step(next);
        const crossings = [];
        for (const d of next.discs) {
            const now = sideOf(next, d);
            if (now && before.get(d.id) !== now) {
                crossings.push({ id: d.id, to: now });
                events.push({ type: 'cross', disc: d.id, to: now });
            }
        }
        next.history.push({ go: s.go, flicks: flicksBy, rejected: {}, crossings });
        next.go = s.go + 1;
        const settled = next.discs.every((d) => sideOf(next, d) !== null);
        const count = (p) => next.discs.filter((d) => sideOf(next, d) === p).length;
        const [a, b] = s.seats;
        if (settled && (count(a) === 0 || count(b) === 0)) {
            next.result = count(a) === 0 && count(b) === 0 ? { winners: [], reason: 'both sides empty' } : { winners: [count(a) === 0 ? a : b], reason: 'side cleared' };
        }
        else if (next.go >= s.config.maxGos) {
            const ca = count(a), cb = count(b);
            next.result = ca === cb ? { winners: [], reason: `time: ${ca}–${cb}` } : { winners: [ca < cb ? a : b], reason: `time: fewer discs left (${Math.min(ca, cb)} vs ${Math.max(ca, cb)})` };
        }
        if (next.result)
            events.push({ type: 'match-over', ...next.result });
        return { state: next, events };
    },
    isTerminal: (s) => s.result !== null,
    outcome: (s) => {
        const r = s.result ?? { winners: [], reason: 'unfinished' };
        return { scores: Object.fromEntries(s.seats.map((p) => [p, r.winners.includes(p) ? 1 : r.winners.length ? 0 : 0.5])), winners: r.winners, reason: r.reason };
    },
    defaultAction: () => ({ flicks: [] }),
    removePlayer: (s, p) => ({ ...s, forfeited: [...s.forfeited, p], result: { winners: s.seats.filter((x) => x !== p), reason: `${p} forfeited` } }),
    hypothesize: (obs, _assumptions, config) => {
        // Fully observable: rebuild the state from the observation (positions were exported as board units).
        const seats = (obs.yourSide === 'bottom' ? [obs.you, obs.opponent] : [obs.opponent, obs.you]);
        return { config, seats, discs: obs.discs.map((d) => ({ id: d.id, x: Math.round(d.x * U), y: Math.round(d.y * U), vx: Math.round(d.vx * U), vy: Math.round(d.vy * U) })),
            go: obs.go, history: [], result: null, forfeited: [] };
    },
    summarize: (s) => ({ go: s.go, sides: Object.fromEntries(s.seats.map((p) => [p, s.discs.filter((d) => sideOf(s, d) === p).length])) }),
    metrics: [
        { key: 'flicks', label: 'Flicks made', higherIsBetter: false },
        { key: 'crossedOut', label: 'Discs sent across', higherIsBetter: true },
        { key: 'efficiency', label: 'Discs sent across per flick', higherIsBetter: true },
    ],
    computeMetrics: ({ states }, player) => {
        const last = states[states.length - 1];
        if (!last)
            return {};
        const opp = last.seats[0] === player ? last.seats[1] : last.seats[0];
        const flicks = last.history.reduce((n, h) => n + (h.flicks[player]?.length ?? 0), 0);
        const out = last.history.reduce((n, h) => n + h.crossings.filter((c) => c.to === opp).length, 0);
        return { flicks, crossedOut: out, efficiency: flicks ? out / flicks : 0 };
    },
    describeAction: (a) => (a.flicks.length ? a.flicks.map((f) => `#${f.disc}@${f.angle}°×${f.power}`).join(' ') : 'wait'),
    rulesText: (c) => `Flick Puck: a ${c.width}×${c.height} board with a centre wall and a ${c.gap}-wide gap. You start with ${c.discsPerSide} discs on your side. Each GO, send {"flicks":[{"disc":id,"angle":deg,"power":1-100}]} for any of your resting discs (${c.flicksPerGo || 'any number'} per GO), or an empty list to wait. 0° is +x, 90° is down the board, 270° is up. Discs count for whichever side they rest on. Empty your side to win.${c.aimNoise ? ` Aim is perturbed by up to ±${c.aimNoise}°.` : ''}`,
};
