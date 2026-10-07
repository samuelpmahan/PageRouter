import { scopedStorage } from './local/experience-mount.mjs';

// Compress the existing archive bytes; never omit Parts or replace their values.
// The Studio archive remains the sole replay format. This adapter only changes
// its storage encoding. Commit is explicit and awaited before reporting success.
const format='pxcube-gzip@1:';
export async function pack(raw){
  const bytes=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return format+btoa(binary);
}
export async function unpack(raw){
  if(raw===null||!raw.startsWith(format))return raw;
  const bytes=Uint8Array.from(atob(raw.slice(format.length)),c=>c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
export async function archiveStorage(storage,key){
  const backing=scopedStorage(storage,key);
  let raw=await unpack(backing.getItem('')),committed=raw;
  return {
    getItem:()=>raw,
    setItem:(_key,next)=>{raw=next;},
    async flush(){
      if(raw===committed)return;
      const candidate=raw,packed=await pack(candidate);
      if(raw!==candidate)throw Error('Archive changed during compression; retry the save.');
      backing.setItem('',packed);committed=candidate;
    },
  };
}
