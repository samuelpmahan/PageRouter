// thro · reads the words around one unresolved candidate in its own video's title or description and says whether they tie the mold to
// its maker. The same rule as attempts/bundle-size/ranked-search/with-candidates/evidence.mjs; used by mold-mentions.mjs.
const key = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Returns { kind, line } where kind is one of:
//   'maker'    the same line names the maker within 40 characters before the mold (Innova Fox, INNOVA Calvin Heimburg TORO)
//   'plastic'  the word right before the mold is one of the maker's plastics (Star Destroyer, Champion Firebird, R-Pro Pig)
//   'link'     the candidate is a shop link whose address names both the maker and the mold
//   'alone'    the mold name stands alone or as a hashtag, with nothing tying it to the maker (Destroyer, Atlas DG Supply, #birdie)
//   'missing'  the candidate's text is not in its video's title or description
// maker is the maker's first word as it is typed (innova, discraft, latitude); plastics are the maker's plastic names, lower case,
// one word each.
export function evidence(candidate, video, { moldName, maker, plastics }) {
  const text = candidate.source === 'title' ? video.title : video.description;
  const shown = candidate.source_text;
  if (/^https?:\/\//i.test(shown)) {
    const address = key(shown);
    return { kind: address.includes(maker) && address.includes(key(moldName)) ? 'link' : 'alone', line: shown };
  }
  const word = new RegExp(`(^|[^\\w])(${escape(shown)})(?=s?(?![\\w]))`, 'i');
  const lines = text.split('\n');
  let best = null;
  for (const line of lines) {
    const m = word.exec(line);
    if (!m) continue;
    const at = m.index + m[1].length;
    const before = line.slice(Math.max(0, at - 40), at);
    const previous = (line.slice(0, at).trim().split(/\s+/).pop() ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const hashtag = m[1] === '#';
    const kind = shown.toLowerCase().includes(maker) || before.toLowerCase().includes(maker) ? 'maker' : !hashtag && plastics.has(previous) ? 'plastic' : 'alone';
    if (!best || rank(kind) > rank(best.kind)) best = { kind, line: line.trim().slice(0, 160) };
  }
  return best ?? { kind: 'missing', line: null };
}
const rank = k => ({ alone: 0, plastic: 1, maker: 2 })[k];
