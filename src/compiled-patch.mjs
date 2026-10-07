// Same exact-byte compiled snapshot contract in Node and browser. No executable input.
const enc = new TextEncoder();
const DIGEST = /^[a-f0-9]{64}$/;
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export async function hash(value) {
  const bytes = typeof value === 'string' ? enc.encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function safePath(p) {
  if(typeof p !== 'string' || !p || p.length>512 || /[\\\x00-\x1f:#?%]/.test(p) || p.startsWith('/') || p.split('/').some(x=>!x || x==='.' || x==='..' || ['__proto__','constructor','prototype'].includes(x))) throw Error('Invalid relative output path');
  return p;
}
export function toBase64(bytes) {
  let s=''; for(let i=0;i<bytes.length;i+=8192) s+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(s);
}
export function fromBase64(s) {
  if(typeof s !== 'string' || s.length>50000000 || s.length%4!==0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw Error('Invalid base64');
  const raw=atob(s); const a=Uint8Array.from(raw,c=>c.charCodeAt(0)); if(toBase64(a)!==s) throw Error('Noncanonical base64'); return a;
}
function sourceBytes(v) {
  if(typeof v==='string') return enc.encode(v);
  if(v?.encoding==='base64') return fromBase64(v.data);
  if(v?.encoding==='utf8' && typeof v.data==='string') return enc.encode(v.data);
  throw Error('Invalid source encoding');
}
function record(v) {return v && typeof v==='object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));}
function needRecord(v,label){if(!record(v)) throw Error(`Invalid ${label}`);}
async function descriptor(bytes){return {encoding:'base64',data:toBase64(bytes),sha256:await hash(bytes),bytes:bytes.length};}
const identity = s => ({schema:s.schema,project:s.project,sources:s.sources,targets:s.targets,files:Object.fromEntries(Object.entries(s.files).map(([p,f])=>[p,{sha256:f.sha256,bytes:f.bytes}]))});
export async function validateSnapshot(s) {
  if(s?.schema!=='compiled-snapshot@1' || typeof s.project!=='string' || !s.project || !DIGEST.test(s.digest)) throw Error('Invalid snapshot');
  needRecord(s.files,'files'); if(Object.keys(s.files).length>20000) throw Error('Too many files');
  let total=0;
  for(const [p,f] of Object.entries(s.files)){
    safePath(p); if(!record(f) || f.encoding!=='base64' || !DIGEST.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes<0) throw Error('Invalid file metadata');
    const bytes=fromBase64(f.data); total+=bytes.length; if(total>50000000) throw Error('Snapshot exceeds limit');
    if(bytes.length!==f.bytes || await hash(bytes)!==f.sha256) throw Error('Compiled file hash mismatch');
  }
  needRecord(s.sources,'snapshot sources');needRecord(s.targets,'snapshot targets');
  for(const [p,d] of Object.entries(s.sources)){safePath(p);if(!DIGEST.test(d))throw Error('Invalid source digest');}
  const outputOwners=new Set();
  for(const [id,t] of Object.entries(s.targets)){if(!id||['__proto__','constructor','prototype'].includes(id)||!record(t)||!DIGEST.test(t.fingerprint)||!Array.isArray(t.outputs)||!t.outputs.length)throw Error('Invalid target metadata');for(const p of t.outputs){safePath(p);if(!own(s.files,p)||outputOwners.has(p))throw Error('Invalid or multiply owned compiled output');outputOwners.add(p);}}
  if(outputOwners.size!==Object.keys(s.files).length)throw Error('Unowned compiled output');
  if(!record(s.build)||!['rebuilt','reused','deleted','dependencyClosure'].every(k=>Array.isArray(s.build[k])&&s.build[k].every(x=>typeof x==='string')))throw Error('Invalid build evidence');
  const status=[...s.build.rebuilt,...s.build.reused];if(new Set(status).size!==status.length||status.some(x=>!own(s.targets,x))||status.length!==Object.keys(s.targets).length)throw Error('Invalid target build partition');
  if(await hash(canonical(identity(s)))!==s.digest) throw Error('Snapshot digest mismatch');
  return s;
}
export async function buildSnapshot(spec,{baseline=null}={}) {
  if(!record(spec) || typeof spec.id!=='string' || !spec.id || !Array.isArray(spec.targets)) throw Error('Invalid build specification');
  needRecord(spec.sources,'sources'); if(baseline){await validateSnapshot(baseline); if(baseline.project!==spec.id)throw Error('Baseline project mismatch');}
  const sources={}, bytesBySource={};
  for(const [p,v] of Object.entries(spec.sources)){safePath(p); bytesBySource[p]=sourceBytes(v); sources[p]=await hash(bytesBySource[p]);}
  const targets={},files={},rebuilt=[],reused=[],outputOwners=new Set(), ids=new Map();
  for(const t of spec.targets){if(!record(t) || typeof t.id!=='string' || !t.id || ['__proto__','constructor','prototype'].includes(t.id) || ids.has(t.id))throw Error('Invalid or duplicate target'); ids.set(t.id,t);}
  const visiting=new Set(),visited=new Set(),order=[];
  function walk(id){if(visiting.has(id))throw Error('Dependency cycle'); if(visited.has(id))return;const t=ids.get(id);if(!t)throw Error('Missing target dependency');visiting.add(id);if(!Array.isArray(t.inputs)||!Array.isArray(t.dependencies??[]))throw Error('Invalid target dependencies');for(const dep of t.dependencies??[])walk(dep);visiting.delete(id);visited.add(id);order.push(t);}
  for(const id of ids.keys())walk(id);
  for(const t of order){
    needRecord(t.outputs,'target outputs'); const declared=new Set(t.inputs);for(const p of declared)if(!own(sources,p))throw Error('Missing declared source');
    const fingerprint=await hash(canonical({id:t.id,inputs:Object.fromEntries([...declared].sort().map(p=>[p,sources[p]])),dependencies:(t.dependencies??[]).map(id=>[id,targets[id].fingerprint]),outputs:t.outputs}));
    const previous=baseline?.targets?.[t.id]; const reuse=previous?.fingerprint===fingerprint;
    const outputPaths=Object.keys(t.outputs).sort(); if(!outputPaths.length)throw Error('Target has no outputs');
    for(const p of outputPaths){safePath(p);if(outputOwners.has(p))throw Error('Duplicate output producer');outputOwners.add(p);const recipe=t.outputs[p];needRecord(recipe,'output recipe');
      if(reuse && previous.outputs.includes(p) && baseline.files[p]){files[p]=structuredClone(baseline.files[p]);continue;}
      let bytes;
      if(own(recipe,'source')){if(!declared.has(recipe.source))throw Error('Undeclared source used');bytes=bytesBySource[recipe.source];}
      else if(own(recipe,'concat')){if(!Array.isArray(recipe.concat)||recipe.concat.some(x=>!declared.has(x)))throw Error('Undeclared concat input');const sep=enc.encode(recipe.separator??'');const parts=recipe.concat.map(x=>bytesBySource[x]);const n=parts.reduce((a,b)=>a+b.length,0)+Math.max(0,parts.length-1)*sep.length;bytes=new Uint8Array(n);let i=0;parts.forEach((b,j)=>{if(j){bytes.set(sep,i);i+=sep.length;}bytes.set(b,i);i+=b.length;});}
      else if(typeof recipe.template==='string'){bytes=enc.encode(recipe.template);}
      else throw Error('Unsupported compiler recipe');
      files[p]=await descriptor(bytes);
    }
    targets[t.id]={fingerprint,outputs:outputPaths}; (reuse?reused:rebuilt).push(t.id);
  }
  const snapshot={schema:'compiled-snapshot@1',project:spec.id,files,sources,targets,build:{rebuilt,reused,deleted:Object.keys(baseline?.files??{}).filter(p=>!own(files,p)),dependencyClosure:rebuilt}};
  snapshot.digest=await hash(canonical(identity(snapshot)));return snapshot;
}
export async function createPatch(base,target) {
  await validateSnapshot(base);await validateSnapshot(target);if(base.project!==target.project)throw Error('Project mismatch');
  const ops=[];
  for(const p of [...new Set([...Object.keys(base.files),...Object.keys(target.files)])].sort()){
    const a=base.files[p],b=target.files[p];if(a?.sha256===b?.sha256)continue;
    if(!b){ops.push({path:p,kind:'delete',beforeSha256:a.sha256,afterSha256:null,bytes:0});continue;}
    if(!a){ops.push({path:p,kind:'add',beforeSha256:null,afterSha256:b.sha256,bytes:b.bytes,data:b.data});continue;}
    const old=fromBase64(a.data),next=fromBase64(b.data);let start=0;while(start<Math.min(old.length,next.length)&&old[start]===next[start])start++;
    let suffix=0;while(suffix<Math.min(old.length-start,next.length-start)&&old[old.length-1-suffix]===next[next.length-1-suffix])suffix++;
    ops.push({path:p,kind:'splice',beforeSha256:a.sha256,afterSha256:b.sha256,bytes:b.bytes,start,deleteCount:old.length-start-suffix,data:toBase64(next.subarray(start,next.length-suffix))});
  }
  const {files:_,digest:__,...manifest}=target;
  return {schema:'compiled-patch@1',project:target.project,baseDigest:base.digest,targetDigest:target.digest,ops,manifest};
}
export async function applyPatch(base,patch) {
  await validateSnapshot(base);
  if(!record(patch)||patch.schema!=='compiled-patch@1'||patch.project!==base.project||patch.baseDigest!==base.digest||!DIGEST.test(patch.targetDigest)||!Array.isArray(patch.ops)||patch.ops.length>20000) throw Error('Wrong baseline or invalid patch');
  const files=structuredClone(base.files),seen=new Set();
  for(const op of patch.ops){
    if(!record(op))throw Error('Invalid operation');safePath(op.path);if(seen.has(op.path))throw Error('Duplicate patch path');seen.add(op.path);
    const before=files[op.path];if((before?.sha256??null)!==op.beforeSha256)throw Error('Before hash mismatch');
    if(op.kind==='delete'){if(!before||op.afterSha256!==null||op.bytes!==0)throw Error('Invalid delete');delete files[op.path];continue;}
    if(!DIGEST.test(op.afterSha256)||!Number.isSafeInteger(op.bytes)||op.bytes<0||op.bytes>50000000)throw Error('Invalid output hash/size');
    const payload=fromBase64(op.data);let bytes;
    if(op.kind==='add'){if(before)throw Error('Add overwrites existing file');bytes=payload;}
    else if(op.kind==='splice'){
      if(!before || !Number.isSafeInteger(op.start)||!Number.isSafeInteger(op.deleteCount)||op.start<0||op.deleteCount<0||op.start+op.deleteCount>before.bytes)throw Error('Invalid splice range');
      const original=fromBase64(before.data);bytes=new Uint8Array(original.length-op.deleteCount+payload.length);bytes.set(original.subarray(0,op.start));bytes.set(payload,op.start);bytes.set(original.subarray(op.start+op.deleteCount),op.start+payload.length);
    }else throw Error('Unknown operation');
    if(bytes.length!==op.bytes || await hash(bytes)!==op.afterSha256)throw Error('Patch output hash mismatch');files[op.path]=await descriptor(bytes);
  }
  needRecord(patch.manifest,'patch manifest');
  if(patch.manifest.schema!=='compiled-snapshot@1'||patch.manifest.project!==base.project||own(patch.manifest,'files')||own(patch.manifest,'digest'))throw Error('Invalid target manifest');
  const result={...structuredClone(patch.manifest),files,digest:patch.targetDigest};await validateSnapshot(result);return result;
}
// Deduplicated delivery envelope for large compiled catalogs. Identity and
// validation remain the ordinary exact-byte snapshot after unpacking.
export function packSnapshot(snapshot){const payloads={},files={};for(const [p,f] of Object.entries(snapshot.files)){payloads[f.sha256]??=f.data;const {data,...metadata}=f;files[p]=metadata;}return {schema:'compiled-snapshot-pack@1',snapshot:{...snapshot,files},payloads};}
export function unpackSnapshot(packed){if(packed?.schema!=='compiled-snapshot-pack@1')return packed;needRecord(packed.payloads,'snapshot payloads');needRecord(packed.snapshot?.files,'packed files');const files={};for(const [p,f] of Object.entries(packed.snapshot.files)){safePath(p);if(!DIGEST.test(f.sha256)||typeof packed.payloads[f.sha256]!=='string')throw Error('Missing packed payload');files[p]={...f,data:packed.payloads[f.sha256]};}return {...packed.snapshot,files};}
