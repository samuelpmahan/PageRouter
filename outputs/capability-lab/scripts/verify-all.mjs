#!/usr/bin/env node
// Run the complete nested test tree with the pinned Node executable.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
async function walk(directory) {
  const entries=await readdir(directory,{withFileTypes:true});
  const found=[];
  for(const entry of entries){
    const path=join(directory,entry.name);
    if(entry.isDirectory()) found.push(...await walk(path));
    else if(entry.isFile()&&entry.name.endsWith('.test.mjs')) found.push(path);
  }
  return found;
}
const tests=(await walk(join(root,'test'))).sort();
if(!tests.length){console.error('No .test.mjs files found under test/.');process.exit(2);}
const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...tests],{cwd:root,stdio:'inherit'});
if(result.error) throw result.error;
process.exit(result.status ?? 1);
