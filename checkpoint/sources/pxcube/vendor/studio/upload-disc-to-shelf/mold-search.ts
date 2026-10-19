const normalize = (value: string) => value.toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, ' ');

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + Number(a[i - 1] !== b[j - 1]));
      diagonal = above;
    }
  }
  return row[b.length];
}

function tokenScore(token: string, text: string, words: string[]) {
  if (text === token) return 0;
  const at = text.indexOf(token); if (at >= 0) return 1 + at / 100;
  if (token.length < 3) return Infinity;
  let best = Infinity;
  for (const word of words) {
    const distance = editDistance(token, word);
    const allowance = token.length >= 4 ? 2 : 1;
    if (distance <= allowance) best = Math.min(best, 10 + distance + Math.abs(token.length - word.length) / 10);
  }
  return best;
}

/** Exact/prefix/substring matches lead; small spelling errors remain discoverable. */
export function fuzzyMoldOptions<T>(collection: readonly T[], query: string, label: (row: T) => string, limit = 12): T[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  return collection.map((row, index) => {
    const text = normalize(label(row)), words = text.split(' ');
    const scores = tokens.map(token => tokenScore(token, text, words));
    return { row, index, score: scores.reduce((sum, score) => sum + score, 0), matches: scores.every(Number.isFinite) };
  }).filter(result => result.matches).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, limit).map(result => result.row);
}

// ---- v2, beside v1. Benchmark: work/mold-search-bench/bench.mjs (724 catalog molds).
// v1 scores a word that merely contains the token the same as the word itself, so 30 molds could never rank
// first even typed in full ("zone" → Ozone Discs before Zone, "nova" → every Innova), and it erases "+".
//
// The catalog's only characters outside a-z/0-9 (surveyed 2026-10-15) and what each means here:
//   +  Roc+, TeeBird +, XD +      → the word "plus" (as in catalog ids: innova--roc-plus)
//   '  Putt'r, DA'E               → joins the word (puttr)
//   -  X-Caliber, MX-3, Aviar-X   → counts joined and split (xcaliber, x caliber)
//   Ä ö ä å  Älva, Göte, Järn     → accents fold (alva)
//   # ( )  #1 Hyzer, Talon (Claws) → separators
export function normalizeMoldText(value: string) {
  const folded = value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\+/g, ' plus ').replace(/['’]/g, '');
  const joined = folded.replace(/-/g, '');
  const text = (folded + (joined !== folded ? ' ' + joined : '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return [...new Set(text.split(' '))].join(' ');
}

type Indexed = { text: string; words: string[]; moldWords: string[] };
const indexCache = new Map<string, Indexed>();
function indexed(manufacturer: string, mold: string): Indexed {
  const key = `${manufacturer}\u0000${mold}`;
  let entry = indexCache.get(key);
  if (!entry) {
    const text = normalizeMoldText(`${manufacturer} ${mold}`);
    entry = { text, words: text.split(' '), moldWords: normalizeMoldText(mold).split(' ') };
    indexCache.set(key, entry);
  }
  return entry;
}

function tokenScoreV2(token: string, { text, words, moldWords }: Indexed) {
  if (words.includes(token)) return 0.5 + Math.max(0, moldWords.indexOf(token)) / 100;
  const at = text.indexOf(token);
  if (at >= 0) return 1 + at / 100 + (words.some(word => word.startsWith(token)) ? 0 : 0.5);
  if (token.length < 3) return Infinity;
  let best = Infinity;
  for (const word of words) {
    const distance = editDistance(token, word);
    if (distance <= (token.length >= 4 ? 2 : 1)) best = Math.min(best, 10 + distance + Math.abs(token.length - word.length) / 10);
  }
  return best;
}

/** Whole words lead, then prefixes/substrings, then small spelling errors; ties go to the mold with fewer untyped words, then the shorter label. */
export function rankMoldOptions<T>(collection: readonly T[], query: string, fields: (row: T) => { manufacturer: string; mold: string }, limit = 12): T[] {
  const tokens = normalizeMoldText(query).split(' ').filter(Boolean);
  return collection.map((row, index) => {
    const { manufacturer, mold } = fields(row);
    const entry = indexed(manufacturer, mold);
    const scores = tokens.map(token => tokenScoreV2(token, entry));
    const untyped = entry.moldWords.filter(word => !tokens.some(token => word.startsWith(token) || editDistance(token, word) <= 1)).length;
    return { row, index, score: scores.reduce((sum, score) => sum + score, 0) + untyped * 0.05, length: entry.text.length, matches: scores.every(Number.isFinite) };
  }).filter(result => result.matches)
    .sort((a, b) => a.score - b.score || a.length - b.length || a.index - b.index)
    .slice(0, limit).map(result => result.row);
}
