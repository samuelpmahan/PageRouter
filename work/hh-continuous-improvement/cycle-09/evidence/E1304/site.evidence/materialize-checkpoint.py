#!/usr/bin/env python3
"""Materialize a content-addressed checkpoint only into a new empty directory."""
from pathlib import Path,PurePosixPath
import sys,json,hashlib,zipfile
archive=Path(sys.argv[1]);destination=Path(sys.argv[2]).resolve()
if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):raise SystemExit('Destination must be new or empty; existing work is never overlaid')
with zipfile.ZipFile(archive) as z:
 manifest=json.loads(z.read('CHECKPOINT-MANIFEST.json'));files=manifest['files'];seen=set();blobs={}
 for row in files:
  name=row['path'];p=PurePosixPath(name)
  if p.is_absolute() or '\\' in name or any(x in ('','.','..') for x in name.split('/')) or name in seen:raise SystemExit('Invalid checkpoint path')
  seen.add(name);digest=row['sha256'];data=blobs.get(digest)
  if data is None:data=z.read('blobs/'+digest);blobs[digest]=data
  if hashlib.sha256(data).hexdigest()!=digest or len(data)!=row['bytes']:raise SystemExit('Checkpoint bytes failed validation')
 destination.mkdir(parents=True,exist_ok=True)
 for row in files:
  p=destination/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(blobs[row['sha256']])
 print(json.dumps({'materialized':len(files),'destination':str(destination),'buildId':manifest['buildId'],'baseSourceCommit':manifest.get('baseSourceCommit'),'sourceCommit':manifest.get('sourceCommit')}))
