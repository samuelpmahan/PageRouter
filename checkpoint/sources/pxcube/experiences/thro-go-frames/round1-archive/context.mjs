// The object a Case's expectation receives: raw instances (k), ids, the enriched result (E), metrics (M), facts, panels, and an independent oracle.
import { expectedAttention } from './oracle.mjs';
import { creatorPanel } from './display.mjs';
import { fmt1 } from './util.mjs';

export function makeContext({ meta, W, E, M, facts }) {
  const ids = meta.keys, panels = {};
  const k = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, W.get(id)]));
  const x = {
    W, E, M, facts, ids, k,
    check(label, expected, actual, mode = 'eq') {
      const nul = (v) => v === undefined || v === null;
      let pass;
      const close = (e, a) => (nul(e) || nul(a) ? nul(e) && nul(a) : Math.abs(e - a) <= 1e-6 * Math.max(1, Math.abs(e)));
      if (mode === 'near') pass = Array.isArray(expected) ? Array.isArray(actual) && expected.length === actual.length && expected.every((e, i) => close(e, actual[i])) : close(expected, actual);
      else pass = JSON.stringify(nul(expected) ? null : expected) === JSON.stringify(nul(actual) ? null : actual);
      return { label, expected: nul(expected) ? null : expected, actual: nul(actual) ? null : actual, pass };
    },
    panel(creatorKey = 'creator') { const id = ids[creatorKey] ?? creatorKey; return (panels[id] ??= creatorPanel(W, E, M, id)); },
    apps: (discKey, videoKey = 'video') => E.appearances.filter((a) => a.discId === ids[discKey] && a.videoId === ids[videoKey]),
    oracle: (videoKey, ...discKeys) => expectedAttention(W, ids[videoKey], discKeys.map((d) => ids[d])),
    att: (discKey, videoKey = 'video') => M.attention.byDiscVideo[`${ids[discKey]}@${ids[videoKey]}`]?.value ?? null,
    attPhrase(discKey, videoKey = 'video') { const o = x.oracle(videoKey, discKey); return o.value == null ? 'not measurable' : `${fmt1(o.value)} attention-seconds`; },
    attCheck(discKey, videoKey = 'video') {
      const o = x.oracle(videoKey, discKey), got = x.att(discKey, videoKey);
      return o.value == null
        ? x.check(`attention-seconds is not measurable (null, not 0) for ${discKey} in ${videoKey}`, null, got)
        : x.check(`attention-seconds for ${discKey} in ${videoKey} = ${fmt1(o.views)} views x sum of retention over ${o.seconds} s on screen = ${fmt1(o.value)}`, o.value, got, 'near');
    },
    release(discKey, videoKey = 'video') {
      const a = x.apps(discKey, videoKey)[0];
      for (const r of M.releases.releases) for (const v of r.videos) if (v.appearanceId === a?.id) return v;
      return {};
    },
    row(discKey, videoKey = 'video') { const p = x.panel(E.videos[ids[videoKey]].creatorId); return p.videos.find((v) => v.id === ids[videoKey])?.discs.find((d) => d.discId === ids[discKey]) ?? { chips: [], attention: {} }; },
    alts: (frame) => E.alternates.filter((a) => a.frame === frame),
    noted: (expectationId, key) => E.transformations.some((t) => t.expectationId === expectationId && t.instanceId === ids[key]),
    click: (key = 'click') => E.clicks.find((c) => c.id === ids[key]),
    exposure: (kind, brandKey) => M.exposure.rows.find((r) => r.kind === kind && r.manufacturerId === ids[brandKey]),
    cardSpan: (key) => ({ a: k[key].t.startSec, b: k[key].t.endSec }),
    edge: (a, rel, b) => E.edges.some((e) => e.from === (ids[a] ?? a) && e.rel === rel && e.to === (ids[b] ?? b)),
    says(kind, subjKey, ...strings) {
      const subj = ids[subjKey];
      const fact = facts.find((f) => f.kind === kind && [f.discId, f.videoId, f.appearanceId, f.clickId, f.creatorId, f.manufacturerId, f.moldId].includes(subj));
      return [x.check(`a "${kind}" fact is derived from the linked data`, true, !!fact), ...strings.map((s) => x.check(`the meaning sentence says “${s}”`, true, !!fact && fact.sentence.includes(s)))];
    },
  };
  return x;
}
