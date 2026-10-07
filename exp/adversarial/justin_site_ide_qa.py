#!/usr/bin/env python3
"""Browser QA for Justin's pinned site IDE and annotation prototype flow."""
import json, pathlib, sys, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent / 'evidence'
OUT.mkdir(parents=True, exist_ok=True)
SESSION = OUT / 'reproducible-session.json'
checks = []

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def check(name, ok, detail=''):
    checks.append({'name': name, 'ok': bool(ok), 'detail': str(detail)})
    print(('PASS' if ok else 'FAIL'), name, detail)

def inspect(page):
    return json.loads(page.locator('#annotation-inspect').text_content())

def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'dist')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/workspace/scratch/acdc354f2dcd/browser-search-evidence/runtime/chrome-headless-shell-linux64/chrome-headless-shell')
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + '#/justin/run', wait_until='networkidle', timeout=30000)
        page.locator('#justin-preview').wait_for()
        frame = page.frame_locator('#justin-preview')
        frame.locator('body').wait_for()
        page.wait_for_function("document.querySelector('#justin-preview')?.contentDocument?.querySelector('#pxcube-annotations')")
        preview = page.locator('#justin-preview')
        check('Justin run view opens pinned IDE preview', page.locator('h2').filter(has_text='Site IDE').count() == 1 and preview.get_attribute('sandbox') == 'allow-scripts allow-same-origin', {'url': preview.get_attribute('src'), 'sandbox': preview.get_attribute('sandbox')})
        check('six real site pages can be selected', page.locator('#justin-page option').count() == 6, page.locator('#justin-page option').all_text_contents())
        page.screenshot(path=str(OUT / 'justin-ide-initial.png'), full_page=True)

        # The same annotation state drives hidden -> visible -> hidden, with real marker geometry.
        toggle = page.locator('#annotation-toggle')
        check('annotation markers start hidden', not toggle.is_checked() and frame.locator('#pxcube-annotations').get_attribute('data-annotation-state') == 'hidden' and frame.locator('[data-annotation-marker]').count() == 0, frame.locator('#pxcube-annotations').get_attribute('data-annotation-state'))
        toggle.check()
        page.wait_for_function("document.querySelector('#justin-preview')?.contentDocument?.querySelectorAll('[data-annotation-marker]').length > 0")
        page.wait_for_function("document.querySelector('#annotation-inspect')?.textContent.length > 0")
        visible = frame.locator('[data-annotation-marker]').count()
        visible_inspection = inspect(page)
        annotation_runtime = visible_inspection.get('annotation', {})
        check('annotation toggle projects visible geometry markers', visible > 0 and frame.locator('#pxcube-annotations').get_attribute('data-annotation-state') == 'visible', {'markerCount': visible, 'state': frame.locator('#pxcube-annotations').get_attribute('data-annotation-state')})
        check('annotation event and seek are backed by PxC Parts and receipts', all(k in annotation_runtime for k in ('state', 'receipts', 'parts', 'definition')) and len(annotation_runtime.get('receipts', [])) >= 4 and all(p.get('part') == 'actual' for p in annotation_runtime.get('parts', [])), visible_inspection)
        page.screenshot(path=str(OUT / 'justin-ide-annotations.png'), full_page=True)
        toggle.uncheck()
        page.wait_for_function("document.querySelector('#justin-preview')?.contentDocument?.querySelector('#pxcube-annotations')?.dataset.annotationState === 'hidden'")
        check('annotation toggle returns to hidden with zero markers', frame.locator('[data-annotation-marker]').count() == 0 and frame.locator('#pxcube-annotations').get_attribute('data-annotation-state') == 'hidden', frame.locator('#pxcube-annotations').get_attribute('data-annotation-state'))

        # Select page routes and verify issue lists are scoped to each page's anchor map.
        page.locator('#justin-page').select_option('about.html')
        page.wait_for_function("document.querySelector('#justin-preview')?.contentDocument?.querySelector('h1')?.textContent.includes('About')")
        about_ids = page.locator('#issue-list [data-issue]').evaluate_all("nodes => nodes.map(n => n.dataset.issue)")
        check('page selector loads About and only its mapped findings', frame.locator('h1').inner_text().startswith('About') and about_ids == ['F01'], about_ids)
        page.locator('#justin-page').select_option('community.html')
        page.wait_for_function("document.querySelector('#justin-preview')?.contentDocument?.querySelector('h1')?.textContent.includes('Community')")
        community_ids = page.locator('#issue-list [data-issue]').evaluate_all("nodes => nodes.map(n => n.dataset.issue)")
        check('Community page selects its own marker tree and findings', 'F04' in community_ids and 'F09' in community_ids and frame.locator('h1').inner_text().startswith('Community'), community_ids)

        # F01 is a preview-only CSS change on the exact existing direct-link navigation.
        page.locator('#justin-page').select_option('index.html')
        page.wait_for_function("document.querySelector('#justin-preview')?.contentDocument?.querySelector('h1')")
        page.locator('#justin-viewport').select_option('320')
        page.wait_for_function("document.querySelector('#justin-preview')?.contentWindow?.innerWidth === 320")
        nav = frame.locator('body > header nav')
        before_nav_style = nav.evaluate("e => getComputedStyle(e).display")
        check('320px viewport preserves original hidden-nav condition before fix', before_nav_style == 'none', before_nav_style)
        page.locator('[data-fix="F01"]').click()
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('applied')")
        after_nav = nav.evaluate("e => ({display:getComputedStyle(e).display,wrap:getComputedStyle(e).flexWrap,links:e.querySelectorAll(':scope > a').length})")
        check('F01 fix safely reveals and wraps the actual six direct nav links', after_nav['display'] == 'flex' and after_nav['wrap'] == 'wrap' and after_nav['links'] == 6, after_nav)
        with page.expect_download() as pending:
            page.locator('#export-prototype').click()
        prototype_path = OUT / 'justin-prototype.json'
        pending.value.save_as(prototype_path)
        prototype = json.loads(prototype_path.read_text())
        catalog = page.evaluate("fetch('data/catalog.json').then(r=>r.json())")
        justin = next(p for p in catalog['projects'] if p['id'] == 'justin')
        operation_json = json.dumps(prototype.get('operations', []), sort_keys=True).lower()
        all_json = json.dumps(prototype, sort_keys=True).lower()
        forbidden_keys = ('password', 'credential', 'authorization', 'cookie', 'sessiontoken', 'formvalue')
        check('prototype export is exact-base pinned and carries only typed preview operations', prototype.get('schema') == 'justin-site-prototype@1' and prototype.get('base', {}).get('compiledDigest') == justin['digest'] and prototype.get('base', {}).get('sourcePin') == justin['pin'] and bool(prototype.get('base', {}).get('implementationPin')) and prototype.get('page') == 'index.html' and len(prototype.get('operations', [])) > 0, {k: prototype.get(k) for k in ('schema', 'base', 'page', 'operations')})
        check('export contains no form/session secrets or receipt data', not any(key in all_json for key in forbidden_keys) and 'receipt' not in all_json and 'qa-sensitive-form-sentinel' not in all_json, sorted(prototype.keys()))
        page.screenshot(path=str(OUT / 'justin-ide-fixed-export.png'), full_page=True)
        page.locator('#undo-prototype').click()
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('undone')")
        undone = nav.evaluate("e => ({display:getComputedStyle(e).display,style:e.getAttribute('style')})")
        check('Undo restores the original navigation CSS exactly', undone['display'] == 'none', undone)

        # F05 exercises a guarded attribute change and reversible undo on the Contact page.
        page.locator('#justin-page').select_option('contact.html')
        page.wait_for_function("document.querySelector('#justin-preview')?.contentDocument?.querySelector('form')")
        form = frame.locator('main form')
        original_id = form.get_attribute('id')
        page.locator('[data-fix="F05"]').click()
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('applied')")
        check('Contact fix adds only the declared destination id', form.get_attribute('id') == 'get-involved', form.get_attribute('id'))
        page.locator('#undo-prototype').click()
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('undone')")
        check('attribute undo restores the original form id', form.get_attribute('id') == original_id, form.get_attribute('id'))

        # Exercise the other surfaced safe CSS fixes and their undo path as well.
        page.locator('#justin-page').select_option('index.html')
        page.wait_for_function("document.querySelector('#justin-preview')?.contentDocument?.querySelector('h1')")
        page.locator('#justin-viewport').select_option('390')
        page.wait_for_function("document.querySelector('#justin-preview')?.contentWindow?.innerWidth === 390")
        footer_links = frame.locator('body > footer div.flex.space-x-6')
        original_footer_wrap = footer_links.evaluate('e => getComputedStyle(e).flexWrap')
        footer_hrefs = footer_links.locator('a').evaluate_all('es => es.map(a => a.getAttribute("href"))')
        race = page.evaluate("""() => {
          const preview = document.querySelector('#justin-preview');
          const originalDocument = preview.contentDocument;
          document.querySelector('#issue-list [data-fix="F02"]').click();
          const immediate = {
            page: document.querySelector('#justin-page').disabled,
            viewport: document.querySelector('#justin-viewport').disabled,
            annotation: document.querySelector('#annotation-toggle').disabled,
            undo: document.querySelector('#undo-prototype').disabled,
            reset: document.querySelector('#reset-prototype').disabled,
            export: document.querySelector('#export-prototype').disabled,
            fix: document.querySelector('#issue-list [data-fix="F02"]').disabled,
            previewPointerEvents: preview.style.pointerEvents,
          };
          const selection = document.querySelector('#justin-page');
          selection.value = 'about.html';
          selection.dispatchEvent(new Event('change', {bubbles:true}));
          return {...immediate, selectionAfterAttempt:selection.value, previewSrc:preview.getAttribute('src'), sameDocument:preview.contentDocument === originalDocument};
        }""")
        check('busy preview fix synchronously locks all competing controls', all(race[k] for k in ('page','viewport','annotation','undo','reset','export','fix')) and race['previewPointerEvents'] == 'none', race)
        check('synthetic page change during fix preserves current document and selection', race['selectionAfterAttempt'] == 'index.html' and race['previewSrc'].endswith('/compiled/justin/index.html') and race['sameDocument'], race)
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('applied')")
        footer_after = footer_links.evaluate("e => {const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,viewport:innerWidth,flexWrap:getComputedStyle(e).flexWrap,hrefs:[...e.querySelectorAll('a')].map(a=>a.getAttribute('href'))}}")
        check('F02 fix reflows the footer row fully inside 390px without changing links', footer_after['flexWrap'] == 'wrap' and footer_after['left'] >= 0 and footer_after['right'] <= footer_after['viewport'] + 1 and footer_after['hrefs'] == footer_hrefs, {**footer_after, 'beforeWrap': original_footer_wrap})
        with page.expect_download() as pending:
            page.locator('#export-prototype').click()
        f02_export_path = OUT / 'justin-f02-prototype.json'
        pending.value.save_as(f02_export_path)
        f02_export = json.loads(f02_export_path.read_text())
        check('completed race retains the exact F02 operation in export', f02_export.get('page') == 'index.html' and len(f02_export.get('operations', [])) == 2 and all(op.get('route') == 'index.html' for op in f02_export.get('operations', [])), f02_export.get('operations'))
        page.locator('#undo-prototype').click()
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('undone')")
        check('F02 undo restores original footer wrapping', footer_links.evaluate('e => getComputedStyle(e).flexWrap') == original_footer_wrap, original_footer_wrap)
        with page.expect_download() as pending:
            page.locator('#export-prototype').click()
        undone_export_path = OUT / 'justin-f02-undone.json'
        pending.value.save_as(undone_export_path)
        undone_export = json.loads(undone_export_path.read_text())
        check('undo clears the F02 operation from prototype export history', undone_export.get('page') == 'index.html' and undone_export.get('operations') == [], undone_export.get('operations'))

        amber_text = frame.locator('main .text-amber-600').first
        footer_muted = frame.locator('body > footer .text-gray-500')
        original_amber = amber_text.evaluate('e => getComputedStyle(e).color')
        original_muted = footer_muted.evaluate('e => getComputedStyle(e).color')
        page.locator('[data-fix="F07"]').click()
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('applied')")
        adjusted = {'amber': amber_text.evaluate('e => getComputedStyle(e).color'), 'footer': footer_muted.evaluate('e => getComputedStyle(e).color')}
        check('F07 fix changes only the declared text color tokens', adjusted['amber'] == 'rgb(146, 64, 14)' and adjusted['footer'] == 'rgb(209, 213, 219)', adjusted)
        page.locator('#undo-prototype').click()
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('undone')")
        restored = {'amber': amber_text.evaluate('e => getComputedStyle(e).color'), 'footer': footer_muted.evaluate('e => getComputedStyle(e).color')}
        check('F07 undo restores both original text colors', restored == {'amber': original_amber, 'footer': original_muted}, restored)

        page.locator('#justin-page').select_option('blog.html')
        page.wait_for_function("document.querySelector('#justin-preview')?.contentDocument?.querySelector('main article details > summary')")
        summary = frame.locator('main article details > summary')
        original_outline = summary.evaluate('e => ({style:e.style.outline,width:getComputedStyle(e).outlineWidth})')
        page.locator('[data-fix="F06"]').click()
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('applied')")
        focus_outline = summary.evaluate('e => ({style:e.style.outline,width:getComputedStyle(e).outlineWidth,color:getComputedStyle(e).outlineColor})')
        check('F06 preview fix adds the declared visible focus outline', focus_outline['width'] == '3px' and focus_outline['color'] == 'rgb(7, 89, 133)', focus_outline)
        page.locator('#undo-prototype').click()
        page.wait_for_function("document.querySelector('#prototype-status')?.textContent.includes('undone')")
        restored_outline = summary.evaluate('e => ({style:e.style.outline,width:getComputedStyle(e).outlineWidth})')
        check('F06 undo restores the original outline style', restored_outline == original_outline, restored_outline)

        # Narrow the workbench itself and ensure the surrounding body still fits.
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / 'justin-ide-mobile.png'), full_page=True)
        dimensions = page.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth,body:document.body.scrollWidth})')
        check('Justin IDE mobile shell has no horizontal body overflow', dimensions['scroll'] <= dimensions['width'] and dimensions['body'] <= dimensions['width'], dimensions)
        check('Justin IDE route has no uncaught browser errors', not errors, errors)

        # Existing reproducible HH session must still import after this audit-only build.
        hh = context.new_page()
        hh.on('pageerror', lambda error: errors.append(str(error)))
        hh.goto(base + '#/hh/compose', wait_until='networkidle', timeout=30000)
        hh.locator('#live-session').wait_for()
        hh.locator('#import-session').set_input_files(str(SESSION))
        hh.wait_for_timeout(1000)
        session_status = hh.locator('#program-status').inner_text()
        check('prior exact-pin HH reproducible session imports after Justin IDE build', 'loaded into the same owning kernel' in session_status and hh.locator('#program-id').input_value() == 'countiesForStateQALarger', session_status)
        check('old HH session remains inspectable without auto-run', 'Actual invocation evidence appears here' in hh.locator('#program-output').inner_text(), hh.locator('#program-output').inner_text()[:300])
        check('HH import after audit build has no uncaught browser errors', not errors, errors)

        # A dependency-derived changed implementation identity must reject the same session atomically.
        compatibility = json.loads((ROOT / 'evidence' / 'evaluator-compatibility.json').read_text())
        changed_pin = compatibility['changedImplementationPin']
        incompatible = context.new_page()
        incompatible.on('pageerror', lambda error: errors.append(str(error)))
        def changed_catalog(route):
            data = json.loads((ROOT / 'dist' / 'data' / 'catalog.json').read_text())
            data.setdefault('release', {})['siteBuildId'] = changed_pin
            data['release']['buildId'] = changed_pin
            route.fulfill(status=200, content_type='application/json', body=json.dumps(data))
        incompatible.route('**/data/catalog.json', changed_catalog)
        incompatible.goto(base + '#/hh/compose', wait_until='networkidle', timeout=30000)
        incompatible.locator('#live-session').wait_for()
        incompatible.locator('#import-session').set_input_files(str(SESSION))
        incompatible.wait_for_timeout(600)
        reject_status = incompatible.locator('#program-status').inner_text()
        check('dependency-derived changed HH compatibility pin rejects old session', 'Session rejected' in reject_status and 'exact project pin' in reject_status, {'pin': changed_pin, 'status': reject_status})
        check('changed-pin rejection leaves fresh definitions and invocation untouched', incompatible.locator('#defined-calculations [data-use-calculation]').count() == 0 and 'Actual invocation evidence appears here' in incompatible.locator('#program-output').inner_text(), {'definitions': incompatible.locator('#defined-calculations').inner_text(), 'output': incompatible.locator('#program-output').inner_text()[:240]})
        check('changed-pin rejection has no uncaught browser errors', not errors, errors)
        report = {'baseUrl': base, 'checks': checks, 'pageErrors': errors, 'justinDigest': justin['digest'], 'prototypeExport': str(prototype_path), 'sessionFile': str(SESSION)}
        (OUT / 'justin-site-ide-qa.json').write_text(json.dumps(report, indent=2))
        browser.close()
    server.shutdown(); server.server_close()
    failed = [item for item in checks if not item['ok']]
    print(json.dumps({'passed': len(checks) - len(failed), 'failed': len(failed), 'result': str(OUT / 'justin-site-ide-qa.json')}, indent=2))
    return 1 if failed else 0

if __name__ == '__main__': sys.exit(main())
