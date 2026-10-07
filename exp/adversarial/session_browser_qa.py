#!/usr/bin/env python3
"""Visual REPL, nested Calculation and exact-pin session adversarial QA."""
import json, pathlib, sys, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path(__file__).resolve().parent/'evidence';OUT.mkdir(parents=True,exist_ok=True)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
checks=[]
def check(name,ok,detail=''):
    checks.append({'name':name,'ok':bool(ok),'detail':str(detail)})
    print(('PASS' if ok else 'FAIL'),name,detail)
def parsed(page,selector): return json.loads(page.locator(selector).inner_text())
def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}/'
    with sync_playwright() as pw:
      browser=pw.chromium.launch(headless=True,executable_path='/workspace/scratch/acdc354f2dcd/browser-search-evidence/runtime/chrome-headless-shell-linux64/chrome-headless-shell')
      context=browser.new_context(viewport={'width':1440,'height':1100},accept_downloads=True)
      page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
      page.goto(base+'#/hh/compose',wait_until='networkidle');page.locator('#live-session').wait_for()
      project_pin=page.locator('.footer').inner_text().split('compiled SHA-256 ')[1].split('\n')[0].strip()
      # Caller input is visible and drives the named reusable calculation.
      page.locator('#program-id').fill('countiesForStateQA')
      caller=page.locator('#caller-input-ports input[aria-label="Caller input state"]')
      caller.fill('Demo Washington')
      page.locator('#save-program').click();page.wait_for_timeout(900)
      define_status=page.locator('#program-status').inner_text()
      check('define operation creates named Calculation Part','countiesForStateQA' in define_status and 'hh.workbench.defined.' in define_status,define_status)
      check('defined Calculation appears as reusable node',page.locator('#defined-calculations').get_by_text('countiesForStateQA').count()>0,page.locator('#defined-calculations').inner_text()[:400])
      page.locator('#run-program').click();page.wait_for_timeout(800)
      first=parsed(page,'#program-output')
      check('caller input runs actual function Part',first.get('ok') is True and 'Demo King' in json.dumps(first),json.dumps(first)[:500])
      # Changing the caller port changes downstream service execution without source editing.
      caller=page.locator('#caller-input-ports input[aria-label="Caller input state"]');caller.fill('Demo California')
      page.locator('#run-program').click();page.wait_for_timeout(800)
      second=parsed(page,'#program-output')
      check('edited caller state changes calculated service result','Demo Alameda' in json.dumps(second) and 'Demo King' not in json.dumps(second),json.dumps(second)[:500])
      # Select a typed prior-output connection through the visible binding control.
      stages=page.locator('#program-stages .program-stage')
      bind=stages.nth(1).locator('.binding-source')
      options=bind.locator('option').all_text_contents()
      check('compatible typed output is offered as a wire option',any('states → data.values.0 · string' in x for x in options),options)
      bind.select_option('ref:states.data.values.0')
      check('visible output wire disables its literal parameter',stages.nth(1).locator('.parameter-value').is_disabled(),stages.nth(1).locator('.wire-hint').inner_text())
      page.locator('#run-program').click();page.wait_for_timeout(1000)
      wired=parsed(page,'#program-output')
      check('wired source output drives the next input','Demo Alameda' in json.dumps(wired),json.dumps(wired)[:500])
      # Reuse the named function as an actual nested Calculation in a larger graph.
      page.locator('[data-use-calculation="calculation.countiesForStateQA"]').click();page.wait_for_timeout(300)
      bigger=page.locator('#program-stages .program-stage')
      check('named Calculation is inserted as third graph node',bigger.count()==3 and bigger.nth(2).locator('.stage-operation').input_value().startswith('calculation.countiesForStateQA'),[bigger.nth(i).locator('.stage-operation').input_value() for i in range(bigger.count())])
      nested=bigger.nth(2).locator('.binding-source')
      nested_opts=nested.locator('option').all_text_contents()
      check('nested node offers a compatible prior output wire',any('states → data.values.0 · string' in x for x in nested_opts),nested_opts)
      nested.select_option('ref:states.data.values.0')
      page.locator('#run-program').click();page.wait_for_timeout(1200)
      graph_result=parsed(page,'#program-output')
      source=page.locator('#program-source').inner_text()
      outer_outcomes=graph_result.get('result',{}).get('outcomes',[])
      nested_call=outer_outcomes[2] if len(outer_outcomes)>2 else {}
      nested_outcomes=nested_call.get('result',{}).get('outcomes',[])
      nested_values=nested_outcomes[1].get('result',{}).get('data',{}).get('values',[]) if len(nested_outcomes)>1 else []
      check('nested graph runs and reuses exact pinned Calculation',nested_call.get('operation','').startswith('calculation.countiesForStateQA@') and nested_call.get('ok') is True and 'Demo Alameda' in nested_values,{'nestedOperation':nested_call.get('operation'),'nestedOK':nested_call.get('ok'),'nestedCountyValues':nested_values,'source':source})
      check('real Calculation and service receipt evidence is inspectable',bool(graph_result.get('receipt',{}).get('into')) and page.locator('#part-address option').count()>0,graph_result.get('receipt'))
      part_options=[o.get_attribute('value') for o in page.locator('#part-address option').all()]
      calculation_part=next((x for x in part_options if 'hh.workbench.defined.countiesForStateQALarger.v1.calculation' in x),None)
      page.locator('#part-address').select_option(calculation_part)
      function_inspection=parsed(page,'#part-inspection')
      check('discover/inspect exposes the nested real function Part',function_inspection.get('kind')=='definedCalculationPart' and function_inspection.get('calculation',{}).get('version')==1 and function_inspection.get('value',{}).get('executable') is True,function_inspection)
      result_part=graph_result.get('receipt',{}).get('into')
      check('actual graph result Part is discoverable in the same PxC',result_part in part_options,result_part)
      page.locator('#part-address').select_option(result_part)
      result_inspection=parsed(page,'#part-inspection')
      check('result inspection carries produced receipt and nested value',result_inspection.get('receipt',{}).get('status')=='produced' and 'Demo Alameda' in json.dumps(result_inspection.get('value')),{'receipt':result_inspection.get('receipt'),'address':result_inspection.get('address')})
      page.screenshot(path=str(OUT/'session-repl-nested-graph.png'),full_page=True)
      # Save a portable graph/session. Interface, ports, params and bindings remain separate from receipts.
      with page.expect_download() as pending: page.locator('#export-session').click()
      download=pending.value;session_path=OUT/'reproducible-session.json';download.save_as(session_path)
      data=json.loads(session_path.read_text())
      check('saved session carries both exact project and implementation pins',data.get('projectPin')==project_pin and bool(data.get('implementationPin')),{'projectPin':data.get('projectPin'),'implementationPin':data.get('implementationPin'),'footerPin':project_pin})
      graph=data.get('graph',{});nodes=graph.get('nodes',[])
      check('graph export separates node params, typed ports and bindings',len(nodes)==3 and all('inputPorts' in n and 'outputPorts' in n and 'parameters' in n and 'bindings' in n for n in nodes),nodes)
      check('graph interface remains distinct and typed',graph.get('interface',{}).get('inputs',{}).get('state',{}).get('type')=='string',graph.get('interface'))
      check('nested Calculation export pins exact version',any('calculation.countiesForStateQA@' in n.get('calculation','') and n.get('calculationVersion',0)>0 and '.v' in n.get('implementationPart','') for n in nodes),nodes)
      versions=[(d['id'],d['version'],d['active']) for d in data['hhSession']['definitions']]
      check('stable run/edit history avoids redundant Calculation versions',len([v for v in versions if v[0]=='countiesForStateQA'])==2 and len([v for v in versions if v[0]=='countiesForStateQALarger'])==1,versions)
      check('editor state preserves normalized stop-on-failure setting',data.get('editor',{}).get('plan',{}).get('stopOnFailure') is True,data.get('editor',{}).get('plan'))
      check('session source contains no receipt or executable source payload','"receipt"' not in json.dumps(data).lower() and 'function(' not in json.dumps(data).lower(),list(data.keys()))
      page.screenshot(path=str(OUT/'session-export-graph.png'),full_page=True)
      # Import into a fresh tab must restore source definitions/editor but not execute.
      fresh=context.new_page();fresh.on('pageerror',lambda e:errors.append(str(e)));fresh.goto(base+'#/hh/compose',wait_until='networkidle');fresh.locator('#live-session').wait_for()
      check('fresh tab starts without prior REPL definitions', fresh.locator('#defined-calculations [data-use-calculation]').count()==0 and 'countiesForStateQA' not in fresh.locator('#defined-calculations').inner_text(),fresh.locator('#defined-calculations').inner_text())
      fresh.locator('#import-session').set_input_files(str(session_path));fresh.wait_for_timeout(1000)
      import_status=fresh.locator('#program-status').inner_text()
      check('exact-pin session reload restores definitions/editor', 'loaded into the same owning kernel' in import_status and fresh.locator('#program-id').input_value()=='countiesForStateQALarger',import_status)
      check('session import does not auto-run', 'Actual invocation evidence appears here' in fresh.locator('#program-output').inner_text(),fresh.locator('#program-output').inner_text()[:200])
      before_names=fresh.locator('#defined-calculations').inner_text()
      before_id=fresh.locator('#program-id').input_value();before_source=fresh.locator('#program-source').inner_text()
      fresh.screenshot(path=str(OUT/'session-reopened.png'),full_page=True)
      before_active_addresses=fresh.locator('#defined-calculations .stage small').all_text_contents()
      fresh.locator('#run-program').click();fresh.wait_for_timeout(1200)
      reopened=parsed(fresh,'#program-output')
      check('explicit invocation after reload produces expected result','Demo Alameda' in json.dumps(reopened) and reopened.get('ok') is True,json.dumps(reopened)[:800])
      after_active_addresses=fresh.locator('#defined-calculations .stage small').all_text_contents()
      check('reopen run retains imported definition versions without silent replacement',after_active_addresses==before_active_addresses,{'before':before_active_addresses,'after':after_active_addresses})
      # Wrong pin and cyclic graph files should leave editor, Parts and active definitions untouched.
      wrong=dict(data);wrong['projectPin']='0'*64;wrong['editor']={**data['editor'],'id':'shouldNotReplaceEditor'}
      wrong_path=OUT/'wrong-pin-session.json';wrong_path.write_text(json.dumps(wrong))
      current_names=fresh.locator('#defined-calculations').inner_text();current_id=fresh.locator('#program-id').input_value()
      fresh.locator('#import-session').set_input_files(str(wrong_path));fresh.wait_for_timeout(500)
      check('wrong project pin rejects without changing active editor','Session rejected' in fresh.locator('#program-status').inner_text() and fresh.locator('#program-id').input_value()==current_id and fresh.locator('#defined-calculations').inner_text()==current_names,fresh.locator('#program-status').inner_text())
      cycle=dict(data);cycle['editor']={**data['editor'],'id':'shouldNotReplaceEditor'}
      baseDef={'version':1,'active':True,'inputSchema':{'type':'object','properties':{} }}
      cycle['hhSession']={'format':'hh-workbench-session','version':1,'definitions':[
        {**baseDef,'id':'cycleQA','plan':{'stages':[{'id':'callB','operation':'calculation.cycleQB@1','inputs':{}}]}},
        {**baseDef,'id':'cycleQB','plan':{'stages':[{'id':'callA','operation':'calculation.cycleQA@1','inputs':{}}]}},
      ]}
      cycle_path=OUT/'cyclic-session.json';cycle_path.write_text(json.dumps(cycle))
      current_names=fresh.locator('#defined-calculations').inner_text();current_id=fresh.locator('#program-id').input_value()
      fresh.locator('#import-session').set_input_files(str(cycle_path));fresh.wait_for_timeout(700)
      check('cyclic nested session rejects atomically','Session rejected' in fresh.locator('#program-status').inner_text() and fresh.locator('#program-id').input_value()==current_id and fresh.locator('#defined-calculations').inner_text()==current_names,fresh.locator('#program-status').inner_text())
      check('no uncaught browser errors',not errors,errors)
      report={'baseUrl':base,'checks':checks,'pageErrors':errors,'projectPin':data.get('projectPin'),'implementationPin':data.get('implementationPin'),'sessionFile':str(session_path)}
      (OUT/'session-browser-qa.json').write_text(json.dumps(report,indent=2))
      browser.close()
    server.shutdown();server.server_close()
    failed=[x for x in checks if not x['ok']]
    print(json.dumps({'passed':len(checks)-len(failed),'failed':len(failed),'result':str(OUT/'session-browser-qa.json')},indent=2))
    return 1 if failed else 0
if __name__=='__main__':sys.exit(main())
