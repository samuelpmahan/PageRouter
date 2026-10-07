import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const original=path.join(root,'vendor/pxcube-checkpoint/pxcube-run');
const run=path.join(root,'sources/pxcube');
if(!fs.existsSync(run)){fs.cpSync(original,run,{recursive:true});}
const neat=path.join(run,'vendor/neat');
fs.mkdirSync(path.join(neat,'dist'),{recursive:true});
for(const f of fs.readdirSync(path.join(neat,'src')).filter(f=>f.endsWith('.ts'))){
 let source=fs.readFileSync(path.join(neat,'src',f),'utf8');
 source=source.replace(/import\s*\{([^}]+)\}\s*from\s*(["'])(\.\/[^"']+\.js)\2\s*;/g,(full,names,quote,relative)=>{
   const provider=path.join(neat,'src',relative.replace(/\.js$/,'.ts'));
   if(!fs.existsSync(provider))return full;
   const original=fs.readFileSync(provider,'utf8');
   const types=new Set([...original.matchAll(/export\s+(?:type|interface)\s+(\w+)/g)].map(m=>m[1]));
   const kept=names.split(',').map(x=>x.trim()).filter(Boolean).filter(x=>!x.startsWith('type ')&&!types.has(x.split(/\s+as\s+/)[0]));
   return kept.length?`import {${kept.join(',')}} from ${quote}${relative}${quote};`:'';
 });
 const result=stripTypeScriptTypes(source,{mode:'transform'});
 fs.writeFileSync(path.join(neat,'dist',f.replace(/\.ts$/,'.js')),result);
}
const {build}=await import(pathToFileURL(path.join(run,'local/run.mjs')));
const {resolveTargets}=await import(pathToFileURL(path.join(run,'local/affected-targets.mjs')));
const before=await resolveTargets(run);
const built=await build(run);
fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
fs.writeFileSync(path.join(root,'evidence/pxcube-build.json'),JSON.stringify({...built,targets:before},null,2));
console.log(JSON.stringify({site:built.site,results:built.report.results.map(x=>({id:x.id,ok:x.ok,error:x.error}))},null,2));
