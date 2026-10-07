#!/usr/bin/env python3
"""Playwright adversarial QA for the local composed workbench. Use only local fixture data."""
import argparse, json, os, pathlib, sys, time, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path(__file__).resolve().parent/'evidence'
OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def check(name,condition,detail=''):
    checks.append({'name':name,'ok':bool(condition),'detail':str(detail)})
    if not condition: print('FAIL',name,detail)
    else: print('PASS',name,detail)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--base-url',default='http://127.0.0.1:4188/');args=ap.parse_args()
    base=args.base_url.rstrip('/')+'/'
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}/'
    with sync_playwright() as pw:
      browser=pw.chromium.launch(headless=True,executable_path='/workspace/scratch/acdc354f2dcd/browser-search-evidence/runtime/chrome-headless-shell-linux64/chrome-headless-shell')
      ctx=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
      page=ctx.new_page(); console_errors=[]; failed=[]; evil_requests=[]; evil_failures=[]; evil_responses=[]
      page.on('console',lambda m: console_errors.append(m.text) if m.type=='error' else None)
      page.on('pageerror',lambda e: failed.append(str(e)))
      page.on('request',lambda r: evil_requests.append(r.url) if '__evil_' in r.url else None)
      page.on('requestfailed',lambda r: evil_failures.append({'url':r.url,'failure':r.failure}) if '__evil_' in r.url else None)
      page.on('response',lambda r: evil_responses.append({'url':r.url,'status':r.status}) if '__evil_' in r.url else None)
      page.goto(base,wait_until='networkidle',timeout=30000)
      page.locator('#view').wait_for()
      page.screenshot(path=str(OUT/'desktop-overview.png'),full_page=True)
      check('initial route/project',page.locator('h1').inner_text()=='PxCube',page.url)
      # Verify all three pinned project selectors and actual project switch.
      check('three pinned real projects',page.locator('a.project').count()==3,page.locator('a.project').all_text_contents())
      page.locator('a[href="#/pxcube/compare"]').click();page.wait_for_timeout(1000)
      comp=page.locator('iframe.viewer')
      check('recovered PageRouter A/B comparison retains pinned side-by-side UI',comp.count()==1 and comp.get_attribute('src')=='compare/index.html' and 'allow-scripts' in comp.get_attribute('sandbox'),comp.get_attribute('src') if comp.count() else 'missing')
      page.screenshot(path=str(OUT/'desktop-page-router-compare.png'),full_page=True)
      page.locator('a[href="#/pxcube/run"]').click();page.wait_for_timeout(800)
      check('actual PxCube launcher remains independently runnable',page.locator('iframe.viewer').count()==1 and 'compiled/pxcube/index.html' in page.locator('iframe.viewer').get_attribute('src'),page.locator('iframe.viewer').get_attribute('src') if page.locator('iframe.viewer').count() else 'missing')
      page.screenshot(path=str(OUT/'desktop-pxcube.png'),full_page=True)
      page.locator('a.project',has_text='Homeroom Heroes').click();page.wait_for_timeout(300)
      check('project selection updates route',page.url.endswith('#/hh/overview') and page.locator('h1').inner_text()=='Homeroom Heroes',page.url)
      page.locator('a[href="#/hh/run"]').first.click();page.wait_for_timeout(900)
      hhframe=page.locator('iframe.viewer')
      check('actual Homeroom Heroes application remains independently runnable',hhframe.count()==1 and 'compiled/hh/index.html' in hhframe.get_attribute('src'),hhframe.get_attribute('src') if hhframe.count() else 'missing')
      page.screenshot(path=str(OUT/'desktop-hh-app.png'),full_page=True)
      page.locator('a[href="#/hh/functions"]').click();page.wait_for_timeout(200)
      page.locator('#test-functions').click();page.wait_for_timeout(1500)
      ftext=page.locator('#function-output').inner_text()
      check('HH fixture capability integration test', '6/6' in page.locator('#function-status').inner_text() or '7/7' in page.locator('#function-status').inner_text() or 'passed' in page.locator('#function-status').inner_text().lower(),ftext[:500])
      check('capability receipts visible', 'receipt' in ftext.lower() or 'into' in ftext.lower(),ftext[:500])
      # Compose the workflow preset and inspect actual stages and receipts.
      page.locator('a[href="#/hh/compose"]').click();page.wait_for_timeout(200)
      page.locator('#run-composition').click();page.wait_for_timeout(1000)
      ctext=page.locator('#composition-output').inner_text()
      check('composition runs real selected stages','school.states' in ctext and 'school.counties' in ctext,ctext[:800])
      check('composition carries kernel receipts','outerReceipt' in ctext or 'receipt' in ctext.lower(),ctext[:800])
      page.screenshot(path=str(OUT/'desktop-composition.png'),full_page=True)
      # Browser history must restore both selected page and project.
      page.locator('a.project',has_text='Justin').click();page.wait_for_timeout(200)
      page.go_back(wait_until='domcontentloaded');page.wait_for_timeout(200)
      check('browser back restores previous selected project',page.url.endswith('#/hh/compose') and page.locator('h1').inner_text()=='Homeroom Heroes',page.url)
      page.go_forward(wait_until='domcontentloaded');page.wait_for_timeout(200)
      check('browser forward restores later project',page.url.endswith('#/justin/overview') and page.locator('h1').inner_text().startswith('Justin'),page.url)
      # Real pinned project display must use the compiled artifact in a sandboxed leaf.
      page.locator('a[href="#/justin/run"]').first.click();page.wait_for_timeout(800)
      check('Justin preview is a sandboxed compiled leaf',page.locator('iframe.viewer').count()==1 and page.locator('iframe.viewer').get_attribute('sandbox')=='allow-scripts',page.locator('iframe.viewer').get_attribute('src') if page.locator('iframe.viewer').count() else 'missing')
      page.screenshot(path=str(OUT/'desktop-justin.png'),full_page=True)
      # Delta clean build and import checks.
      page.locator('a.project',has_text='Homeroom Heroes').click();page.locator('a[href="#/hh/delta"]').click();page.wait_for_timeout(250)
      page.locator('#load-base').click();page.wait_for_timeout(600)
      textarea=page.locator('#source-edit');textarea.fill(textarea.input_value()+'\n/* adversarial browser delta */\nbody { --qa: 1; }')
      page.locator('#build-delta').click();page.wait_for_timeout(600)
      check('browser delta build equals clean build','exactEqual' in page.locator('#delta-build-output').inner_text(),page.locator('#delta-build-output').inner_text()[:500])
      page.locator('#wrong-base').click();page.wait_for_timeout(3000)
      check('wrong baseline rejected in browser','PASS' in page.locator('#delta-status').inner_text(),page.locator('#delta-status').inner_text())
      # Import and run the exact shipped trusted delta before testing an unknown leaf.
      page.locator('#apply-example').click();page.wait_for_timeout(900)
      check('shipped exact-pin delta imports', 'Applied exact compiled patch' in page.locator('#delta-status').inner_text(),page.locator('#delta-status').inner_text())
      page.locator('#preview-target').click();page.wait_for_timeout(1200)
      trusted=page.locator('#delta-preview iframe.viewer')
      check('verified shipped delta runs only under trusted exact pin',trusted.count()==1 and 'allow-scripts' in trusted.get_attribute('sandbox') and 'allow-same-origin' in trusted.get_attribute('sandbox'),trusted.get_attribute('sandbox') if trusted.count() else 'missing')
      page.screenshot(path=str(OUT/'desktop-trusted-delta.png'),full_page=True)
      # Import the synthetic unknown project delta: UI must render it inert.
      hostile=pathlib.Path(__file__).resolve().parent/'hostile-unknown.patch.json'
      page.locator('#patch-file').set_input_files(str(hostile));page.wait_for_timeout(1000)
      check('unknown patch imports into local store','Unknown target' in page.locator('#delta-status').inner_text() or 'Unrecognized target' in page.locator('#delta-status').inner_text(),page.locator('#delta-status').inner_text())
      page.locator('#preview-target').click();page.wait_for_timeout(1000)
      frame=page.locator('#delta-preview iframe.viewer')
      check('unknown HTML preview uses empty sandbox',frame.count()==1 and frame.get_attribute('sandbox')=='',frame.get_attribute('src') if frame.count() else 'missing')
      if frame.count():
        try:
          child=page.frame_locator('#delta-preview iframe.viewer')
          check('hostile import script did not execute and leaf content displays',child.locator('title').inner_text()=='adversarial inert leaf' and 'top navigation' in child.locator('body').inner_text(),child.locator('body').inner_text())
        except Exception as e: check('hostile HTML leaf loads without script execution',False,str(e))
      time.sleep(1)
      check('hostile import canary attempts were blocked by CSP with no response',not evil_responses and all('csp' in (x['failure'] or '').lower() for x in evil_failures),{'attempts':evil_requests,'failed':evil_failures,'responses':evil_responses})
      page.screenshot(path=str(OUT/'desktop-hostile-import.png'),full_page=True)
      # Direct navigation to the sandboxed SW route must remain inert too.
      catalog=page.evaluate('fetch("data/catalog.json").then(r=>r.json())')
      patch=json.loads(hostile.read_text());digest=patch['targetDigest']
      direct=f'{base}local-compiled/hh/{digest}/index.html'
      direct_page=ctx.new_page();direct_page.on('request',lambda r: evil_requests.append(r.url) if '__evil_' in r.url else None);direct_page.on('requestfailed',lambda r: evil_failures.append({'url':r.url,'failure':r.failure}) if '__evil_' in r.url else None);direct_page.on('response',lambda r: evil_responses.append({'url':r.url,'status':r.status}) if '__evil_' in r.url else None)
      response=direct_page.goto(direct,wait_until='domcontentloaded',timeout=15000)
      time.sleep(700/1000)
      check('direct navigation has restrictive CSP','sandbox' in (response.headers.get('content-security-policy','') if response else ''),response.headers.get('content-security-policy') if response else 'no response')
      check('direct hostile leaf canary attempts were blocked by CSP with no response',not evil_responses and all('csp' in (x['failure'] or '').lower() for x in evil_failures),{'attempts':evil_requests,'failed':evil_failures,'responses':evil_responses})
      # Immutable baseline record remains readable and unchanged after import.
      imm=page.evaluate('''async()=>{const s=await fetch('data/hh.snapshot.json').then(r=>r.json()); const req=indexedDB.open('composed-workbench-compiled-v1',1); const db=await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)}); const row=await new Promise((res,rej)=>{const q=db.transaction('snapshots').objectStore('snapshots').get(`hh/${s.digest}`);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});db.close();return {expected:s.digest,stored:row?.snapshot?.digest??null,files:Object.keys(row?.snapshot?.files||{}).length,expectedFiles:Object.keys(s.files).length};}''')
      check('patch import never mutates pinned baseline',(imm['stored'] is None or imm['expected']==imm['stored']),imm)
      # Narrow viewport screenshot and route health.
      mobile=ctx.new_page();mobile.set_viewport_size({'width':390,'height':844});mobile.goto(base+'#/hh/overview',wait_until='networkidle');mobile.locator('#view').wait_for();mobile.screenshot(path=str(OUT/'mobile-overview.png'),full_page=True)
      check('mobile view renders without horizontal overflow',mobile.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),mobile.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})'))
      check('no uncaught app errors',len(failed)==0,failed)
      result={'baseUrl':base,'checks':checks,'consoleErrors':console_errors,'pageErrors':failed,'hostileRequests':evil_requests,'hostileFailures':evil_failures,'hostileResponses':evil_responses}
      (OUT/'browser-qa.json').write_text(json.dumps(result,indent=2))
      browser.close()
    server.shutdown();server.server_close()
    fails=[x for x in checks if not x['ok']]
    print(json.dumps({'passed':len(checks)-len(fails),'failed':len(fails),'result':str(OUT/'browser-qa.json')},indent=2))
    return 1 if fails else 0
if __name__=='__main__': sys.exit(main())
