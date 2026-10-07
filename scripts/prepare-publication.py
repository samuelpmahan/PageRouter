"""Package exact compiled bytes for the existing PageRouter deployment transport."""
from pathlib import Path
import hashlib,json,zipfile,argparse,re,io
p=argparse.ArgumentParser();p.add_argument('--source-checkpoint',required=True);p.add_argument('--baseline-commit',required=True);a=p.parse_args()
if not re.fullmatch(r'[0-9a-f]{40}',a.baseline_commit):raise ValueError('--baseline-commit must be a verified 40-character commit SHA')
root=Path(__file__).resolve().parents[1];catalog=json.loads((root/'dist/data/catalog.json').read_text());build=catalog['release'].get('siteBuildId',catalog['release']['buildId']);out=root/'publication'/('connect4-gameboy-'+build[:12]);out.mkdir(parents=True,exist_ok=False)
records=[];blobs={}
for f in sorted((root/'dist').rglob('*')):
 if f.is_symlink():raise ValueError('No symlinks in compiled artifact')
 if not f.is_file():continue
 data=f.read_bytes();sha=hashlib.sha256(data).hexdigest();records.append({'path':f.relative_to(root/'dist').as_posix(),'bytes':len(data),'sha256':sha});blobs.setdefault(sha,data)
manifest={'schema':'compiled-file-manifest@1','siteBuildId':build,'files':records}
def entry(z,name,data):
 info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,data,compresslevel=9)
archive=out/'compiled-artifact.zip'
bundle=io.BytesIO()
with zipfile.ZipFile(bundle,'w') as z:
 for sha,data in sorted(blobs.items()):entry(z,'blobs/'+sha,data)
 entry(z,'MANIFEST.json',json.dumps(manifest,sort_keys=True,separators=(',',':')).encode())
archive.write_bytes(bundle.getvalue())
with zipfile.ZipFile(archive) as verified:
 if verified.testzip() is not None or json.loads(verified.read('MANIFEST.json'))!=manifest:raise ValueError('Compiled ZIP roundtrip failed')
data=archive.read_bytes();parts=[]
for i,start in enumerate(range(0,len(data),4*1024*1024)):
 name=f'compiled-artifact.part{i:03d}';(out/name).write_bytes(data[start:start+4*1024*1024]);parts.append(name)
meta={'schema':'composed-workbench-deployment-artifact@1','buildId':build,'evaluatorImplementationPin':catalog['release']['buildId'],'archiveSha256':hashlib.sha256(data).hexdigest(),'archiveBytes':len(data),'parts':parts,'files':len(records),'sourceCheckpoint':a.source_checkpoint,'baselineCommit':a.baseline_commit}
(out/'artifact.json').write_text(json.dumps(meta,indent=2)+'\n');(out/'deploy-materialize.py').write_bytes((root/'publication/deploy-materialize.py').read_bytes());print(json.dumps({'directory':str(out),**meta}))
