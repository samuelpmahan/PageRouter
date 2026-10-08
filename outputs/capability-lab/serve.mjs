import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const types = { '.html':'text/html; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
const host = process.env.CAPABILITY_LAB_HOST || '127.0.0.1';
const port = Number(process.env.CAPABILITY_LAB_PORT || process.argv[2] || 4173);

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow:'GET, HEAD' }).end('Method not allowed'); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  if (pathname === '/') pathname = '/index.html';
  const file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end('Forbidden'); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Content-Length':body.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    if (request.method === 'HEAD') response.end(); else response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' }).end('Not found');
  }
});

server.listen(port, host, () => console.log(`Capability Lab available at http://${host}:${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
