// Explicit coordinator recovery after executor loss; no task is marked complete.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const base='hh-cycle11',p=base+'/state.json',bytes=fs.readFileSync(p),s=JSON.parse(bytes);
const actors={H1:'/root/hh11_recover_h1',H2:'/root/hh11_recover_h2'};
const jobs={H1:'E1606',H2:'R1605'};
if(s.epoch!==8)throw Error('unexpected native state counter');
for(const [w,j]of Object.entries(jobs))if(s.workers[w].job!==j||s.jobs[j].status!=='running')throw Error('unexpected stale pin');
fs.writeFileSync(base+'/state.before-recovery-18Z.json',bytes,{flag:'wx'});
const at=new Date().toISOString(),old=[];
for(const [w,j]of Object.entries(jobs)){
 old.push({worker:w,job:j,previousWorker:s.workers[w],previousJob:s.jobs[j]});
 s.workers[w]={job:null,agent:null};s.jobs[j]={...s.jobs[j],status:'pending',worker:null,started_at:null,finished_at:null};
}
s.events.push({type:'coordinator_executor_loss_requeue',at,reason:'Old contexts absent from live agent inventory after shared transient executor failure; completed evidence retained, unfinished review/admin explicitly requeued for native solve. Not a native finish, task outcome or autonomous recovery service.',oldPins:old,newRegisteredActors:actors,previousStateSha256:createHash('sha256').update(bytes).digest('hex')});
s.service.actualCapacity='Two actual freshly registered gpt-6-luna/high recovery contexts H1/H2; only root was live before registration. Lab paused separately and not dispatched by this HH recovery.';
fs.writeFileSync(p,JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(base+'/registry-recovery-18Z.json',JSON.stringify({schema:'actual-worker-registry@1',observedAt:at,coordinator:'/root',workers:Object.entries(actors).map(([id,agent])=>({id,agent,model:'gpt-6-luna',reasoning:'high',registered:true})),oldRegistryPreserved:true,reason:'Actual fresh spawn acknowledgments, not assumed worker survival'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({requeued:jobs,oldStatePreserved:true,actors}));
