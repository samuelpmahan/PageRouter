#!/usr/bin/env python3
"""Build equalviewport source-left/local-right pairs from one route-capture run."""
import argparse,os,pathlib,subprocess,sys,json
root=pathlib.Path(os.environ.get('HH_REPO_ROOT',pathlib.Path(__file__).resolve().parents[3]))
p=argparse.ArgumentParser();p.add_argument('run',type=pathlib.Path);p.add_argument('--receipt-name',default='pairs.json');p.add_argument('--routes',nargs='*',default=['home','directory','register','login','forgot','about','contact','partners','teacher-of-day-public-route','forum','forum-create','forum-post-missing','forum-post-detail']);args=p.parse_args()
run=args.run if args.run.is_absolute() else root/args.run
sources=root/'outputs/homeroom-parity/reference/screenshots';reference=root/'outputs/homeroom-parity/implementation/reference';output=run/'pairs';output.mkdir(exist_ok=True)
results=[]
for name in args.routes:
 for device,width in [('desktop',1440),('mobile',390)]:
  source=sources/f'{name}-{device}.png'
  if name=='teacher-of-day-public-route':source=reference/f'public-layout-batch/20261009-014944456Z/teacher-of-day-{device}.png'
  if name=='forum':source=reference/f'public-forum/screenshots/forum-forum-list-{device}.png'
  if name=='forum-create':source=reference/f'public-forum/screenshots/forum-create-post-{device}.png'
  if name=='forum-post-missing':source=reference/f'public-forum/screenshots/forum-post-detail-no-id-{device}.png'
  if name=='forum-post-detail':source=reference/f'public-forum/screenshots/forum-20261009-003159459-post-detail-{device}.png'
  if name in ('login','forgot'):
   source=reference/f'public-auth/20261009-014506389Z/{name}-desktop.png' if device=='desktop' else reference/f'public-auth/20261009-005654857Z/{name}-mobile.png'
  local=run/'screenshots'/f'{name}-{device}.png';dest=output/f'{name}-{device}-pair.png'
  if not source.exists() or not local.exists():results.append({'route':name,'device':device,'passed':False,'reason':'Missing screenshot','source':str(source),'local':str(local)});continue
  result=subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('pair_screenshots.py')),str(source),str(local),str(dest),'--width',str(width)],capture_output=True,text=True,timeout=30)
  results.append({'route':name,'device':device,'passed':result.returncode==0,'output':str(dest),'error':result.stderr[-2000:] if result.returncode else ''})
(output/args.receipt_name).write_text(json.dumps({'schema':'hh-route-pairs.v1','run':str(run),'checks':results,'visualVerdict':'pending opening and reviewing each combined image'},indent=2)+'\n')
print(json.dumps({'output':str(output),'pairs':sum(r['passed'] for r in results),'failures':[r for r in results if not r['passed']]}));sys.exit(0 if all(r['passed'] for r in results) else 1)
