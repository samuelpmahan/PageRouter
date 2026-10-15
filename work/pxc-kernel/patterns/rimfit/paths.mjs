// Where rim fit reads and writes. Nothing here is machine-specific:
//   fixtures/      the 36 photos, the hand-traced truth (cases.json, gt/) and v3-chromium.json, in the repo
//   RIMFIT_WORK    decoded pixels, receipts and scores (default: .work/ beside this file, not committed)
//   DISCSTUDIO_DISC  DiscStudio 6.6.0's source/vendor/discstudio/disc folder (v3, refinement, circle candidates)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, 'fixtures');
export const WORK = process.env.RIMFIT_WORK ?? path.join(HERE, '.work');
fs.mkdirSync(path.join(WORK, 'raw'), { recursive: true });
export const DS = process.env.DISCSTUDIO_DISC;
export function requireDiscStudio() {
  if (!DS) throw new Error('Set DISCSTUDIO_DISC to the DiscStudio 6.6.0 folder source/vendor/discstudio/disc');
  return DS;
}
export const cases = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'cases.json'), 'utf8'))
  .map((c) => ({ ...c, file: path.join(FIXTURES, 'cases', path.basename(c.file)) }));
