"""Exercise the bounded publisher without credentials, network, or remote writes."""
from pathlib import Path
import contextlib,hashlib,io,json,runpy,sys,tempfile,types,unittest

ROOT=Path(__file__).resolve().parents[1]
HEAD='9652352557bdcbbbce888ce87f7ffbd36da9bad6'
TREE='63c371780f395802fb5e119b67ddc8ce8cc0ef3e'
PRESERVE={'.github/workflows/deploy-pages.yml':'4d8e0b8b3256c569464900e3b192f599e8563c86','deploy-materialize.py':'01d7b9c691f8ded9d0235f4d615f39fe0a6a936f'}

class PublisherTest(unittest.TestCase):
 def test_success_ack_without_ref_object_is_verified_once_by_read(self):
  calls=[];commit='c'*40;advanced=False
  class Client:
   def call_tool(self,connector,name,arguments):
    nonlocal advanced
    calls.append((name,arguments))
    if name=='fetch':
     if '/git/trees/' in arguments['url']:return {'tree':[{'path':key,'sha':value} for key,value in PRESERVE.items()]}
     return {'object':{'sha':commit if advanced else HEAD}}
    if name=='create_blob':return {'sha':'a'*40}
    if name=='create_tree':return {'sha':'b'*40}
    if name=='create_commit':return {'sha':commit}
    if name=='update_ref':advanced=True;return {'isError':False,'content':[{'type':'text','text':'Reference updated successfully'}]}
    raise AssertionError(name)
  module=types.ModuleType('library_hosted_apps');module.HostedAppsClient=Client
  previous=sys.modules.get('library_hosted_apps');sys.modules['library_hosted_apps']=module
  argv=sys.argv[:]
  try:
   with tempfile.TemporaryDirectory() as temporary:
    directory=Path(temporary);payload=directory/'artifact.json';payload.write_bytes(b'{}')
    plan={'repository':'samuelpmahan/PageRouter','branch':'main','force':False,'expected_sha':HEAD,'base_tree_sha':TREE,'preserve':PRESERVE,'message':'Integrate executable Atlas capability ladder','files':[{'path':'artifact.json','localPath':str(payload),'bytes':2,'sha256':hashlib.sha256(b'{}').hexdigest()}]}
    plan_file=directory/'publish-plan.json';plan_file.write_text(json.dumps(plan))
    sys.argv=['publish-atlas-github.py','--plan',str(plan_file),'--connector-id','offline-test','--execute']
    with contextlib.redirect_stdout(io.StringIO()):runpy.run_path(str(ROOT/'evidence/publish-atlas-github.py'),run_name='__main__')
    receipt=json.loads((directory/'publish-receipt.json').read_text())
    self.assertEqual(receipt['commit'],commit)
    self.assertEqual(sum(name=='update_ref' for name,_ in calls),1)
    ref_reads=[arguments for name,arguments in calls if name=='fetch' and '/git/ref/' in arguments['url']]
    self.assertEqual(len(ref_reads),2)
    self.assertEqual(receipt['verifiedHead'],commit)
  finally:
   sys.argv=argv
   if previous is None:sys.modules.pop('library_hosted_apps',None)
   else:sys.modules['library_hosted_apps']=previous

if __name__=='__main__':unittest.main()
