"""Reviewed bounded connector publisher. Does nothing remotely without --execute."""
from pathlib import Path
import argparse,base64,hashlib,json,sys,re
parser=argparse.ArgumentParser();parser.add_argument('--plan',required=True);parser.add_argument('--connector-id',required=True);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
plan_path=Path(args.plan);plan=json.loads(plan_path.read_text())
if plan['repository']!='samuelpmahan/PageRouter' or plan['branch']!='main' or plan['force'] is not False or plan['expected_sha']!='9652352557bdcbbbce888ce87f7ffbd36da9bad6':raise ValueError('Plan exceeds reviewed route/lease')
if plan['base_tree_sha']!='63c371780f395802fb5e119b67ddc8ce8cc0ef3e':raise ValueError('Plan changes the reviewed baseline tree')
seen=set()
for row in plan['files']:
 if row['path'] in seen or not (row['path'] in {'artifact.json','SOURCE-CHECKPOINT.json','README.md'} or re.fullmatch(r'compiled-artifact\.part[0-9]{3}',row['path'])):raise ValueError('Plan changes an unapproved publication path')
 seen.add(row['path'])
 data=Path(row['localPath']).read_bytes()
 if len(data)!=row['bytes'] or hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError('Publication payload changed: '+row['path'])
if not args.execute:
 print(json.dumps({'ready':True,'files':len(plan['files']),'expected_sha':plan['expected_sha'],'force':False,'remoteMutation':False}));sys.exit(0)
sys.path.insert(0,'/root/.codex/plugins/cache/openai-curated-remote/openai-library/0.1.61/skills/library/scripts')
from library_hosted_apps import HostedAppsClient
client=HostedAppsClient();receipt={'files':[],'expected_sha':plan['expected_sha']}
def unwrap(result,allow_ack=False):
 if allow_ack:
  # Acknowledgements may be plain text or empty successful envelopes.
  # Check explicit tool errors before trusting the subsequent independent read.
  pending=[result]
  while pending:
   item=pending.pop()
   if isinstance(item,str):
    try:pending.append(json.loads(item))
    except (ValueError,TypeError):pass
   elif isinstance(item,dict):
    if item.get('isError') is True:raise ValueError('Connector rejected the action: '+json.dumps(item))
    pending.extend(item[key] for key in ('structuredContent','content') if key in item)
   elif isinstance(item,list):pending.extend(item)
  return result
 value=result
 for _ in range(10):
  if isinstance(value,str):value=json.loads(value);continue
  if isinstance(value,dict) and value.get('isError') is True:raise ValueError('Connector rejected the action: '+json.dumps(value))
  if isinstance(value,dict) and 'sha' in value:return value
  if isinstance(value,dict) and 'object' in value:return value
  if isinstance(value,dict) and isinstance(value.get('tree'),list):return value
  if isinstance(value,dict) and isinstance(value.get('structuredContent'),dict):value=value['structuredContent'];continue
  if isinstance(value,dict) and isinstance(value.get('content'),str):value=json.loads(value['content']);continue
  if isinstance(value,dict) and isinstance(value.get('content'),list):
   texts=[item.get('text') for item in value['content'] if isinstance(item,dict) and item.get('type')=='text']
   if len(texts)!=1:raise ValueError('Connector returned ambiguous text response')
   value=json.loads(texts[0]);continue
  break
 raise ValueError('Connector returned unexpected shape')
def call(name,arguments,allow_ack=False):return unwrap(client.call_tool(args.connector_id,name,arguments),allow_ack=allow_ack)
head=call('fetch',{'url':'https://api.github.com/repos/samuelpmahan/PageRouter/git/ref/heads/main'})
if head['object']['sha']!=plan['expected_sha']:raise ValueError('Main changed; inspect new head before making publication objects')
preserved=call('fetch',{'url':'https://api.github.com/repos/samuelpmahan/PageRouter/git/trees/'+plan['base_tree_sha']+'?recursive=1'})
remote_files={row['path']:row['sha'] for row in preserved['tree']}
expected_preserve={'.github/workflows/deploy-pages.yml':'4d8e0b8b3256c569464900e3b192f599e8563c86','deploy-materialize.py':'01d7b9c691f8ded9d0235f4d615f39fe0a6a936f'}
if plan.get('preserve')!=expected_preserve or any(remote_files.get(key)!=sha for key,sha in expected_preserve.items()):raise ValueError('Existing deployment workflow/materializer differs from reviewed preserved blobs')
entries=[]
for row in plan['files']:
 result=call('create_blob',{'repository_full_name':plan['repository'],'encoding':'base64','content':base64.b64encode(Path(row['localPath']).read_bytes()).decode()})
 entries.append({'path':row['path'],'mode':'100644','type':'blob','sha':result['sha']});receipt['files'].append({'path':row['path'],'sha':result['sha']})
 (plan_path.parent/'publish-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
tree=call('create_tree',{'repository_full_name':plan['repository'],'base_tree_sha':plan['base_tree_sha'],'tree_elements':entries});receipt['tree']=tree['sha']
commit=call('create_commit',{'repository_full_name':plan['repository'],'parent_sha':plan['expected_sha'],'tree_sha':tree['sha'],'message':plan['message']});receipt['commit']=commit['sha']
(plan_path.parent/'publish-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
updated=call('update_ref',{'repository_full_name':plan['repository'],'branch_name':plan['branch'],'sha':commit['sha'],'expected_sha':plan['expected_sha'],'force':False},allow_ack=True);receipt['updated']=updated
# The connector may acknowledge update_ref without a returned ref object.
# Persist the acknowledgement and verify with a separate read; never retry it.
(plan_path.parent/'publish-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
verified=call('fetch',{'url':'https://api.github.com/repos/samuelpmahan/PageRouter/git/ref/heads/main'});receipt['verifiedHead']=verified['object']['sha']
if receipt['verifiedHead']!=commit['sha']:raise ValueError('Observed main differs from produced commit; inspect without retrying update_ref')
(plan_path.parent/'publish-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'commit':commit['sha'],'tree':tree['sha'],'branch':'main','force':False}))
