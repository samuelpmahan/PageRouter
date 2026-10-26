// Runs the registered Calculation thro/crop/live (Argon's rim fit) off the main thread so the crop animation never stutters.
// in:  { name, width, height, reference, working: { width, height, data } }   out: { name, report } | { name, error }
import { enter } from './thro-calculations.mjs';
self.onmessage = ({ data: photo }) => {
  try { self.postMessage({ name: photo.name, report: enter('thro/crop/live', [photo]) }); }
  catch (error) { self.postMessage({ name: photo.name, error: String(error?.stack ?? error) }); }
};
