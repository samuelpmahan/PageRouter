"""Coordinator bookkeeping only; delegates native assignment to pinned probe.py."""
import importlib.util
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('native_probe', '/workspace/scratch/86659bbafcce/rebalancer-source/experiments/rebalancer/probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
action = sys.argv[1]
state = ROOT / 'state.json'
if action == 'init':
    result = probe.init(ROOT / 'spec.json', state)
elif action == 'solve':
    result = probe.solve(state, ROOT / 'solves')
elif action == 'start':
    worker, job = sys.argv[2:4]
    result = probe.start(state, worker, job, f'/root/hh28_{worker.lower()}')
elif action == 'finish':
    worker, filename = sys.argv[2:4]
    current = probe.load_state(state)
    job = current['jobs'][current['workers'][worker]['job']]
    source = pathlib.Path(filename)
    data = probe.read_json(source)
    probe.validate_receipt(data, job, worker)
    receipts = ROOT / 'receipts'
    receipts.mkdir(exist_ok=True)
    dest = receipts / (job['id'] + '.json')
    with dest.open('xb') as output:
        output.write(source.read_bytes())
    result = probe.finish(state, receipts, worker)
elif action == 'admit':
    entry = probe.read_json(pathlib.Path(sys.argv[2]))
    current = probe.load_state(state)
    assert entry['id'] not in current['jobs']
    assert entry['kind'] in ('extract', 'review')
    entry.update(status='pending', worker=None, started_at=None, finished_at=None)
    if entry['kind'] == 'review':
        assert current['jobs'][entry['depends_on']]['status'] == 'done'
    current['jobs'][entry['id']] = entry
    current['events'].append({'type':'coordinator_guard_admission','at':probe.now(),'job':entry['id'],'guard':entry['guard']})
    probe.write_json(state, current)
    result = {'admitted':entry['id']}
else:
    raise ValueError(action)
print(json.dumps(result, indent=2))
