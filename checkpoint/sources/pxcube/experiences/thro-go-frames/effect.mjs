// What a departure changed, as a reader would see it: the linked results (projection entries) and the meaning sentences.
// A terminal whose only effect is on a sentence (an off-brand link destination, a release kind) still has an observable effect.
import { changedEntries } from './projection.mjs';
import { deriveFacts } from './meaning.mjs';

export const factKey = (f) => `${f.kind}|${f.appearanceId ?? f.clickId ?? f.rowKey ?? f.linkId ?? f.moldId ?? [f.discId, f.videoId, f.instanceId, f.fromVideoId].filter(Boolean).join('/')}`;
export const factsOf = (a) => a.facts ?? (a.facts = deriveFacts(a.W, a.E, a.M));
const group = (facts) => { const m = new Map(); for (const f of facts) (m.get(factKey(f)) ?? m.set(factKey(f), []).get(factKey(f))).push(f); return m; };
// Facts (with their sentences) that are new or worded differently after the departure.
export function sentenceDelta(base, after) {
  const b = group(factsOf(base)), a = group(factsOf(after)), out = [];
  const sig = (l) => (l ?? []).map((f) => f.sentence).sort().join('\n');
  for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) if (sig(b.get(k)) !== sig(a.get(k))) out.push({ key: k, before: b.get(k) ?? [], after: a.get(k) ?? [] });
  return out;
}
export function effectOf(base, after) {
  const changed = changedEntries(base.P, after.P);
  const sentences = sentenceDelta(base, after);
  return { changed, sentences, observable: changed.length > 0 || sentences.length > 0 };
}
