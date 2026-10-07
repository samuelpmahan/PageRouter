#!/usr/bin/env python3
"""Safe ZIP snapshot mode; legacy positional root_sync commands pass through."""
import argparse, hashlib, json, os, stat, subprocess, sys, time, uuid, zipfile
from pathlib import Path, PurePosixPath

HERE=Path(__file__).resolve().parent
STAGE=HERE.parent/'stage'
DEFAULT_QUEUE=HERE/'queue'
DEFAULT_SOURCE=HERE.parent/'stage'
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1<<20),b''): h.update(b)
 return h.hexdigest()
def tree(src):
 out={}
 for p in sorted(src.rglob('*')):
  st=p.lstat()
  if stat.S_ISLNK(st.st_mode): raise RuntimeError(f'symlink rejected: {p}')
  if stat.S_ISDIR(st.st_mode): continue
  if not stat.S_ISREG(st.st_mode): raise RuntimeError(f'nonregular filesystem entry rejected: {p}')
  out[p.relative_to(src).as_posix()]={'sha256':sha(p),'size':st.st_size,'mode':stat.S_IMODE(st.st_mode)}
 return out
def call(queue,op,folder,timeout=240,**data):
 queue=Path(queue); queue.mkdir(parents=True,exist_ok=True); logs=queue/'logs'; logs.mkdir(exist_ok=True)
 i=1
 while True:
  rid=f'{i:03}'; req=queue/f'{rid}-request.json'; res=queue/f'{rid}-response.json'
  try:
   with req.open('x') as f: f.write(json.dumps({'id':rid,'operation':op,'folder':folder,**data},indent=2)+'\n')
   break
  except FileExistsError: i+=1
 print(f'PENDING {req}',flush=True); deadline=time.monotonic()+min(300,timeout)
 while time.monotonic()<deadline:
  if res.is_file():
   r=json.loads(res.read_text())
   if r.get('id')!=rid or not isinstance(r.get('rc'),int) or not isinstance(r.get('stdout'),str) or not isinstance(r.get('stderr'),str): raise RuntimeError(f'invalid response: {res}')
   (logs/req.name).write_text(req.read_text()); (logs/res.name).write_text(res.read_text())
   if r['rc']: raise RuntimeError(r.get('stderr') or r.get('stdout') or f'{op} failed')
   if op=='upload' and not isinstance(r.get('remoteId'),str): raise RuntimeError(f'upload response omitted remoteId: {res}')
   return r
  time.sleep(.25)
 raise TimeoutError(f'timed out waiting for {res}')
def manifest_sha(files):
 return hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def extract_checked(archive,fresh):
 fresh.mkdir()
 with zipfile.ZipFile(archive) as z:
  seen=set()
  for info in z.infolist():
   name=info.filename.replace('\\','/'); q=PurePosixPath(name); mode=info.external_attr>>16
   if q.is_absolute() or '..' in q.parts or (q.parts and q.parts[0].endswith(':')) or stat.S_ISLNK(mode): raise RuntimeError(f'unsafe zip member: {name}')
   key=name.rstrip('/')
   if key in seen: raise RuntimeError(f'duplicate zip member: {name}')
   seen.add(key)
  z.extractall(fresh)
  for info in z.infolist():
   name=info.filename.replace('\\','/'); dest=fresh.joinpath(*PurePosixPath(name).parts); mode=(info.external_attr>>16)&0o777
   if mode and dest.is_file(): os.chmod(dest,mode)
 return tree(fresh)
def pull_id():
 ap=argparse.ArgumentParser(description='Pull one exact remote recipe ID to a new verified execution tree')
 ap.add_argument('--pull-id',required=True); ap.add_argument('--sha256',required=True); ap.add_argument('--manifest-sha',required=True)
 ap.add_argument('--file-count',required=True,type=int); ap.add_argument('--folder',required=True); ap.add_argument('--run-dir',required=True); ap.add_argument('--queue')
 a=ap.parse_args()
 if len(a.sha256)!=64 or len(a.manifest_sha)!=64 or a.file_count<1: raise RuntimeError('invalid expected identities')
 run=Path(a.run_dir).absolute()
 if run.exists(): raise RuntimeError('run-dir must be new')
 queue=Path(a.queue).absolute() if a.queue else run/'queue'
 run.mkdir(parents=True)
 pulled=run/'repulled-stage-snapshot.zip'
 call(queue,'download',a.folder,remoteId=a.pull_id,destination=str(pulled),expectedSha256=a.sha256,purpose='fresh-recipe-pull')
 if not pulled.is_file() or sha(pulled)!=a.sha256: raise RuntimeError('remote recipe SHA-256 mismatch')
 fresh=run/'fresh'; files=extract_checked(pulled,fresh)
 if len(files)!=a.file_count or manifest_sha(files)!=a.manifest_sha: raise RuntimeError('fresh remote manifest mismatch')
 rec={'schema':'root-sync-zip-checkpoint@1','folder':a.folder,'remoteFileId':a.pull_id,'queue':str(queue),'sourceDirectory':None,
      'sourceFileCount':len(files),'sourceManifestSha256':manifest_sha(files),
      'archive':str(pulled),'archiveSha256':a.sha256,'repulledArchive':str(pulled),'repulledSha256':sha(pulled),
      'freshExtraction':str(fresh),'roundTripVerified':True,'pullOnly':True}
 rp=run/'checkpoint-receipt.json'; rp.write_text(json.dumps(rec,indent=2)+'\n'); print(json.dumps(rec,indent=2)); return 0
def main():
 if '--pull-id' in sys.argv[1:]: return pull_id()
 if '--push' not in sys.argv[1:]: return subprocess.call([sys.executable,str(HERE/'root_sync_legacy.py'),*sys.argv[1:]])
 ap=argparse.ArgumentParser(description='ZIP-only safe root_sync push: upload, exact-ID repull, SHA verify')
 ap.add_argument('--push',action='store_true'); ap.add_argument('--dir',required=True); ap.add_argument('--folder',required=True)
 ap.add_argument('--run-dir'); ap.add_argument('--queue'); a=ap.parse_args()
 raw=Path(a.dir).absolute()
 if raw.is_symlink() or not raw.is_dir() or not a.folder.strip(): raise RuntimeError('source must be a real directory and folder nonempty')
 src=raw.resolve(); before=tree(src); run=Path(a.run_dir).absolute() if a.run_dir else src.parent/'root-sync-checkpoints'/('run-'+uuid.uuid4().hex[:12])
 if run.exists() or run.resolve().is_relative_to(src): raise RuntimeError('run-dir must be new and outside source')
 queue=Path(a.queue).absolute() if a.queue else run/'queue'
 if queue.resolve().is_relative_to(src): raise RuntimeError('queue must be outside source')
 run.mkdir(parents=True); archive=run/'stage-snapshot.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for p in sorted(src.rglob('*')):
   if p.is_symlink(): raise RuntimeError(f'symlink rejected during snapshot: {p}')
   st=p.lstat()
   if stat.S_ISDIR(st.st_mode): z.writestr(p.relative_to(src).as_posix().rstrip('/')+'/', '')
   elif stat.S_ISREG(st.st_mode): z.write(p,p.relative_to(src).as_posix())
   else: raise RuntimeError(f'nonregular filesystem entry rejected: {p}')
 digest=sha(archive)
 if tree(src)!=before: raise RuntimeError('source changed during archive creation')
 up=call(queue,'upload',a.folder,name=archive.name,local=str(archive),size=archive.stat().st_size,sha256=digest,purpose='checkpoint-archive')
 fileid=up.get('remoteId')
 if not fileid: raise RuntimeError('upload response omitted remoteId')
 pulled=run/'repulled-stage-snapshot.zip'
 call(queue,'download',a.folder,remoteId=fileid,destination=str(pulled),expectedSha256=digest,purpose='checkpoint-archive')
 if not pulled.is_file() or sha(pulled)!=digest: raise RuntimeError('repulled archive SHA-256 mismatch')
 if tree(src)!=before: raise RuntimeError('source changed during round trip')
 fresh=run/'fresh'; extracted=extract_checked(pulled,fresh)
 if tree(src)!=before: raise RuntimeError('source changed during extraction')
 if extracted!=before: raise RuntimeError('fresh extraction differs from source file manifest')
 rec={'schema':'root-sync-zip-checkpoint@1','folder':a.folder,'remoteFileId':fileid,'queue':str(queue),'sourceDirectory':str(src),
      'sourceFileCount':len(before),'sourceManifestSha256':manifest_sha(before),
      'archive':str(archive),'archiveSha256':digest,'repulledArchive':str(pulled),'repulledSha256':sha(pulled),
      'freshExtraction':str(fresh),'roundTripVerified':True}
 rp=run/'checkpoint-receipt.json'; rp.write_text(json.dumps(rec,indent=2)+'\n'); print(json.dumps(rec,indent=2)); return 0
if __name__=='__main__':
 try: raise SystemExit(main())
 except Exception as e: print(f'root_sync ZIP operation failed: {e}',file=sys.stderr); raise SystemExit(2)
