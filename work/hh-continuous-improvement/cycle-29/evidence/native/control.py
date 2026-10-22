"""Coordinator dispatch bookkeeping; native assignment stays in pinned probe.py."""
import importlib.util,json,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('native_probe','/workspace/scratch/86659bbafcce/rebalancer-source/experiments/rebalancer/probe.py')
p=importlib.util.module_from_spec(sp);sp.loader.exec_module(p)
a=sys.argv[1]; state=ROOT/'state.json'
if a=='init': result=p.init(ROOT/'spec.json',state)
elif a=='solve': result=p.solve(state,ROOT/'solves')
elif a=='start': result=p.start(state,sys.argv[2],sys.argv[3],'/root/hh29_'+sys.argv[2].lower())
elif a=='finish':
 w,filename=sys.argv[2:4];s=p.load_state(state);j=s['jobs'][s['workers'][w]['job']]
 data=p.read_json(pathlib.Path(filename));p.validate_receipt(data,j,w)
 d=ROOT/'receipts';d.mkdir(exist_ok=True)
 with (d/(j['id']+'.json')).open('xb') as f:f.write(pathlib.Path(filename).read_bytes())
 result=p.finish(state,d,w)
elif a=='admit':
 e=p.read_json(pathlib.Path(sys.argv[2]));s=p.load_state(state)
 assert e['id'] not in s['jobs']
 e.update(status='pending',worker=None,started_at=None,finished_at=None)
 if e['kind']=='review':assert s['jobs'][e['depends_on']]['status']=='done'
 s['jobs'][e['id']]=e;s['events'].append({'type':'coordinator_guard_admission','at':p.now(),'job':e['id'],'guard':e['guard']})
 p.write_json(state,s);result={'admitted':e['id']}
else:raise ValueError(a)
print(json.dumps(result,indent=2))
