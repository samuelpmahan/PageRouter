from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
import threading,pathlib,json
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root/'dist')))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/workspace/scratch/acdc354f2dcd/browser-search-evidence/runtime/chrome-headless-shell-linux64/chrome-headless-shell')
 page=browser.new_page(viewport={'width':1500,'height':1050});errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
 page.goto(f'http://127.0.0.1:{server.server_port}/#/hh/compose',wait_until='networkidle')
 page.locator('#run-program').wait_for();page.locator('#run-program').click();page.wait_for_timeout(1500)
 print('STATUS:',page.locator('#program-status').inner_text());print('OUTPUT:',page.locator('#program-output').inner_text()[:800]);print('ERRORS:',errs)
 page.screenshot(path=str(root/'evidence/visual-repl-local-candidate.png'),full_page=True)
 browser.close()
server.shutdown()
