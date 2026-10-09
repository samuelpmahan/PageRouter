import fs from 'node:fs';
import path from 'node:path';

/** Remap HH source-tree sibling services into the compiled package layout. */
export function relocateHhServiceImports(root){
  let replacements=0;
  function walk(dir){
    for(const name of fs.readdirSync(dir)){
      const file=path.join(dir,name),stat=fs.lstatSync(file);
      if(stat.isDirectory()){walk(file);continue;}
      if(!stat.isFile()||!(/\.m?js$/i).test(name))continue;
      const source=fs.readFileSync(file,'utf8');
      const fixed=source.replace(/(["'])(\.\.\/\.\.\/|\.\.\/)services\//g,(_match,quote,prefix)=>{
        replacements++;
        return `${quote}${prefix==='../../'?'../':'./'}services/`;
      });
      if(fixed!==source)fs.writeFileSync(file,fixed);
    }
  }
  walk(root);
  if(replacements<1)throw Error('Expected at least one HH source-to-built services import relocation');
  return replacements;
}
