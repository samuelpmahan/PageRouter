// Stable serialisation of the generated season and its Cases: one line per Case and per instance, so the file diffs and compares byte for byte.
export const SCHEMA = 'thro-go-frames/2';
const caseRecord = (c) => ({ id: c.id, slug: c.slug, kind: c.kind, theme: c.theme, title: c.title, where: c.where ?? null, frameTerminal: c.frameTerminal, expectationId: c.expectationId, instanceId: c.instanceId, patches: c.patches, departures: c.departures, entries: c.entries, subjectIds: c.subjectIds, expect: c.expect, videos: c.videos ?? null });
export function serializeWorld({ seed, summary, instances, cases }) {
  const lines = ['{', `"schema": ${JSON.stringify(SCHEMA)},`, `"seed": ${seed},`, `"summary": ${JSON.stringify(summary)},`, `"caseCount": ${cases.length},`, '"cases": ['];
  cases.forEach((c, i) => lines.push(JSON.stringify(caseRecord(c)) + (i < cases.length - 1 ? ',' : '')));
  lines.push('],', '"instances": [');
  instances.forEach((inst, i) => lines.push(JSON.stringify({ id: inst.id, frame: inst.frame, t: inst.t }) + (i < instances.length - 1 ? ',' : '')));
  lines.push(']', '}', '');
  return lines.join('\n');
}
