"""Bind the successor's retained verification receipts to the files now present.

This checks evidence freshness and declared acceptance conditions. It does not
rerun the tests or turn finite observations into a universal correctness proof.
"""
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def read(name):
    return json.loads((BASE / name).read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check():
    rows = []
    def retain(name, passed, sources, root=BASE, note=''):
        differences = [path for path, expected in sources.items()
                       if not (root / path).is_file() or digest(root / path) != expected]
        rows.append(dict(artifact=name, artifactSha256=digest(BASE/name),
            status='PASS' if passed and not differences else 'FAIL',
            declaredChecksPassed=bool(passed), staleSources=differences,
            checkedSourceCount=len(sources), note=note))

    for name in ['frontier-unit-verification.json', 'frontier-machine-verification.json',
                 'checkpoint-regression.json', 'lanes/devices/device-summary.json',
                 'lanes/devices/generated-checks.json']:
        d = read(name); retain(name, d['status']=='PASS', d['sourceSha256'])
    name = 'frontier-generated-checks.json'; d=read(name)
    retain(name, d['status']=='PASS' and d['mutation']['failed'],
           {**d['finalPythonSources'], 'generated-checks.mjs':d['sourceSha256']})
    name = 'lanes/composition/evidence.json'; d=read(name)
    retain(name, d['summary']['status']=='PASS', d['sources'])
    name = 'lanes/composition/library-evidence.json'; d=read(name)
    retain(name, d['summary']['status']=='PASS' and d['verification']['exitCode']==0,
           {**d['sourceProvenance']['files'],
            'lanes/composition/test_library.py':d['verification']['testSourceSha256']})
    name = 'lanes/explanation/verification.json'; d=read(name)
    retain(name, d['status']=='PASS', {p:h for p,h in d['sourceSha256'].items() if p.endswith('.py')},
           note='Python test dependencies checked here; final presentation is checked against its separate browser receipt below.')
    name = 'lanes/explanation/report.json'; d=read(name)
    retain(name, {c['id']:c['diagnosis']['status'] for c in d['cases']} ==
           {'clean':'PASS','wrong-value':'FAIL','wrong-origin':'FAIL','missing-evidence':'UNVERIFIED'}, d['sourceSha256'])
    for name, viewer in [('viewer-browser-checks.json','viewer.html'),
                         ('lanes/explanation/browser-verification.json','lanes/explanation/viewer.html')]:
        d=read(name); retain(name,d['status']=='PASS',{viewer:d['sourceSha256']})
    name = 'verification/js/verification.json'; d=read(name)
    retain(name, d['status']=='PASS' and d['totalLoss']==0 and all(m['loss']>0 for m in d['mutations']), d['sourcesAfter'])
    name = 'extensions/optimization/receipt.json'; d=read(name)
    retain(name, d['status']=='PASS' and d['totalLoss']==0 and d['unsafeMerge']['comparisonLoss']>0,
           d['sourceSha256'], root=BASE.parent)
    name = 'optimization-browser-checks.json'; d=read(name)
    retain(name, d['status']=='PASS',d['sourceSha256'])
    checkpoint = BASE.parent/'pxc-checkpoints/001'
    predecessor= json.loads((checkpoint/'manifest.json').read_text())
    changed=[p for p,h in predecessor['files'].items() if digest(checkpoint/p)!=h]
    return dict(schema='pxc-successor-evidence/v1',
        status='PASS' if not changed and all(r['status']=='PASS' for r in rows) else 'FAIL',
        receipts=rows, changedCheckpoint001Files=changed,
        checkerSha256=digest(Path(__file__)),
        scope='Source freshness, unchanged predecessor, and explicit acceptance of retained finite evidence. Tests were executed by the named runners; this collection does not rerun them.')


if __name__=='__main__':
    result=check()
    (BASE/'successor-verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
    raise SystemExit(result['status']!='PASS')
