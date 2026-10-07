import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadManifest } from './manifest.mjs';
import { validateScaffold } from './scaffold.mjs';

export async function buildScaffold(buildUrl) {
  const app = path.dirname(fileURLToPath(buildUrl));
  const manifest = await loadManifest(app);
  validateScaffold(manifest);
  const out = path.join(app, 'dist');
  fs.mkdirSync(path.join(out, 'local'), { recursive: true });
  fs.mkdirSync(path.join(out, 'mock-pxc'), { recursive: true });
  for (const file of ['index.html', 'app.mjs', 'style.css']) fs.copyFileSync(path.join(app, file), path.join(out, file));
  const seed = fs.readFileSync(new URL('../../mock-pxc/mock-pxc.mjs', import.meta.url));
  fs.writeFileSync(path.join(out, 'mock-pxc/mock-pxc.mjs'), seed);
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ ...manifest, seedIdentity: createHash('sha256').update(seed).digest('hex') }, null, 2) + '\n');
}
