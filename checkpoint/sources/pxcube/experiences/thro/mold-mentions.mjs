// thro · how many harvested videos name each mold, for ranking mold search (mold-feed.mjs). The build counts it from the harvest
// postings and writes assets/molds/mold-mentions.json, so the counts are rebuilt from the harvest and never stored as source.
// A posting names a disc as "maker-slug/mold-slug" (disc_id) in one video (video_id). The catalog has the short maker name
// ("Innova") where postings have the company's ("innova-champion-discs"), so makers match when one slug starts with the other's
// first word. A posting that matches no catalog mold, or more than one, is listed as unmatched instead of guessed.
// Molds match on their letters and digits alone, with + read as "plus": the harvest writes roc-3 where the catalog has Roc3, and
// the catalog's Roc and Roc+ (TeeBird and TeeBird +) would otherwise share one key.
// 30 Oct (Sam: "Save it", then feed the rule into the build): the harvest's unresolved candidates count too, but only when the
// words around the candidate in its own video tie the mold to its maker (mold-evidence.mjs). A mold name alone never counts.
import { evidence } from './mold-evidence.mjs';

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const key = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
const sameMaker = (a, b) => a === b || a.startsWith(b + '-') || b.startsWith(a + '-') || a.split('-')[0] === b.split('-')[0];

// candidates: rows of candidates/unresolved.jsonl ({ candidate: { disc_id, video_id, source, source_text } }); videos: rows of
// videos.jsonl ({ video_id, title, description }); dictionary: the extractor's discs.json ({ disc_id, manufacturer, mold, plastics }).
export function moldMentions(index, postings, { candidates = [], videos: videoRows = [], dictionary = [] } = {}) {
  const byMold = new Map();
  for (const id of index.stableIds) {
    const r = index.recordForId(id), k = key(r.mold);
    (byMold.get(k) ?? byMold.set(k, []).get(k)).push({ id, maker: slug(r.manufacturer) });
  }
  const catalogId = discId => { const [maker, mold] = String(discId).split('/');
    const hit = (byMold.get(key(mold ?? '')) ?? []).filter(c => sameMaker(maker, c.maker)); return hit.length === 1 ? hit[0].id : null; };
  const videos = new Map(), unmatched = new Map();
  const count = (id, video) => (videos.get(id) ?? videos.set(id, new Set()).get(id)).add(video);
  for (const p of postings) {
    const id = catalogId(p.disc_id);
    if (!id) { unmatched.set(p.disc_id, (unmatched.get(p.disc_id) ?? 0) + 1); continue; }
    count(id, p.video_id);
  }
  const videoById = new Map(videoRows.map(v => [v.video_id, v]));
  const about = new Map(dictionary.map(d => [d.disc_id, { moldName: d.mold, maker: slug(d.manufacturer).split('-')[0],
    plastics: new Set((d.plastics ?? []).flatMap(p => p.toLowerCase().split(/\s+/))) }]));
  const kinds = {};
  for (const { candidate: c } of candidates) {
    const video = videoById.get(c.video_id);
    const fallback = { moldName: c.disc_id.split('/')[1], maker: c.disc_id.split('-')[0], plastics: new Set() };
    const e = video ? evidence(c, video, about.get(c.disc_id) ?? fallback) : { kind: 'missing' };
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    const id = catalogId(c.disc_id);
    if (id && e.kind !== 'alone' && e.kind !== 'missing') count(id, c.video_id);
  }
  const order = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return {
    mentions: Object.fromEntries([...videos].map(([id, v]) => [id, v.size]).sort(order)),
    unmatched: Object.fromEntries([...unmatched].sort(order)),
    ...(candidates.length ? { candidateEvidence: kinds } : {}),
  };
}
