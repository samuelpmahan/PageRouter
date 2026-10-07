import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../../crisp/lib/manifest.mjs';
import { buildStudio } from '../build-studio.mjs';

export async function buildDemo() {
  const config = await loadManifest(process.cwd());
  buildStudio({ ...config, studio: { mode: config.demo.mode } });
  const root = path.dirname(fileURLToPath(import.meta.url));
  for (const file of ['index.html','app.mjs','model.mjs','graphics.mjs','compositions.mjs','competition.mjs','competition-ui.mjs','archive-storage.mjs','style.css','scene-worlds.css']) {
    fs.copyFileSync(path.join(root,file), path.join('dist',file));
  }
  fs.mkdirSync('dist/local/scenes',{recursive:true});
  const local = path.dirname(root);
  fs.copyFileSync(path.join(local,'scene-host.mjs'),'dist/local/scene-host.mjs');
  fs.copyFileSync(path.join(local,'scenes/discstudio-photo-card.mjs'),'dist/local/scenes/discstudio-photo-card.mjs');
  fs.cpSync(path.join(root,'assets'), 'dist/assets', {recursive:true});
  const vendor = path.resolve('../../vendor/studio-renderer');
  const source = JSON.parse(fs.readFileSync(path.join(vendor,'SOURCE.json')));
  for (const [file,hash] of Object.entries(source.files)) {
    const bytes = fs.readFileSync(path.join(vendor,file));
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error(`Renderer source changed: ${file}`);
    const output = path.join('dist/renderer',file);
    fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,bytes);
  }
  fs.writeFileSync('dist/renderer-import.json',JSON.stringify(source,null,2)+'\n');
  fs.writeFileSync('dist/config.mjs',`export default ${JSON.stringify({id:config.id,title:config.title,mode:config.demo.mode,seedIdentity:'studio-demo-1',source:source.commit})};\n`);
}
