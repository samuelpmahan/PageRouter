// thro · mold search as a feed (Sam, 29 Oct: "How in the world do you rank 'inn'?" ... "but load on scroll like a social media
// feed"). Every match is ranked once into one stable order, and the dropdown reads it a page at a time with a cursor, the same
// shape a search service would serve: search(query, { limit, cursor }) -> { items, nextCursor, total }.
// Order: what kind of match it is, then how many harvested videos name the mold, then the shorter name, then the name and id
// compared by code point, so the same query gives the same order on every machine.
const TIERS = Object.freeze(['exact name', 'name starts with it', 'maker and name start with it', 'a word in the name starts with it', 'maker starts with it', 'name contains it']);

export function moldFeed(index, mentions = {}) {
  let rows = null, last = null;
  const all = () => rows ??= index.stableIds.map(id => {
    const r = index.recordForId(id);
    const mold = r.mold.toLowerCase(), maker = r.manufacturer.toLowerCase();
    return { record: r, mold, maker, label: `${maker} ${mold}`, words: mold.split(/\s+/), heard: mentions[id] ?? 0 };
  });
  const tierOf = (q, row) => {
    if (row.mold === q || row.label === q) return 0;
    if (row.mold.startsWith(q)) return 1;
    // "innova des" and "inn des": the words before a space start the maker, the rest starts the name.
    for (let split = q.indexOf(' '); split > 0; split = q.indexOf(' ', split + 1)) {
      const maker = q.slice(0, split).trim(), name = q.slice(split + 1).trim();
      if (maker && name && row.maker.startsWith(maker) && row.mold.startsWith(name)) return 2;
    }
    if (row.words.some(w => w.startsWith(q))) return 3;
    if (row.maker.startsWith(q)) return 4;
    if (row.mold.includes(q) || row.label.includes(q)) return 5;
    return -1;
  };
  const rank = query => {
    const q = query.toLowerCase().trim().replace(/\*+$/u, '').replace(/\s+/g, ' ');
    if (last?.q === q) return last.ranked;
    let scored;
    if (q.includes('*')) {
      // Interior wildcards keep the packed index's own pattern rules; they rank as one kind of match.
      const ids = new Set(index.search(q, index.recordCount).map(r => r.id));
      scored = all().filter(row => ids.has(row.record.id)).map(row => ({ row, tier: 3 }));
    } else {
      scored = all().map(row => ({ row, tier: q ? tierOf(q, row) : 0 })).filter(s => s.tier >= 0);
    }
    const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    scored.sort((a, b) => a.tier - b.tier || b.row.heard - a.row.heard || a.row.mold.length - b.row.mold.length
      || cmp(a.row.mold, b.row.mold) || cmp(a.row.record.id, b.row.record.id));
    last = { q, ranked: scored };
    return scored;
  };
  return {
    tiers: TIERS,
    search(query, { limit = 12, cursor = null } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Mold result limit must be a nonnegative integer.');
      if (cursor !== null && !/^(0|[1-9]\d*)$/.test(String(cursor))) throw Error('Mold feed cursor must be one this feed returned.');
      const ranked = rank(String(query ?? ''));
      const start = cursor === null ? 0 : Number(cursor);
      if (start > ranked.length) throw Error('Mold feed cursor is past the end of these results.');
      const page = ranked.slice(start, start + limit);
      const end = start + page.length;
      return {
        items: page.map(s => ({ ...s.row.record, match: TIERS[s.tier], heard: s.row.heard })),
        nextCursor: limit > 0 && end < ranked.length ? String(end) : null,
        total: ranked.length,
      };
    },
  };
}
