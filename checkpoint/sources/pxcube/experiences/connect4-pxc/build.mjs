import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
const candidates = [
  path.resolve(here, '../../vendor/hh/services/pxc.mjs'),
  path.resolve(here, '../../../../vendor/hh/services/pxc.mjs'),
];
const pxcSource = candidates.find(candidate => fs.existsSync(candidate));
if (!pxcSource) throw new Error('Existing PxC Part/Calculation runtime is unavailable to the Connect Four PxC cartridge.');
const rulesSource = path.resolve(here, '../connect4/rules.mjs');
if (!fs.existsSync(rulesSource)) throw new Error('Canonical Connect Four rules are unavailable to the PxC cartridge.');
fs.mkdirSync(out, { recursive: true });
for (const file of ['model.mjs', 'rom.js']) {
  fs.copyFileSync(path.join(here, file), path.join(out, file));
}
fs.copyFileSync(rulesSource, path.join(out, 'rules.mjs'));
fs.copyFileSync(pxcSource, path.join(out, 'pxc.mjs'));
