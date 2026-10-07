from pathlib import Path
import json, hashlib, zipfile, datetime, os, argparse, re, io
parser=argparse.ArgumentParser();parser.add_argument('--baseline-commit',required=True);parser.add_argument('--base-source-commit',required=True);parser.add_argument('--base-checkpoint',required=True);args=parser.parse_args()
if not re.fullmatch('[0-9a-f]{40}',args.baseline_commit) or not re.fullmatch('[0-9a-f]{40}',args.base_source_commit) or not re.fullmatch('[0-9a-f]{64}',args.base_checkpoint):raise ValueError('Exact verified baseline commit, base source commit and checkpoint digest required')
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text())['version']
build=json.loads((root/'dist/data/catalog.json').read_text())['release'].get('siteBuildId',json.loads((root/'dist/data/catalog.json').read_text())['release']['buildId'])
selected=[]
for name in ['src','scripts','vendor','sources/pxcube','exp/cooperative','exp/adversarial','exp/atlas','evidence','dist','.github','package.json','package-lock.json','README.md','.gitignore','publication/deploy-materialize.py']:
 p=root/name
 selected.extend([p] if p.is_file() else p.rglob('*'))
files=[]
for p in selected:
 if p.is_symlink():raise ValueError('Checkpoint symlinks are prohibited')
 if not p.is_file():continue
 rel=p.relative_to(root).as_posix()
 if rel.startswith('evidence/atlas-browser/'):continue
 if '__pycache__' in p.parts or rel.endswith('.pyc') or rel.startswith('evidence/publication-') or '/.pxcube/' in rel:continue
 if rel.startswith('sources/pxcube/'):
  if rel.startswith('sources/pxcube/vendor/neat/dist/'):continue
  parts=set(p.relative_to(root/'sources/pxcube').parts)
  if parts.intersection({'.pxcube','.crisp','node_modules','__pycache__'}):continue
  if len(p.relative_to(root/'sources/pxcube').parts)>2 and p.relative_to(root/'sources/pxcube').parts[:1]==('experiences',) and 'dist' in parts:continue
 if rel.startswith('evidence/checkpoint-') or rel.startswith('evidence/composed-workbench-checkpoint-'):continue
 files.append(p)
records=[{'path':p.relative_to(root).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(set(files))]
manifest={'schema':'composed-workbench-checkpoint@2','version':version,'channel':'candidate','buildId':build,'createdAt':os.environ.get('SOURCE_CHECKPOINT_UTC',datetime.datetime.now(datetime.timezone.utc).isoformat()),'baselinePublicationCommit':args.baseline_commit,'baseSourceCommit':args.base_source_commit,'baseCheckpointBuildId':args.base_checkpoint,'sourceAttribution':'Modified materialized canonical checkpoint tree; no new source Git commit is claimed','files':records,'boundaries':['Candidate, not an accepted contract milestone','Bounded Atlas capability ladder, finite fixture search and original motion/Beta/Boolean composition; user-defined contract meaning remains unspecified','Original neat/tidy/crisp lifecycle remains authority','Atlas acceptance is finite grid/tolerance agreement, not a theorem or global minimum','Published live candidate still requires post-deployment browser verification']}
(root/'evidence/checkpoint-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
name='composed-workbench-checkpoint-'+build[:12]+'.zip';out=root/'evidence'/name
bundle=io.BytesIO()
with zipfile.ZipFile(bundle,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 blobs={}
 for p in sorted(set(files)):
  data=p.read_bytes();digest=hashlib.sha256(data).hexdigest();blobs.setdefault(digest,data)
 for digest,data in blobs.items():z.writestr('blobs/'+digest,data)
 z.writestr('CHECKPOINT-MANIFEST.json',json.dumps(manifest,indent=2)+'\n')
 z.write(root/'evidence/materialize-checkpoint.py','materialize-checkpoint.py')
 z.writestr('READ-FIRST.txt','Verify the archive SHA-256 before use. This checkpoint contains deduplicated exact source/output/proof bytes. Materialize only into a new empty directory:\npython3 materialize-checkpoint.py ARCHIVE.zip NEW-DIRECTORY\nThen follow README.md. Existing work is never overlaid. Candidate0.0.0; no contract milestone/human acceptance asserted.\n')
out.write_bytes(bundle.getvalue())
with zipfile.ZipFile(out) as verified:
 if verified.testzip() is not None or json.loads(verified.read('CHECKPOINT-MANIFEST.json'))!=manifest:raise ValueError('Checkpoint ZIP roundtrip failed')

receipt={'archive':str(out),'archiveBytes':out.stat().st_size,'archiveSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'buildId':build,'fileCount':len(records),'baselinePublicationCommit':args.baseline_commit,'baseSourceCommit':args.base_source_commit,'baseCheckpointBuildId':args.base_checkpoint}
(root/'evidence/checkpoint-archive-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
