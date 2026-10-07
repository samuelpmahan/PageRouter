#!/usr/bin/env python3
"""Run LocalCI's test phase only against a root_sync fresh-pull receipt."""
import argparse, datetime, hashlib, json, subprocess, sys
from pathlib import Path
from root_sync import call, DEFAULT_QUEUE, tree

def main():
 ap=argparse.ArgumentParser(description='Test the exact fresh extraction named by root_sync')
 ap.add_argument('--receipt',required=True); ap.add_argument('--test-cmd',required=True)
 ap.add_argument('--folder',required=True); ap.add_argument('--queue'); ap.add_argument('--timeout',type=int,default=1800)
 a=ap.parse_args(); rp=Path(a.receipt).resolve(); receipt=json.loads(rp.read_text())
 if receipt.get('schema')!='root-sync-zip-checkpoint@1' or not receipt.get('roundTripVerified') or receipt.get('folder')!=a.folder: raise RuntimeError('invalid/mismatched root_sync receipt')
 archive=Path(receipt['repulledArchive']).resolve(); fresh=Path(receipt['freshExtraction']).resolve()
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=receipt['archiveSha256'] or not fresh.is_dir(): raise RuntimeError('fresh archive hash/extraction check failed')
 if not fresh.is_relative_to(rp.parent.resolve()): raise RuntimeError('fresh extraction escaped checkpoint directory')
 manifest=tree(fresh)
 manifest_sha=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 if manifest_sha!=receipt.get('sourceManifestSha256') or len(manifest)!=receipt.get('sourceFileCount'): raise RuntimeError('fresh extracted file manifest differs from the checkpoint source manifest')
 p=subprocess.run(['/bin/bash','-c',a.test_cmd],cwd=fresh,capture_output=True,text=True,timeout=a.timeout)
 verdict='PASS' if p.returncode==0 else 'FAIL'; stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 proof={'tool':'localci-zip','finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'folder':a.folder,
  'checkpointReceipt':str(rp),'remoteArchiveId':receipt['remoteFileId'],'archiveSha256':receipt['archiveSha256'],
  'freshExtraction':str(fresh),'testCommand':a.test_cmd,'testCwd':str(fresh),'exitCode':p.returncode,'verdict':verdict,
  'stdout':p.stdout,'stderr':p.stderr,'stdoutTail':p.stdout[-4000:],'stderrTail':p.stderr[-4000:]}
 j=rp.parent/f'localci-proof-{stamp}.json'; m=rp.parent/f'localci-proof-{stamp}.md'
 j.write_text(json.dumps(proof,indent=2)+'\n')
 m.write_text(f"# LocalCI ZIP proof: {verdict}\n\n- Checkpoint: `{rp}`\n- Drive archive: `{receipt['remoteFileId']}`\n- SHA-256: `{receipt['archiveSha256']}`\n- Fresh test root: `{fresh}`\n- Command: `{a.test_cmd}`\n- Exit: {p.returncode}\n\n## Output\n\n```\n{p.stdout[-4000:]}\n{p.stderr[-4000:]}\n```\n")
 queue=a.queue or receipt.get('queue') or str(DEFAULT_QUEUE)
 for f in (j,m):
  d=hashlib.sha256(f.read_bytes()).hexdigest()
  r=call(queue,'upload',a.folder,name=f.name,local=str(f),size=f.stat().st_size,sha256=d,purpose='localci-proof')
  print(f"proof uploaded: {f.name} {r.get('remoteId','')}",flush=True)
 print(f"LocalCI {verdict}; proof files: {j} {m}",flush=True)
 return 0 if verdict=='PASS' else 1

if __name__=='__main__':
 try: raise SystemExit(main())
 except Exception as e: print(f'LocalCI ZIP test failed: {e}',file=sys.stderr); raise SystemExit(2)
