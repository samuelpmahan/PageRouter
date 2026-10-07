import fs from 'node:fs';
import path from 'node:path';
import {buildSnapshot} from '../src/compiled-patch.mjs';
import {staticSpec} from '../src/static-compiler.mjs';

// Relocation is limited to exact shipped bytes. It never invokes crisp/neat builds.
export async function preservePxCube(root, evidence, files) {
  if (fs.existsSync(evidence.site)) return {directory:evidence.site, provenance:null};
  const shipped = path.join(root,'dist/compiled/pxcube');
  const local = path.join(root,'build/pxcube-preserved');
  const directory = fs.existsSync(local) ? local : shipped;
  const catalog = JSON.parse(fs.readFileSync(path.join(root,'dist/data/catalog.json')));
  const pin = catalog.projects.find(project=>project.id==='pxcube');
  const snapshot = await buildSnapshot(staticSpec('pxcube',files(directory)));
  if (!pin || snapshot.digest !== pin.digest) throw Error('Relocated PxCube bytes differ from shipped catalog pin');
  if (directory !== local) {fs.mkdirSync(path.dirname(local),{recursive:true}); fs.cpSync(directory,local,{recursive:true});}
  const provenance = {schema:'exact-shipped-pxcube-relocation@1', originalEvidencePath:evidence.site, materializedSource:'dist/compiled/pxcube', localAssemblyPath:'build/pxcube-preserved', digest:snapshot.digest, fileCount:Object.keys(snapshot.files).length, rebuilt:false};
  fs.writeFileSync(path.join(root,'evidence/pxcube-relocation.json'),JSON.stringify(provenance,null,2)+'\n');
  return {directory:local, provenance};
}
