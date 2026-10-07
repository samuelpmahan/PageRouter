import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../../crisp/lib/manifest.mjs';
import { buildStudio } from '../../local/build-studio.mjs';

const config = await loadManifest(process.cwd());
// Build the pinned Studio dependency once, then reuse the demo's actual model,
// renderer, and export helpers in this two-view composition.
buildStudio({ ...config, studio: { mode: 'create' } });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../local/studio-demo');
const app = fs.readFileSync(path.join(root, 'app.mjs'), 'utf8');
const courseTabs = `function courseTabs(active){return \`<nav class="course-tabs" aria-label="On Course views"><button id="course-create" aria-pressed="\${active==='create'}">Create graphics</button><button id="course-export" aria-pressed="\${active==='export'}">Export graphics</button></nav>\`;}`;
let source = app.replace("async function draw(){", `${courseTabs}\nlet courseView='create';\nasync function draw(){`)
  .replace("  if(config.mode==='bag')await drawBag();", "  if(config.mode==='bag')await drawBag();")
  .replace("  else if(config.mode==='create')await drawCreate();\n  else await drawExport();", "  else if(config.mode==='create')await drawCreate();\n  else if(config.mode==='course'){if(courseView==='create')await drawCreate();else await drawExport();}\n  else await drawExport();");
// Read Your Shelf's typed snapshot without sharing or mutating its model.
source = source.replace("let previewBackground='scene';", "let previewBackground='scene';\nconst shelfHandoffKey='pxcube.demo.v1:handoff:your-shelf-to-on-course';\nlet shelfHandoff=null;\nfunction readShelfHandoff(){try{const value=JSON.parse(localStorage.getItem(shelfHandoffKey)??'null');if(!value||value.version!==1||value.source!=='your-shelf'||(value.selectedDisc!==null&&typeof value.selectedDisc!=='string')||(value.bag!==null&&(typeof value.bag!=='object'||typeof value.bag.name!=='string'||!Array.isArray(value.bag.discIds)||!Array.isArray(value.bag.versions))))return null;return value;}catch{return null;}}\nfunction shelfContextNote(){if(config.mode!=='course'||!shelfHandoff)return '';const bag=shelfHandoff.bag;return `<p class=\"notice\">From Your Shelf · ${bag?`Bag “${esc(bag.name)}” · ${bag.discIds.length} exact copies`:'No bag selected'}${shelfHandoff.selectedDisc?' · current disc ready':''}</p>`;}");
source = source.replace("  active=next;\n  model=contexts.get(name);query='';chosenCapture=null;", "  active=next;\n  model=contexts.get(name);query='';chosenCapture=null;\n  shelfHandoff=readShelfHandoff();\n  if(config.mode==='course'&&shelfHandoff?.selectedDisc){const shelfRows=model.experience.shelf();const selected=shelfRows.find(row=>row.address===shelfHandoff.selectedDisc||row.disc.id===shelfHandoff.selectedDisc);if(selected&&model.context.selectedDisc!==selected.address)await model.patch({selectedDisc:selected.address});}");
source = source.replace("intro('Give this disc a corner.','A small disc graphic over your video.", "intro('Give this disc a corner.',shelfContextNote()+'A small disc graphic over your video.");
source = source.replace("intro('Take the graphic with you.','Inspect the captured version", "intro('Take the graphic with you.',shelfContextNote()+'Inspect the captured version");
// Both existing screens get the same local navigation when mounted in On Course.
source = source.replace("$('app').innerHTML=`<nav class=\"purpose-tabs\"", "$('app').innerHTML=(config.mode==='course'?courseTabs('create'):'')+`<nav class=\"purpose-tabs\"");
source = source.replace("$('app').innerHTML=intro('Take the graphic with you.'", "$('app').innerHTML=(config.mode==='course'?courseTabs('export'):'')+intro('Take the graphic with you.'");
// Bind view navigation after each render; the create/export screens retain all
// their original controls and stateful model operations.
source = source.replace("  const competition=model.context.graphicsPurpose==='competition';", "  if(config.mode==='course')queueMicrotask(()=>{ $('course-create').onclick=()=>run(async()=>{courseView='create';await draw();}); $('course-export').onclick=()=>run(async()=>{courseView='export';await draw();}); });\n  const competition=model.context.graphicsPurpose==='competition';");
source = source.replace("  const context=model.context,addresses=context.graphics;", "  if(config.mode==='course')queueMicrotask(()=>{ $('course-create').onclick=()=>run(async()=>{courseView='create';await draw();}); $('course-export').onclick=()=>run(async()=>{courseView='export';await draw();}); });\n  const context=model.context,addresses=context.graphics;");
for (const file of ['index.html','app.mjs','model.mjs','graphics.mjs','compositions.mjs','competition.mjs','competition-ui.mjs','archive-storage.mjs','style.css']) {
  fs.copyFileSync(path.join(root, file), path.join('dist', file));
}
fs.writeFileSync('dist/app.mjs', source);
fs.appendFileSync('dist/style.css', '\n.course-tabs{display:flex;gap:10px;margin:10px 0 4px}.course-tabs button[aria-pressed=true]{background:var(--accent);color:#102b29;font-weight:700}\n');
fs.cpSync(path.join(root, 'assets'), 'dist/assets', { recursive: true });
const vendor = path.resolve('../../vendor/studio-renderer');
const renderer = JSON.parse(fs.readFileSync(path.join(vendor, 'SOURCE.json')));
for (const [file, hash] of Object.entries(renderer.files)) {
  const bytes = fs.readFileSync(path.join(vendor, file));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error(`Renderer source changed: ${file}`);
  const output = path.join('dist/renderer', file);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
}
fs.writeFileSync('dist/renderer-import.json', JSON.stringify(renderer, null, 2) + '\n');
fs.writeFileSync('dist/config.mjs', `export default ${JSON.stringify({ id: config.id, title: config.title, mode: config.demo.mode, seedIdentity: 'studio-demo-1', source: renderer.commit })};\n`);
