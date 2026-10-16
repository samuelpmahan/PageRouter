import fs from 'node:fs';
import path from 'node:path';
import {canonicalLax} from '../exp/kernel/canonical.mjs';
import {hashImportClosure,sha256Hex} from './import-closure.mjs';
export function evaluatorClosure(root){
 root=fs.realpathSync(root);const roots=['src/session-repl.mjs','exp/cooperative/hh-workbench.mjs'],notRealFile='Evaluator dependency must be a real file within source root';
 const files=hashImportClosure(root,roots,{
  outsideOrLinked:notRealFile,notRegularFile:notRealFile,
  dynamicImport:'Undeclared dynamic evaluator dependency',
  externalImport:'External evaluator dependencies require an explicit closure policy',
  importLeavesRoot:'Evaluator import leaves source root'});
 // These full source statements/functions are the actual shell bindings that
 // create the fixture runtime and invoke it. Audit/navigation/header code does
 // not execute Calculations; the complete renderer/adapter modules above do.
 const app=fs.readFileSync(path.join(root,'src/app.mjs'),'utf8'),bindings={};
 const initialization=app.split('\n').find(line=>line.startsWith('const hh=createHHWorkbench('));if(!initialization)throw Error('Missing explicit evaluator host initialization');bindings.initialization=initialization;
 for(const name of ['output','functionsView','composeView']){const code=app.split('\n').find(line=>line.startsWith(`function ${name}(`));if(!code)throw Error('Evaluator host binding changed shape; review closure ownership');bindings[name]=code;}
 const record={schema:'evaluator-dependency-closure@1',roots,files,hostBindings:Object.fromEntries(Object.entries(bindings).map(([k,v])=>[k,{sha256:sha256Hex(Buffer.from(v)),bytes:Buffer.byteLength(v)}]))};return {...record,digest:sha256Hex(Buffer.from(canonicalLax(record)))};
}
export function evaluatorImplementationPin(current,baseline){if(!baseline||baseline.schema!=='published-evaluator-identity@1'||!/^[a-f0-9]{64}$/.test(baseline.implementationPin)||!baseline.closure?.digest)throw Error('Missing verified published evaluator baseline');return current.digest===baseline.closure.digest?baseline.implementationPin:current.digest;}
