import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const file of ['index.html', 'player.js', 'connect4-ui.js', 'rom.js', 'cartridges.json']) {
  fs.copyFileSync(path.join(here, file), path.join(out, file));
}
