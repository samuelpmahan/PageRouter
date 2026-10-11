// Generated from D:/t-t-1/packages/core/src/rng.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
}
export function createRng(seed) {
    let a, b, c, d;
    if (typeof seed === 'string') {
        const h = xmur3(seed);
        a = h();
        b = h();
        c = h();
        d = h();
    }
    else {
        [a, b, c, d] = seed;
    }
    const next = () => {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
    const seedLabel = typeof seed === 'string' ? seed : seed.join(':');
    const rng = {
        next,
        int: (n) => {
            if (!Number.isInteger(n) || n <= 0)
                throw new Error(`rng.int needs a positive integer, got ${n}`);
            return Math.floor(next() * n);
        },
        pick: (xs) => {
            if (xs.length === 0)
                throw new Error('rng.pick on empty list');
            return xs[Math.floor(next() * xs.length)];
        },
        shuffle: (xs) => {
            const out = xs.slice();
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1));
                [out[i], out[j]] = [out[j], out[i]];
            }
            return out;
        },
        fork: (label) => createRng(`${seedLabel}/${label}`),
        state: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
    };
    return rng;
}
