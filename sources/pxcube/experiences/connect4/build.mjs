import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const file of ['model.mjs', 'rules.mjs', 'rom.js']) {
  fs.copyFileSync(path.join(here, file), path.join(out, file));
}
