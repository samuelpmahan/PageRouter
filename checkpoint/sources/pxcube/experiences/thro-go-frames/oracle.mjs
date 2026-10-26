// Independent oracle. It imports NOTHING: no world.mjs, no frames.mjs, no metrics, no util. It re-derives what thro-go should report straight from the
// raw JSON instance list (the same `instances` array that is written to data/toy-world.json), with plain loops and its own date arithmetic.
// A bug in the code under test therefore cannot move the oracle with it. The two are compared by the Case verifier (verify.mjs).
//
// The rules it implements, stated once so both sides can be held to them:
//  * A video's day is its publish instant in its channel's fixed UTC offset. Deals (both end days inclusive), releases and quarters use that day.
//  * A disc's mold is its moldId, else the catalog mold with the same name once case, spaces and punctuation are ignored, else none (provisional).
//  * A disc's release is the release of its own run, else the run-less original, else the earliest. Month-precision releases are a range of days.
//  * On-screen seconds of a disc in a video = the union of whole seconds covered by its cards and marks, each clipped to the video; a card that ends
//    before it starts, has zero length, or starts at/after the video's end is dropped. Touching intervals are one appearance.
//  * Attention-seconds = latest view count x the sum of the retention fraction over those seconds; null when the channel has no Studio, the video has no
//    views yet, or there is no curve.
//  * Sponsor viewer-minutes on screen = attention-seconds of the union of seconds the brand's discs were up in a video / 60, summed per (kind, brand, quarter).
//  * A click is credited to a card moment when its timestamp is inside a card of that disc, else to the disc in the video; it is credited to nothing
//    (reason: no-video, then disc-not-in-video, then predates-publish, the first that applies) when it cannot be tied to an appearance.

export function oracle(instances) {
  const byId = new Map(instances.map((i) => [i.id, i]));
  const of = (frame) => instances.filter((i) => i.frame === frame);
  const T = (id) => byId.get(id)?.t;

  const dayOf = (instant, off) => new Date(Date.parse(instant) + off * 3600000).toISOString().slice(0, 10);
  const between = (later, earlier) => Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000);
  const monthEnd = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
  const quarterOfDay = (day) => `${day.slice(0, 4)}-Q${Math.floor((+day.slice(5, 7) - 1) / 3) + 1}`;
  const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const molds = of('Mold'), releases = of('Release'), deals = of('SponsorDeal'), cards = of('CardPlacement'), marks = of('Appearance');

  // ---- discs ----
  const discInfo = {};
  for (const d of of('Disc')) {
    let mold = d.t.moldId && byId.get(d.t.moldId) ? byId.get(d.t.moldId) : null, how = mold ? 'id' : null;
    if (!mold) { const want = squash(d.t.moldName); mold = want ? molds.find((m) => squash(m.t.name) === want) ?? null : null; how = mold ? 'normalized' : 'provisional'; }
    let rel = null;
    if (mold) {
      const rels = releases.filter((r) => r.t.moldId === mold.id).sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.id < b.id ? -1 : 1));
      rel = (d.t.runLabel && rels.find((r) => r.t.runLabel === d.t.runLabel)) || rels.find((r) => r.t.runLabel === null) || rels[0] || null;
    }
    discInfo[d.id] = { creatorId: d.t.creatorId, moldId: mold ? mold.id : `${d.id}~ProvisionalMoldDisc`, hasMold: !!mold, resolvedBy: how, manufacturerId: mold ? mold.t.manufacturerId : null, releaseId: rel ? rel.id : null };
  }

  // ---- videos ----
  const videoInfo = {};
  for (const v of of('Video')) {
    const ch = byId.get(v.t.channelId), creatorId = ch.t.creatorId;
    const day = dayOf(v.t.publishedAt, ch.t.utcOffsetHours);
    let views = 0, latest = '';
    for (const s of v.t.viewSnapshots) if (s.at >= latest) { latest = s.at; views = s.views; }
    const curve = of('RetentionCurve').find((c) => c.t.videoId === v.id);
    const state = !ch.t.studioConnected ? 'not-connected' : views === 0 ? 'awaiting-views' : !curve ? 'no-curve' : 'ok';
    videoInfo[v.id] = { creatorId, day, quarter: quarterOfDay(day), views, state, format: v.t.kind, duration: v.t.durationSeconds, fractions: curve ? curve.t.fractions : null, publishedAt: v.t.publishedAt, dealIds: deals.filter((d) => d.t.creatorId === creatorId && d.t.start <= day && day <= d.t.end).map((d) => d.id) };
  }

  const bucketOf = (creatorId, day, discId) => {
    const live = deals.filter((d) => d.t.creatorId === creatorId && d.t.start <= day && day <= d.t.end);
    if (!live.length) return 'no-deal';
    const di = discInfo[discId];
    if (!di.hasMold || !di.manufacturerId) return 'unknown-brand';
    const same = live.filter((d) => d.t.manufacturerId === di.manufacturerId);
    if (!same.length) return 'other-brand';
    return same.some((d) => d.t.moldsCovered === 'all' || d.t.moldsCovered.includes(di.moldId)) ? 'sponsor' : 'mold-not-covered';
  };
  const dealFor = (creatorId, day, discId) => {
    const di = discInfo[discId];
    const same = deals.filter((d) => d.t.creatorId === creatorId && d.t.start <= day && day <= d.t.end && d.t.manufacturerId === di.manufacturerId);
    const hit = same.find((d) => d.t.moldsCovered === 'all' || d.t.moldsCovered.includes(di.moldId));
    return hit ? hit.id : null;
  };

  // ---- on-screen intervals -> appearances ----
  const appearances = {};
  const perVideoDisc = {};
  for (const v of of('Video')) {
    const vi = videoInfo[v.id], items = {};
    const raw = [...cards.filter((c) => c.t.videoId === v.id), ...marks.filter((m) => m.t.videoId === v.id)];
    for (const x of raw) {
      let a = x.t.startSec, b = x.t.endSec;
      if (b < a || b === a || a >= vi.duration) continue;
      if (b > vi.duration) b = vi.duration;
      (items[x.t.discId] ??= []).push({ a, b, card: x.frame === 'CardPlacement', mode: x.frame === 'CardPlacement' ? 'shown' : x.t.mode });
    }
    for (const [discId, list] of Object.entries(items)) {
      list.sort((p, q) => p.a - q.a || p.b - q.b);
      const groups = [];
      for (const it of list) {
        const g = groups[groups.length - 1];
        if (g && it.a <= g.b) { g.b = Math.max(g.b, it.b); g.items.push(it); } else groups.push({ a: it.a, b: it.b, items: [it] });
      }
      groups.forEach((g, n) => {
        const key = `${discId}@${v.id}#${n + 1}`;
        const bucket = bucketOf(vi.creatorId, vi.day, discId);
        let attention = null;
        if (vi.state === 'ok') { let s = 0; for (let k = g.a; k < g.b; k++) s += vi.fractions[k]; attention = vi.views * s; }
        const di = discInfo[discId], rel = di.releaseId ? byId.get(di.releaseId) : null;
        let releaseClass = null, offsetMin = null, offsetMax = null, pre = null;
        if (rel) {
          const month = rel.t.datePrecision === 'month', r0 = month ? `${rel.t.date}-01` : rel.t.date, r1 = month ? monthEnd(rel.t.date) : rel.t.date;
          offsetMax = between(vi.day, r0); offsetMin = between(vi.day, r1);
          if (vi.day < r0) releaseClass = 'pre-release';
          else if (month && vi.day <= r1) releaseClass = 'release-month';
          else releaseClass = offsetMin <= rel.t.windowDays ? 'release-window' : 'established';
          if (vi.day < r0) pre = { certainty: 'certain', min: Math.max(0, between(r0, vi.day)), max: Math.max(0, between(r1, vi.day)) };
          else if (month && vi.day <= r1) pre = { certainty: 'possible', min: 0, max: between(r1, vi.day) };
        }
        appearances[key] = { discId, videoId: v.id, creatorId: vi.creatorId, start: g.a, end: g.b, seconds: g.b - g.a, cards: g.items.filter((i) => i.card).length, hasCard: g.items.some((i) => i.card), thrown: g.items.some((i) => i.mode === 'thrown'),
          bucket, dealId: bucket === 'sponsor' ? dealFor(vi.creatorId, vi.day, discId) : null, attention, state: vi.state, releaseId: di.releaseId, releaseClass, offsetMin, offsetMax, pre, format: vi.format, quarter: vi.quarter };
        (perVideoDisc[`${discId}@${v.id}`] ??= []).push(key);
      });
    }
  }

  // ---- rollups ----
  const total = (vals) => { const m = vals.filter((x) => x != null); return m.length ? m.reduce((s, x) => s + x, 0) : null; };
  const discVideo = {};
  for (const [dv, keys] of Object.entries(perVideoDisc)) discVideo[dv] = { attention: total(keys.map((k) => appearances[k].attention)), seconds: keys.reduce((s, k) => s + appearances[k].seconds, 0) };
  const disc = {}, mold = {};
  for (const [key, a] of Object.entries(appearances)) {
    if (a.attention == null) continue;
    const d = (disc[a.discId] ??= { attention: 0, long: null, short: null });
    d.attention += a.attention; d[a.format] = (d[a.format] ?? 0) + a.attention;
    const mk = discInfo[a.discId].moldId, m = (mold[mk] ??= { attention: 0, perCreator: {}, long: null, short: null });
    m.attention += a.attention; m.perCreator[a.creatorId] = (m.perCreator[a.creatorId] ?? 0) + a.attention; m[a.format] = (m[a.format] ?? 0) + a.attention;
  }

  // sponsor rows: union of seconds per (video, kind, brand)
  const rows = {};
  for (const v of of('Video')) {
    const vi = videoInfo[v.id], groups = {};
    for (const [key, a] of Object.entries(appearances)) {
      if (a.videoId !== v.id) continue;
      const kind = a.bucket === 'sponsor' ? 'sponsor' : 'other', brand = discInfo[a.discId].manufacturerId ?? 'unknown';
      (groups[`${kind}|${brand}`] ??= []).push(a);
    }
    for (const [gk, list] of Object.entries(groups)) {
      const rk = `${gk}|${vi.quarter}`;
      const row = (rows[rk] ??= { entries: [], unmeasured: [], creators: new Set(), overlapped: false });
      row.creators.add(vi.creatorId);
      if (vi.state !== 'ok') { row.unmeasured.push(v.id); continue; }
      const seen = new Set();
      for (const a of list) for (let s = a.start; s < a.end; s++) { if (seen.has(s)) row.overlapped = true; seen.add(s); }
      let sum = 0;
      for (const s of seen) sum += vi.fractions[s];
      row.entries.push({ videoId: v.id, creatorId: vi.creatorId, format: vi.format, viewerMinutes: (vi.views * sum) / 60 });
    }
  }
  const sponsorRows = {};
  for (const [rk, r] of Object.entries(rows)) {
    const byFormat = { long: total(r.entries.filter((e) => e.format === 'long').map((e) => e.viewerMinutes)), short: total(r.entries.filter((e) => e.format === 'short').map((e) => e.viewerMinutes)) };
    const byCreator = {};
    for (const c of r.creators) byCreator[c] = total(r.entries.filter((e) => e.creatorId === c).map((e) => e.viewerMinutes));
    sponsorRows[rk] = { viewerMinutes: total(r.entries.map((e) => e.viewerMinutes)), state: !r.entries.length ? 'unmeasurable' : r.unmeasured.length ? 'partial' : 'measured', creators: [...r.creators].sort(), overlapped: r.overlapped, byCreator, long: byFormat.long, short: byFormat.short, videos: [...r.entries.map((e) => e.videoId), ...r.unmeasured].sort() };
  }

  // ---- clicks ----
  const clicks = {}, perLink = {};
  for (const c of of('Click')) {
    const link = byId.get(c.t.linkId), vid = link.t.videoId ? byId.get(link.t.videoId) : null, ts = c.t.videoTimestamp;
    let kind, reason = null, appearanceKey = null;
    const keys = vid ? perVideoDisc[`${link.t.discId}@${vid.id}`] ?? [] : [];
    const everShown = vid ? raw1(vid.id, link.t.discId) : false;
    if (!vid) { kind = 'unattributed'; reason = 'no-video'; }
    else if (!everShown) { kind = 'unattributed'; reason = 'disc-not-in-video'; }
    else if (Date.parse(c.t.at) < Date.parse(vid.t.publishedAt)) { kind = 'unattributed'; reason = 'predates-publish'; }
    else if (!keys.length) { kind = 'unattributed'; reason = 'disc-not-in-video'; }
    else {
      const card = ts != null && cards.some((p) => p.t.videoId === vid.id && p.t.discId === link.t.discId && p.t.startSec <= ts && ts < p.t.endSec);
      const group = card ? keys.find((k) => appearances[k].start <= ts && ts < appearances[k].end && appearances[k].hasCard) : null;
      if (group) { kind = 'moment'; appearanceKey = group; } else kind = 'video';
    }
    clicks[c.id] = { kind, reason, appearanceKey };
    const pl = (perLink[link.id] ??= { credited: 0 });
    if (kind !== 'unattributed') pl.credited++;
  }
  function raw1(videoId, discId) { return cards.some((p) => p.t.videoId === videoId && p.t.discId === discId) || marks.some((m) => m.t.videoId === videoId && m.t.discId === discId); }
  const perThousand = {};
  for (const l of of('Link')) {
    if (!l.t.videoId) continue;
    const dv = discVideo[`${l.t.discId}@${l.t.videoId}`];
    if (dv && dv.attention != null && dv.attention > 0) perThousand[l.id] = (perLink[l.id].credited / dv.attention) * 1000;
  }
  return { videos: Object.fromEntries(Object.entries(videoInfo).map(([k, v]) => [k, { day: v.day, quarter: v.quarter, views: v.views, state: v.state, dealIds: v.dealIds }])), discs: discInfo, appearances, discVideo, disc, mold, sponsorRows, clicks, perThousand };
}

export function naiveMean(list) { let s = 0; for (const x of list) s += x; return s / list.length; }
