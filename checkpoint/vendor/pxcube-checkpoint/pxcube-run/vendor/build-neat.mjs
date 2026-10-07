// Optional maintenance command. Runtime users need no compiler or install.
// node vendor/build-neat.mjs /absolute/path/to/typescript/lib/typescript.js
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url), ts=require(path.resolve(process.argv[2]));
if(ts.version!=='5.9.3') throw Error(`Recorded compiler is 5.9.3; got ${ts.version}`);
const base=path.join(path.dirname(fileURLToPath(import.meta.url)),'neat');
fs.mkdirSync(path.join(base,'dist'),{recursive:true});
for(const file of fs.readdirSync(path.join(base,'src')).filter(file=>file.endsWith('.ts'))){
 const source=fs.readFileSync(path.join(base,'src',file),'utf8');
 const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
 fs.writeFileSync(path.join(base,'dist',file.replace(/\.ts$/,'.js')),result.outputText);
}
