#!/usr/bin/env python3
"""Run only independent HH contracts, with exact source/test hashes and retained output."""
import datetime,hashlib,json,os,pathlib,subprocess,sys

root=pathlib.Path(os.environ.get('HH_REPO_ROOT',pathlib.Path(__file__).resolve().parents[3]))
node=pathlib.Path(os.environ.get('HH_NODE',root.parent/'toolteam/inventory/runtime-cache/node-v24.19.0-linux-x64/bin/node'))
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
out=root/pathlib.Path(os.environ.get('HH_VERIFY_OUTPUT','outputs/homeroom-parity/implementation/verification'))/f'core-{stamp}'
out.mkdir(parents=True,exist_ok=False)
tests=sorted(root.glob('checkpoint/exp/cooperative/hh-parity*.test.mjs'))
def pins():
    files=list(root.glob('checkpoint/vendor/hh/src/*.mjs'))+list(root.glob('checkpoint/vendor/hh/services/*.mjs'))+tests
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}
before=pins();commands=[]
for path in tests:
    cmd=[str(node),'--test','--test-concurrency=2',str(path.relative_to(root))]
    with (out/(path.stem+'.txt')).open('wb') as log:
        result=subprocess.run(cmd,cwd=root,stdout=log,stderr=subprocess.STDOUT,timeout=60)
    commands.append({'test':str(path.relative_to(root)),'command':cmd,'exitCode':result.returncode,'log':str((out/(path.stem+'.txt')).relative_to(root))})
after=pins();receipt={'schema':'hh-independent-core.v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':str(node),'sourceHashes':before,'sourceStable':before==after,'commands':commands,'passed':before==after and all(c['exitCode']==0 for c in commands),'boundary':'Only independent authored offline/API contracts; no visual or production-service acceptance inferred.'}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'output':str(out),'sourceStable':receipt['sourceStable'],'passed':receipt['passed']}))
sys.exit(0 if receipt['passed'] else 1)
