// Generated from D:/t-t-1/packages/core/src/hash.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/** Stable JSON + a small non-cryptographic hash (FNV-1a 64 via two 32-bit lanes) for state fingerprints. */
export function stableStringify(value) {
    return JSON.stringify(sortKeys(value));
}
function sortKeys(v) {
    if (Array.isArray(v))
        return v.map(sortKeys);
    if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v).sort())
            out[k] = sortKeys(v[k]);
        return out;
    }
    return v;
}
export function hashState(value) {
    const s = stableStringify(value);
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193);
        h2 = Math.imul(h2 ^ c, 0x0100019d);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
