// A projection is the part of the linked results that a reader of thro-go acts on, written as plain keyed objects:
// the same shape oracle.mjs produces from the raw JSON. The Case verifier compares the two (differential test), and diffs two projections of the
// same pipeline (before / after a departure) to show what changed in the linked results.

const fmtOf = (E, a) => E.videos[a.videoId].format;

export function projectResults(W, E, M) {
  const relRows = {};
  for (const r of M.releases.releases) for (const v of r.videos) relRows[v.appearanceId] = v;
  const videos = {}, discs = {}, appearances = {}, discVideo = {}, disc = {}, mold = {}, sponsorRows = {}, clicks = {}, perThousand = {};
  for (const v of Object.values(E.videos)) videos[v.id] = { day: v.publishDay, quarter: v.quarter, views: v.views, state: v.retentionState, dealIds: [...v.dealIds] };
  for (const d of Object.values(E.discs)) discs[d.id] = { creatorId: d.creatorId, moldId: d.moldId ?? d.provisionalMoldId, hasMold: d.moldId != null, resolvedBy: d.resolvedBy, manufacturerId: d.manufacturerId, releaseId: d.releaseId };
  for (const a of E.appearances) {
    const rr = relRows[a.id], v = E.videos[a.videoId];
    appearances[a.id] = {
      discId: a.discId, videoId: a.videoId, creatorId: v.creatorId, start: a.start, end: a.end, seconds: a.seconds, cards: a.placementIds.length, hasCard: a.hasCard, thrown: a.modes.includes('thrown'),
      bucket: a.bucket, dealId: a.dealId, attention: M.attention.attention[a.id].value, state: v.retentionState, releaseId: E.discs[a.discId].releaseId,
      releaseClass: rr ? rr.class : null, offsetMin: rr ? rr.offsetMin : null, offsetMax: rr ? rr.offsetMax : null,
      pre: a.releaseState ? { certainty: a.releaseState.certainty, min: a.releaseState.daysBeforeMin, max: a.releaseState.daysBeforeMax } : null,
      format: fmtOf(E, a), quarter: v.quarter,
    };
    const dv = (discVideo[`${a.discId}@${a.videoId}`] ??= { attention: null, seconds: 0 });
    dv.seconds += a.seconds;
  }
  for (const [k, x] of Object.entries(M.attention.byDiscVideo)) discVideo[k].attention = x.value;
  for (const [k, x] of Object.entries(M.attention.byDisc)) disc[k] = { attention: x.value, long: x.byFormat.long?.value ?? null, short: x.byFormat.short?.value ?? null };
  for (const [k, x] of Object.entries(M.attention.byMold)) mold[k] = { attention: x.value, perCreator: { ...x.perCreator }, long: x.byFormat.long?.value ?? null, short: x.byFormat.short?.value ?? null };
  for (const r of M.exposure.rows) sponsorRows[r.key] = { viewerMinutes: r.viewerMinutes, state: r.state, creators: [...r.creators], overlapped: r.entries.some((e) => e.sumAttention - e.unionAttention > 1e-9), byCreator: { ...r.byCreator }, long: r.byFormat.long ?? null, short: r.byFormat.short ?? null, videos: [...r.videoIds].sort() };
  for (const c of E.clicks) clicks[c.id] = { kind: c.attribution.kind, reason: c.attribution.reason, appearanceKey: c.attribution.kind === 'moment' ? c.attribution.appearanceId : null };
  for (const [k, x] of Object.entries(M.clicks.perThousand)) perThousand[k] = x.value;
  return { videos, discs, appearances, discVideo, disc, mold, sponsorRows, clicks, perThousand };
}

const isNum = (x) => typeof x === 'number';
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
function walk(a, b, path, tol, out) {
  if (isNum(a) && isNum(b)) { if (!close(a, b, tol)) out.push({ path, a, b }); return; }
  if (a === b) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) { out.push({ path, a, b }); return; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push({ path: `${path}.${k}`, a: undefined, b: b[k] });
      else if (!(k in b)) out.push({ path: `${path}.${k}`, a: a[k], b: undefined });
      else walk(a[k], b[k], `${path}.${k}`, tol, out);
    }
    return;
  }
  out.push({ path, a, b });
}
// Differences between two projections (or an oracle result and a projection). Only the sections both define are compared.
export function diffProjections(a, b, { tol = 1e-9, sections } = {}) {
  const out = [];
  for (const s of sections ?? Object.keys(a)) if (s in b) walk(a[s], b[s], s, tol, out);
  return out;
}
// Which top-level entries (section + key) differ between two projections of the same pipeline, with before / after values.
export function changedEntries(before, after, tol = 1e-9) {
  const out = [];
  for (const s of Object.keys(before)) {
    const A = before[s], B = after[s];
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const d = [];
      walk(A[k], B[k], '', tol, d);
      if (A[k] === undefined || B[k] === undefined || d.length) out.push({ section: s, key: k, before: A[k] ?? null, after: B[k] ?? null, fields: d.map((x) => x.path.replace(/^\./, '')) });
    }
  }
  return out;
}
