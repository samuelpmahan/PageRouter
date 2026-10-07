import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [site,receipt]=process.argv.slice(2);
const expected=JSON.parse(fs.readFileSync(receipt));
const actual=[];
function walk(dir,prefix='') {
  for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const relative=prefix?`${prefix}/${entry.name}`:entry.name, file=path.join(dir,entry.name);
    if(entry.isSymbolicLink()) throw Error('Symlink in site output');
    if(entry.isDirectory())walk(file,relative);
    else{const bytes=fs.readFileSync(file);actual.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  }
}
walk(site);
if(JSON.stringify(actual)!==JSON.stringify(expected.siteFiles)) throw Error('Site output differs from build receipt');
if(!expected.pxcube.rebuilt || expected.pxcube.relocated || !expected.crispExactCompiledEquality) throw Error('Source build proof missing');
console.log(JSON.stringify({verifiedFiles:actual.length,siteBuildId:expected.siteBuildId,pxcubePackages:expected.pxcube.packages}));
