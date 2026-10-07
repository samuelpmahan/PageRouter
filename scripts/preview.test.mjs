import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewServer} from './preview.mjs';

test('local preview serves built ES modules with executable JavaScript MIME',async()=>{
  const server=createPreviewServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const module=await fetch(base+'/app.mjs');
    assert.equal(module.status,200);
    assert.match(module.headers.get('content-type'),/^text\/javascript/);
    const missing=await fetch(base+'/missing.mjs');
    assert.equal(missing.status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
