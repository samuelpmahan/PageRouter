// Runs Argon's rim fit off the main thread so the crop animation never stutters.
// in:  { name, width, height, working: { width, height, data } }   out: { name, ms, result } | { name, error }
import { runThroDiscItem, forgetRimfit } from './rimfit.mjs';
self.onmessage = ({ data: photo }) => {
  try {
    const t = performance.now(), result = runThroDiscItem(photo);
    forgetRimfit(photo.name);
    self.postMessage({ name: photo.name, ms: Math.round(performance.now() - t), result });
  } catch (error) { self.postMessage({ name: photo.name, error: String(error?.stack ?? error) }); }
};
