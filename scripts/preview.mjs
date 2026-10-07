import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(import.meta.dirname,'../dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.wasm':'application/wasm',
  '.gz':'application/gzip','.zip':'application/zip'};

export function createPreviewServer(directory=root){
  const base=path.resolve(directory);
  return http.createServer(async(request,response)=>{
    try{
      const url=new URL(request.url,'http://localhost');
      let name=decodeURIComponent(url.pathname);
      if(name.endsWith('/'))name+='index.html';
      const file=path.resolve(base,'.'+name);
      if(!file.startsWith(base+path.sep))throw new TypeError('Path outside preview root');
      const bytes=await fs.readFile(file);
      response.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]??'application/octet-stream','Cache-Control':'no-store'});
      response.end(bytes);
    }catch(error){response.writeHead(error instanceof TypeError?400:404,{'Content-Type':'text/plain; charset=utf-8'});response.end('Unavailable');}
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT??4188);
  createPreviewServer().listen(port,'0.0.0.0',()=>console.log(`Atlas preview listening on http://localhost:${port}`));
}
