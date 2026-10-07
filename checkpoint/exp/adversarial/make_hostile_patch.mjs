import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSnapshot,createPatch} from '../../src/compiled-patch.mjs';
import {staticSpec} from '../../src/static-compiler.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const base=JSON.parse(fs.readFileSync(path.join(root,'dist/data/hh.snapshot.json'),'utf8'));
const sources=Object.fromEntries(Object.entries(base.files).map(([p,v])=>[p,{encoding:'base64',data:v.data}]));
sources['index.html']={encoding:'utf8',data:`<!doctype html><html><head><title>adversarial inert leaf</title></head><body>
<script>parent.postMessage({type:'pwned',origin:location.origin},'*');try{localStorage.setItem('composed-workbench-pwned','yes')}catch(e){};fetch('/__evil_canary?script=1')</script>
<img src="https://example.invalid/__evil_image" onerror="fetch('/__evil_handler?script=1')">
<form action="/__evil_form" method="get"><button>send</button></form><a href="https://example.invalid/" target="_top">top navigation</a>
</body></html>`};
const target=await buildSnapshot(staticSpec('hh',sources),{baseline:base});
const patch=await createPatch(base,target);
const dest=path.join(here,'hostile-unknown.patch.json');
fs.writeFileSync(dest,JSON.stringify(patch));
console.log(JSON.stringify({path:dest,baseDigest:base.digest,targetDigest:target.digest,ops:patch.ops.map(o=>({path:o.path,kind:o.kind,bytes:o.bytes}))}));
