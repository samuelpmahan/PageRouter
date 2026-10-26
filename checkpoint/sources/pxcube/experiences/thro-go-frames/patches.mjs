// Patches: the small, explicit edits a Case applies to the shared world. A patch is { id, terminal, to } or { op: 'remove', id }.
// A departure is a list of patches; applying it returns a new list of instances and leaves the original untouched.
import { clone, addSeconds, instantMs, dayDiff, localDay, addDays } from './util.mjs';
import { rederive, FRAMES, effectiveTerminals } from './frames.mjs';

export const set = (id, terminal, to) => ({ id, terminal, to });
export const remove = (id) => ({ op: 'remove', id });

export function applyPatches(instances, patches) {
  const removed = new Set(patches.filter((p) => p.op === 'remove').map((p) => p.id));
  const byId = new Map();
  const out = instances.filter((i) => !removed.has(i.id)).map((i) => { const c = { id: i.id, frame: i.frame, t: clone(i.t), how: { ...i.how } }; byId.set(i.id, c); return c; });
  for (const p of patches) {
    if (p.op === 'remove') continue;
    const inst = byId.get(p.id);
    if (!inst) throw new Error(`patch names ${p.id}, which is not in the world`);
    if (!(p.terminal in effectiveTerminals(inst.frame))) throw new Error(`${inst.frame} has no terminal ${p.terminal}`);
    inst.t[p.terminal] = clone(p.to);
    inst.how[p.terminal] = 'departed';
  }
  for (const inst of out) rederive(FRAMES[inst.frame], inst.t, inst.how);
  return out;
}

// Describe patches against the world they apply to: { id, frame, terminal, from, to } for the page and the Case record.
export function describePatches(W, patches) {
  return patches.map((p) => {
    const inst = W.get(p.id);
    return p.op === 'remove' ? { id: p.id, frame: inst?.frame, terminal: null, from: 'present', to: 'absent' } : { id: p.id, frame: inst.frame, terminal: p.terminal, from: clone(inst.t[p.terminal]), to: clone(p.to) };
  });
}

// "The video happened at another moment": move its publish instant, its snapshots, its bag's date and every click on its links by the same amount,
// so the only thing that changes is when the video sits relative to deals, releases and quarters.
export function retimeVideo(W, video, newInstant) {
  const deltaMs = instantMs(newInstant) - instantMs(video.t.publishedAt);
  const deltaSec = Math.round(deltaMs / 1000);
  const patches = [set(video.id, 'publishedAt', newInstant)];
  const off = W.get(video.t.channelId).t.utcOffsetHours;
  const newDay = localDay(newInstant, off), oldDay = localDay(video.t.publishedAt, off);
  const dayShift = dayDiff(newDay, oldDay);
  if (dayShift !== 0) patches.push(set(video.id, 'viewSnapshots', video.t.viewSnapshots.map((s) => ({ at: addDays(s.at, dayShift), views: s.views }))));
  for (const bag of W.where('Bag', 'appliedToVideoIds', video.id)) if (bag.t.takenAt > newDay) patches.push(set(bag.id, 'takenAt', newDay));
  for (const link of W.where('Link', 'videoId', video.id)) for (const click of W.where('Click', 'linkId', link.id)) patches.push(set(click.id, 'at', addSeconds(click.t.at, deltaSec)));
  return patches;
}
