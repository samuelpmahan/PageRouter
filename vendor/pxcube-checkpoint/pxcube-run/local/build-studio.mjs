import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { findMountUses, findPersistedMountPrefixes } from '../crisp/lib/scanner.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file,text); };
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw Error(`Studio import seam changed: ${from}`);
  return text.replace(from,to);
}
export function buildStudio(config = JSON.parse(fs.readFileSync('experience.json'))) {
  const vendor = path.resolve('../../vendor/studio'), adapter = path.resolve('../../local/studio-sandbox');
  const source = JSON.parse(fs.readFileSync(path.join(vendor,'SOURCE.json'))), files = [];
  fs.mkdirSync('dist', {recursive:true});
  for (const [file, expected] of Object.entries(source.files)) {
    const bytes = fs.readFileSync(path.join(vendor,file));
    if (sha(bytes) !== expected) throw Error(`Pinned Studio source changed: ${file}`);
    if (/\.(ts|mjs|html)$/.test(file)) files.push({path:file,content:bytes.toString()});
    if (/\.test\.|\.md$/.test(file) || /\/(app.ts|experiences.html)$/.test(file)) continue;
    let content = bytes;
    if (file.endsWith('.ts')) {
      let text = bytes.toString();
      if (file.endsWith('/experience-page.ts')) {
        text = replaceOnce(text,'{ sandbox = null }: { sandbox?', '{ sandbox = null, testRun = false }: { testRun?: boolean; sandbox?');
        text = replaceOnce(text,'if (sandbox) {','if (sandbox && testRun) {');
        text = replaceOnce(text,'} else {\n  const link', '} else if (!sandbox) {\n  const link');
        text = replaceOnce(text,'...(sandbox ? { random: () => 0 } : {})','...(testRun ? { random: () => 0 } : {})');
      }
      if (file.endsWith('/experience-fixtures.ts')) {
        text = replaceOnce(text,"log = (_event: Record<string, unknown>) => {})", "log = (_event: Record<string, unknown>) => {}, existing?: ReturnType<typeof createExperience>)");
        text = replaceOnce(text,'const experience = createExperience(', 'const experience = existing ?? createExperience(');
      }
      if (file.endsWith('/persistence.ts')) {
        text = replaceOnce(text, 'export async function restore(raw: string, knownStore: any): Promise<State> {', 'export async function restore(raw: string, knownStore: any, options: { mode?: \'frozen\' | \'working\'; immutableCalculations?: string[] } = {}): Promise<State> {\n  const working = options.mode === \'working\';\n  const immutableWorkingCalculations = new Set(options.immutableCalculations ?? []);');
        text = replaceOnce(text, '      const result = await pxc.compose({ into: destinations.get(node.id) ?? `restore.${node.id}`, calculation: part(node.calculation), inputs: Object.fromEntries(node.inputs.map(([key, id]: any) => [key, part(id)])) });\n      if (JSON.stringify(result.value) !== JSON.stringify(expected)) throw Error(\'Restored Calculation output differs from saved material.\');\n      parts.set(node.id, result);', '      const calculation = part(node.calculation);\n      const calculationName = pxc.entries().find(([name, candidate]: any) => candidate === calculation)?.[0];\n      if (working && immutableWorkingCalculations.has(calculationName)) { parts.set(node.id, new Part(expected)); continue; }\n      const result = await pxc.compose({ into: destinations.get(node.id) ?? `restore.${node.id}`, calculation, inputs: Object.fromEntries(node.inputs.map(([key, id]: any) => [key, part(id)])) });\n      if (JSON.stringify(result.value) !== JSON.stringify(expected) && !working) throw Error(\'Restored Calculation output differs from saved material.\');\n      // Working/demo archives recompute ordinary derived nodes from the\n      // current DAG. Captures remain explicit self-contained snapshots.\n      parts.set(node.id, result);');
      }
      content = stripTypeScriptTypes(text).replace(/(from\s*['"][^'"]+)\.ts(['"])/g,'$1.js$2');
    }
    if (file.endsWith('/index.html')) content = replaceOnce(bytes.toString(),'src="./app.ts"','src="../../live.mjs"');
    if (file.endsWith('/accepted-shelf.html')) {
      content = replaceOnce(bytes.toString(),"const root=document.getElementById('fairway-study');", "const root=document.getElementById('fairway-study');\nconst cubeContext = parent.pxCubeExperience.contextFor(window);");
      const bridge = fs.readFileSync(path.join(adapter,'shopping-bridge.js'),'utf8');
      content = replaceOnce(content,'\nrender();\nif(globalThis.Tweak)', `\n${bridge}\nrender();\nif(globalThis.Tweak)`);
    }
    write(path.join('dist/studio',file.replace(/\.ts$/,'.js')),content);
  }
  const uses = findMountUses(files), mounts = [...new Set(uses.map(use => use.mount))].sort();
  if (mounts.some(mount=>mount !== 'ds')) throw Error(`Review new legacy namespaces: ${mounts}`);
  const report = {source, compiler:'node:module stripTypeScriptTypes', patches:['.ts import suffixes to .js', 'import-safe live entry instead of app boot', 'Case controls and fixed picker only in numbered runs; interactive picker uses the existing default', 'existing fixture can seed a caller-owned persistent context', 'shopping closure inspection and scoped checkpoint hook'],
    compatibility:{status:'legacy adapter; not full MockPxC integration', internalMounts:mounts, uses, persistedPrefixFindings:findPersistedMountPrefixes(files,mounts), crispScope:'Experience host source; this separate report covers the pinned Studio dependency'} };
  write('dist/studio-import.json',JSON.stringify(report,null,2)+'\n');
  for (const file of ['index.html','host.mjs','style.css','live.mjs']) fs.copyFileSync(path.join(adapter,file),`dist/${file}`);
  for (const file of ['mock-mounts.mjs','experience-mount.mjs','scenarios.mjs']) write(`dist/local/${file}`,fs.readFileSync(`../../local/${file}`));
  write('dist/mock-pxc/mock-pxc.mjs',fs.readFileSync('../../mock-pxc/mock-pxc.mjs'));
  write('dist/config.mjs',`export default ${JSON.stringify({id:config.id,title:config.title,mode:config.studio.mode,source:source.commit})};\n`);
}
