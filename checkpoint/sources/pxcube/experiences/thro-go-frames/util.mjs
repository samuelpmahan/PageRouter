// Small pure helpers shared by the generator, the enrichment, the metrics and the page. No Node-only APIs (the page imports this).
export const dayNum = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);
export const addDays = (iso, n) => new Date((dayNum(iso) + n) * 864e5).toISOString().slice(0, 10);
export const dayDiff = (laterIso, earlierIso) => dayNum(laterIso) - dayNum(earlierIso);
export const monthFirst = (ym) => `${ym}-01`;
export const monthLast = (ym) => {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
};
export const quarterOf = (iso) => `${iso.slice(0, 4)}-Q${Math.ceil(+iso.slice(5, 7) / 3)}`;
// Instants are UTC strings like 2026-03-06T23:00:00Z. A "local day" is the calendar day in a channel's fixed UTC offset (hours).
export const instantMs = (iso) => Date.parse(iso);
export const localDay = (instant, offsetHours) => new Date(Date.parse(instant) + offsetHours * 36e5).toISOString().slice(0, 10);
export const localTime = (instant, offsetHours) => new Date(Date.parse(instant) + offsetHours * 36e5).toISOString().slice(11, 16);
// The UTC instant at which a local wall-clock day and time happens in a fixed UTC offset.
export const instantAt = (day, hhmm, offsetHours) => new Date(Date.parse(`${day}T${hhmm}:00Z`) - offsetHours * 36e5).toISOString().replace('.000Z', 'Z');
export const addSeconds = (instant, n) => new Date(Date.parse(instant) + n * 1000).toISOString().replace('.000Z', 'Z');
export const hostOf = (url) => /^https?:\/\/([^/?#]+)/.exec(url)?.[1] ?? '';
export const offsetLabel = (h) => `UTC${h < 0 ? '−' : '+'}${Math.abs(h)}`;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
export const prettyDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1].slice(0, 3)} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;

export function fnv32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

export const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const commas = (str) => str.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// Round half up with a tiny nudge so values that are exactly x.x5 in decimal print the same whichever way floating point error fell.
const rnd = (n, d) => { const f = 10 ** d, sign = n < 0 ? -1 : 1; return (sign * Math.floor(Math.abs(n) * f + 0.5 + 1e-6)) / f; };
export const fmt1 = (n) => { const [i, f] = rnd(n, 1).toFixed(1).split('.'); return `${commas(i)}.${f}`; };
export const fmt2 = (n) => { const [i, f] = rnd(n, 2).toFixed(2).split('.'); return `${commas(i)}.${f}`; };
export const fmtInt = (n) => commas(String(Math.round(n)));
// Attention-seconds and viewer-minutes are modelled numbers, so large values are shown whole (24,890, not 24,890.0).
export const fmtAtt = (n) => (Math.abs(n) >= 100 ? fmtInt(n) : fmt1(n));
export const pct = (f) => `${Math.floor(f * 100 + 0.5 + 1e-6)}%`;
export const round4 = (n) => Math.round(n * 1e4) / 1e4;
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function mergeIntervals(list) {
  const sorted = list.map(([a, b]) => [a, b]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out = [];
  for (const iv of sorted) {
    if (out.length && iv[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], iv[1]);
    else out.push(iv);
  }
  return out;
}
export const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const clone = (v) => JSON.parse(JSON.stringify(v));
