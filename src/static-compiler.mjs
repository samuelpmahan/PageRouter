import {fromBase64,safePath} from './compiled-patch.mjs';
// Copy compilation for already browser-native C6/static sources. References are
// declared from the actual literal import/link graph, not a second lifecycle.
export function staticSpec(id,sources) {
 const paths=new Set(Object.keys(sources));
 const text=p=>typeof sources[p]==='string'?sources[p]:sources[p].encoding==='utf8'?sources[p].data:new TextDecoder().decode(fromBase64(sources[p].data));
 function resolve(from,ref){if(!ref || /^(?:[a-z]+:|\/|#)/i.test(ref))return null;const parts=from.split('/');parts.pop();for(const bit of ref.split(/[?#]/)[0].split('/')){if(bit==='.')continue;if(bit==='..'){if(!parts.length)return null;parts.pop();}else parts.push(bit);}const out=parts.join('/');return paths.has(out)?out:null;}
 const raw=[...paths].sort().map(p=>{const refs=[];const source=text(p);if(/\.(mjs|js)$/.test(p))for(const m of source.matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g))refs.push(m[1]);if(p.endsWith('.html'))for(const m of source.matchAll(/(?:src|href)=["']([^"']+)["']/g)){if(!/\.html?(?:[?#]|$)/.test(m[1]))refs.push(m[1]);}const deps=[...new Set(refs.map(r=>resolve(p,r)).filter(r=>r&&r!==p))].sort();return {id:`file:${p}`,inputs:[p],dependencies:deps.map(r=>`file:${r}`),outputs:{[p]:{source:p}}};});
 // Browser module cycles are valid. Compile each strongly connected component
 // together, then express a truthful acyclic component dependency graph.
 const byId=new Map(raw.map(t=>[t.id,t])),index=new Map(),low=new Map(),stack=[],on=new Set(),groups=[];let serial=0;
 function visit(key){index.set(key,serial);low.set(key,serial++);stack.push(key);on.add(key);for(const d of byId.get(key).dependencies){if(!index.has(d)){visit(d);low.set(key,Math.min(low.get(key),low.get(d)));}else if(on.has(d))low.set(key,Math.min(low.get(key),index.get(d)));}if(low.get(key)===index.get(key)){const g=[];let k;do{k=stack.pop();on.delete(k);g.push(k);}while(k!==key);groups.push(g.sort());}}
 for(const key of byId.keys())if(!index.has(key))visit(key);
 const owner=new Map();for(const g of groups)for(const key of g)owner.set(key,g[0]);
 return {id,sources,targets:groups.map(g=>({id:g[0],inputs:g.flatMap(k=>byId.get(k).inputs),dependencies:[...new Set(g.flatMap(k=>byId.get(k).dependencies).map(k=>owner.get(k)).filter(k=>k!==g[0]))].sort(),outputs:Object.assign({},...g.map(k=>byId.get(k).outputs))})).sort((a,b)=>a.id.localeCompare(b.id))};
}
