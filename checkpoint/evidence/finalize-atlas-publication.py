"""Finalize existing deployment transport after root uploads the immutable source ZIP."""
from pathlib import Path
import argparse,hashlib,json,subprocess,sys

parser=argparse.ArgumentParser();parser.add_argument('--drive-file-id',required=True);parser.add_argument('--drive-url',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];prep=root.parent/'publication-prep';prep.mkdir(parents=True,exist_ok=True)
receipt=json.loads((root/'evidence/checkpoint-archive-receipt.json').read_text())
archive=Path(receipt['archive'])
if hashlib.sha256(archive.read_bytes()).hexdigest()!=receipt['archiveSha256']:raise ValueError('Source archive changed after checkpoint preparation')
catalog=json.loads((root/'dist/data/catalog.json').read_text());release=catalog['release']
if receipt['buildId']!=release['siteBuildId']:raise ValueError('Source checkpoint and compiled build differ')
if args.drive_url.split('/file/d/')[-1].split('/')[0]!=args.drive_file_id:raise ValueError('Drive URL/file ID mismatch')
baseline='9652352557bdcbbbce888ce87f7ffbd36da9bad6'
subprocess.run([sys.executable,str(root/'scripts/prepare-publication.py'),'--source-checkpoint',args.drive_url,'--baseline-commit',baseline],check=True)
out=root/'publication'/('connect4-gameboy-'+release['siteBuildId'][:12])
meta=json.loads((out/'artifact.json').read_text());meta.update(sourceArchiveSha256=receipt['archiveSha256'],baseSourceCommit=receipt['baseSourceCommit'],atlasImplementationPin=release['atlasIdentity']['digest']);(out/'artifact.json').write_text(json.dumps(meta,indent=2)+'\n')
checkpoint={'schema':'composed-workbench-source-checkpoint@2','version':release['version'],'channel':release['channel'],'siteBuildId':release['siteBuildId'],'evaluatorImplementationPin':release['buildId'],'atlasImplementationPin':release['atlasIdentity']['digest'],'driveFileId':args.drive_file_id,'driveUrl':args.drive_url,'archiveSha256':receipt['archiveSha256'],'archiveBytes':receipt['archiveBytes'],'baseSourceCommit':receipt['baseSourceCommit'],'baseCheckpointBuildId':receipt['baseCheckpointBuildId'],'baselinePublicationCommit':baseline,'sourceAuthority':'Full modified materialized canonical checkpoint tree; this compiled-only GitHub transport is not source authority','note':'Executable parse/validate/interpret/execute capability ladder over the existing Atlas language; staged Parts, composed parent, literal definitions and replay/cache evidence. Existing finite-grid search and six-node motion/Beta/Boolean composition retained. Candidate 0.0.0; no human acceptance asserted.'}
(out/'SOURCE-CHECKPOINT.json').write_text(json.dumps(checkpoint,indent=2)+'\n')
(out/'README.md').write_text(f"""# PageRouter × PxCube Composed Workbench

Candidate {release['version']} · site build {release['siteBuildId']}

PxCube's Atlas tab (`#/pxcube/atlas`) offers independently callable Parse, Validate, Interpret and Execute capabilities and a composed Run ladder action over an editable literal definition. Each rung and the composed parent retain actual Part inputs, producers and kernel evidence; replay reports domain bodies and cache hits separately. JSON definition, result Part and inspection downloads remain inert evidence. The original bounded search and motion/Beta/Boolean composition controls remain available. Nothing runs on mount.

The existing PxCube/Game Boy, HH style import repair and Justin IDE compiled subtrees retain their exact hashes. HH evaluator implementation: {release['buildId']}. Atlas implementation: {release['atlasIdentity']['digest']}.

Authoritative immutable source checkpoint: {args.drive_url}
Source archive SHA-256: {receipt['archiveSha256']}
Base source commit: {receipt['baseSourceCommit']}. No new source Git commit is claimed.

Local checks and build evidence are included in the checkpoint. Acceptance applies to the declared grid and tolerance; the Boolean/Beta fixture policy does not establish equivalence. Candidate 0.0.0 is not a human contract milestone.
""")
names=[*meta['parts'],'artifact.json','SOURCE-CHECKPOINT.json','README.md']
files=[{'path':name,'localPath':str(out/name),'bytes':(out/name).stat().st_size,'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest()} for name in names]
plan={'schema':'bounded-github-publication-plan@1','repository':'samuelpmahan/PageRouter','branch':'main','expected_sha':baseline,'base_tree_sha':'63c371780f395802fb5e119b67ddc8ce8cc0ef3e','force':False,'message':'Integrate executable Atlas capability ladder into PxCube workbench','files':files,'preserve':{'.github/workflows/deploy-pages.yml':'4d8e0b8b3256c569464900e3b192f599e8563c86','deploy-materialize.py':'01d7b9c691f8ded9d0235f4d615f39fe0a6a936f'},'buildId':release['siteBuildId'],'sourceArchiveSha256':receipt['archiveSha256']}
(prep/'publish-plan.json').write_text(json.dumps(plan,indent=2)+'\n');print(json.dumps({'plan':str(prep/'publish-plan.json'),'directory':str(out),'buildId':release['siteBuildId']}))
