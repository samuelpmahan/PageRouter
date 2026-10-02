from pathlib import Path,PurePosixPath
import zipfile,json,hashlib
root=Path(__file__).resolve().parent
meta=json.loads((root/'artifact.json').read_text())
bundle=b''.join((root/name).read_bytes() for name in meta['parts'])
if hashlib.sha256(bundle).hexdigest()!=meta['archiveSha256']:raise SystemExit('Compiled archive hash mismatch')
from io import BytesIO
with zipfile.ZipFile(BytesIO(bundle)) as z:
 manifest=json.loads(z.read('MANIFEST.json'));validated=[];seen=set();blobs={}
 for file in manifest['files']:
  p=file['path'];rel=PurePosixPath(p)
  if rel.is_absolute() or '\\' in p or p in seen or any(c in ('','.','..') for c in p.split('/')):raise SystemExit('Invalid compiled path')
  seen.add(p);sha=file['sha256'];data=blobs.get(sha)
  if data is None:data=z.read('blobs/'+sha);blobs[sha]=data
  if len(data)!=file['bytes'] or hashlib.sha256(data).hexdigest()!=sha:raise SystemExit('Compiled file hash mismatch')
  validated.append((p,data))
 out=root/'_site'
 if out.exists():raise SystemExit('Fresh deployment output required')
 out.mkdir()
 for p,data in validated:
  file=out/p;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
 print(json.dumps({'buildId':meta['buildId'],'files':len(validated),'archiveSha256':meta['archiveSha256']}))
