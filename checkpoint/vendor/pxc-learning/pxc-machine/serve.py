"""Local-only workbench. python3 serve.py --port 8766"""
import argparse
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from pipeline import build_run, catalog

HERE = Path(__file__).resolve().parent


class Handler(BaseHTTPRequestHandler):
    def send(self, value, content_type='application/json', status=200):
        data = value if isinstance(value,bytes) else json.dumps(value,separators=(',',':'),allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        if len(data)>2000 and 'gzip' in self.headers.get('Accept-Encoding',''):
            data=gzip.compress(data); self.send_header('Content-Encoding','gzip')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        path=self.path.split('?')[0]
        if path=='/interrupts':
            return self.send((HERE/'extensions/interrupts/viewer.html').read_bytes(),'text/html; charset=utf-8')
        if path=='/api/interrupts':
            artifact=HERE/'extensions/interrupts/run.json'
            if not artifact.is_file():
                return self.send({'error':'Interrupt experiment evidence is still being generated.'},status=409)
            return self.send(artifact.read_bytes(),'application/json')
        if path=='/optimization':
            return self.send((HERE/'optimization.html').read_bytes(),'text/html; charset=utf-8')
        if path=='/api/optimization':
            folder=HERE/'extensions/optimization'
            if not all((folder/name).is_file() for name in ('receipt.json','example.json')):
                return self.send({'error':'Optimization evidence is still being verified.'},status=409)
            return self.send({name:json.loads((folder/file).read_text())
                              for name,file in [('receipt','receipt.json'),('example','example.json')]})
        if path=='/explanation':
            return self.send((HERE/'lanes/explanation/viewer.html').read_bytes(),'text/html; charset=utf-8')
        if path in ('/api/explanation','/api/explanation/inspect','/api/explanation/devices','/api/explanation/composition'):
            from lanes.explanation import diagnostics
            try:
                if path=='/api/explanation':
                    return self.send(diagnostics.report())
                if path=='/api/explanation/devices':
                    return self.send(diagnostics.device_report())
                if path=='/api/explanation/composition':
                    return self.send(diagnostics.composition_report())
                query=parse_qs(urlparse(self.path).query)
                return self.send(diagnostics.api_inspect(query.get('case',[''])[0],query.get('side',['observed'])[0],
                    int(query.get('t',['0'])[0]),query.get('address',[''])[0]))
            except (ValueError,KeyError,TypeError) as exc:
                return self.send({'error':str(exc)},status=400)
        if path in ('/','/index.html','/viewer.html'):
            return self.send((HERE/'viewer.html').read_bytes(),'text/html; charset=utf-8')
        if path=='/api/catalog':
            return self.send(catalog())
        if path in ('/viewer.js','/viewer.css') and (HERE/path[1:]).is_file():
            return self.send((HERE/path[1:]).read_bytes(),'text/javascript' if path.endswith('.js') else 'text/css')
        if path=='/favicon.ico':
            return self.send(b'','image/x-icon',204)
        self.send({'error':'not found'},status=404)

    def do_POST(self):
        if self.path!='/api/run':
            return self.send({'error':'not found'},status=404)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=100000:
                raise ValueError('request body must contain at most 100,000 bytes')
            request=json.loads(self.rfile.read(length))
            self.send(build_run(request))
        except (ValueError,TypeError,KeyError) as exc:
            self.send({'error':str(exc)},status=400)


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=8766)
    port=parser.parse_args().port
    print(f'PxC machine: http://127.0.0.1:{port}/',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
