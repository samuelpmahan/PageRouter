import {readFile,writeFile} from 'node:fs/promises';
import {captureAtlasCase,runAtlasJs,compareAtlasObservations} from '../exp/atlas/cross-language.mjs';

async function main(){
  const [mode,casePath,observationPath]=process.argv.slice(2);
  if(!['capture','compare'].includes(mode)||!casePath||(mode==='compare'&&!observationPath))throw new Error('usage: node scripts/atlas-cross-language.mjs capture CASE.json [OPTIONS.json] | compare CASE.json PYTHON.json');
  if(mode==='capture'){
    const options=observationPath?JSON.parse(await readFile(observationPath,'utf8')):{};
    const record=await captureAtlasCase(options);
    await writeFile(casePath,JSON.stringify(record,null,2)+'\n');
    console.log(JSON.stringify(record));return;
  }
  const record=JSON.parse(await readFile(casePath,'utf8'));
  const python=JSON.parse(await readFile(observationPath,'utf8'));
  const js=await runAtlasJs(record);
  console.log(JSON.stringify(await compareAtlasObservations(record,js,python)));
}
main().catch(error=>{console.error(`${error.name}: ${error.message}`);process.exitCode=1;});
