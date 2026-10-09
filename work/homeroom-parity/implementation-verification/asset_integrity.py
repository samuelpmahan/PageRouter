#!/usr/bin/env python3
"""Independently rehash provenance-listed local assets and their assembled copies."""
import datetime,hashlib,json,os,pathlib,sys
root=pathlib.Path(os.environ.get('HH_REPO_ROOT',pathlib.Path(__file__).resolve().parents[3])).resolve()
built_root=(root/os.environ.get('HH_BUILT_ROOT','checkpoint/dist/compiled/hh')).resolve()
manifest=root/'outputs/homeroom-parity/implementation/reference/asset-provenance.json'
data=json.loads(manifest.read_text());checks=[]
for item in data['assets']:
    if item.get('status')!=200:continue
    relative=item['path'].removeprefix('work/PageRouter/')
    if pathlib.Path(relative).is_absolute():
        # Historical reference capture used Windows-mounted path casing. Map only
        # an absolute path inside this exact repository, then use canonical root.
        prefix=str(root)+'/'
        if not relative.lower().startswith(prefix.lower()):raise ValueError('Absolute asset path outside repository')
        relative=relative[len(prefix):]
    source=(root/relative).resolve()
    if not source.is_relative_to(root/'checkpoint/vendor/hh/src/assets/reference'):raise ValueError('Asset manifest path escapes scoped reference tree')
    built=built_root/source.relative_to(root/'checkpoint/vendor/hh/src')
    def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    actual=digest(source);assembled=digest(built)
    checks.append({'source':str(source.relative_to(root)),'built':str(built),'expectedSha256':item['sha256'],'sourceSha256':actual,'builtSha256':assembled,'passed':actual==item['sha256'] and assembled==actual})
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
out=root/pathlib.Path(os.environ.get('HH_VERIFY_OUTPUT','outputs/homeroom-parity/implementation/verification'))
out.mkdir(parents=True,exist_ok=True);path=out/f'asset-integrity-{stamp}.json'
receipt={'schema':'hh-independent-assets.v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'builtRoot':str(built_root),'manifestSha256':hashlib.sha256(manifest.read_bytes()).hexdigest(),'checks':checks,'passed':bool(checks) and all(c['passed'] for c in checks),'boundary':'Byte identity only; font application, crop/layout and visible asset choice require browser and combined-image inspection.'}
path.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'output':str(path),'passed':receipt['passed'],'failures':[c['source'] for c in checks if not c['passed']]}));sys.exit(0 if receipt['passed'] else 1)
