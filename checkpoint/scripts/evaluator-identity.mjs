import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
export function evaluatorClosure(root){
 root=fs.realpathSync(root);const files={},pending=['src/session-repl.mjs','exp/cooperative/hh-workbench.mjs'],seen=new Set();
 while(pending.length){const relative=pending.pop();if(seen.has(relative))continue;seen.add(relative);const absolute=path.resolve(root,relative);if(!absolute.startsWith(root+path.sep)||fs.realpathSync(absolute)!==absolute||!fs.statSync(absolute).isFile())throw Error('Evaluator dependency must be a real file within source root');const bytes=fs.readFileSync(absolute),source=bytes.toString('utf8');files[relative]={sha256:sha(bytes),bytes:bytes.length};
  const imports=[...source.matchAll(/\b(?:import|export)\s+(?:[\w{}\s,*]+?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m=>m[1]);
  const dynamics=[...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m=>m[1]);if((source.match(/\bimport\s*\(/g)||[]).length!==dynamics.length)throw Error('Undeclared dynamic evaluator dependency');
  for(const ref of [...imports,...dynamics]){if(!ref.startsWith('.'))throw Error('External evaluator dependencies require an explicit closure policy');const dependency=path.resolve(path.dirname(absolute),ref);if(!dependency.startsWith(root+path.sep))throw Error('Evaluator import leaves source root');pending.push(path.relative(root,dependency).split(path.sep).join('/'));}
 }
 // These full source statements/functions are the actual shell bindings that
 // create the fixture runtime and invoke it. Audit/navigation/header code does
 // not execute Calculations; the complete renderer/adapter modules above do.
 const app=fs.readFileSync(path.join(root,'src/app.mjs'),'utf8'),bindings={};
 const initialization=app.split('\n').find(line=>line.startsWith('const hh=createHHWorkbench('));if(!initialization)throw Error('Missing explicit evaluator host initialization');bindings.initialization=initialization;
 for(const name of ['output','functionsView','composeView']){const code=app.split('\n').find(line=>line.startsWith(`function ${name}(`));if(!code)throw Error('Evaluator host binding changed shape; review closure ownership');bindings[name]=code;}
 const record={schema:'evaluator-dependency-closure@1',roots:['src/session-repl.mjs','exp/cooperative/hh-workbench.mjs'],files,hostBindings:Object.fromEntries(Object.entries(bindings).map(([k,v])=>[k,{sha256:sha(Buffer.from(v)),bytes:Buffer.byteLength(v)}]))};return {...record,digest:sha(Buffer.from(canonical(record)))};
}
export function evaluatorImplementationPin(current,baseline){if(!baseline||baseline.schema!=='published-evaluator-identity@1'||!/^[a-f0-9]{64}$/.test(baseline.implementationPin)||!baseline.closure?.digest)throw Error('Missing verified published evaluator baseline');return current.digest===baseline.closure.digest?baseline.implementationPin:current.digest;}
