import assert from 'node:assert/strict';
import {createFixtureProvider} from '../../PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
function memoryStorage() { const values = new Map(); return {getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); }}; }
async function setup(login = true) {
  const storage = memoryStorage(); const provider = createFixtureProvider({fixture: true, storage}); const runtime = createServiceRuntime(provider); const controller = createPublicController({runtime, storage});
  await controller.initialize(login ? '#/login' : '#/public-profile/demo-jordan');
  if (login) assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  return {controller, runtime};
}
const result = {schema:'hh-cycle03-e402-postfix-probe/v1', cases:{}};
{
  const {controller, runtime} = await setup(); await controller.navigate('#/public-profile/demo-jordan');
  const runtimeBefore=runtime.snapshot(), profileBefore=structuredClone(controller.state.journey.profile.value);
  assert.equal(runtimeBefore.session.teacherId,'demo-seed-avery'); assert.equal(profileBefore.teacherId,'demo-seed-jordan');
  const toggle=await controller.dispatch('public:edit-profile'); const afterToggle=structuredClone(controller.state.journey.profile);
  const submit=await controller.dispatch('public:profile-edit',{name:'Demo Jordan changed by Avery',bio:'Should be rejected'}); const afterSubmit=structuredClone(controller.state.journey.profile);
  await controller.navigate('#/public-profile/demo-jordan'); const reopened=structuredClone(controller.state.journey.profile); const runtimeAfter=runtime.snapshot();
  assert.equal(toggle.error.code,'profile_owner_mismatch'); assert.equal(submit.error.code,'profile_owner_mismatch'); assert.equal(afterToggle.editOpen,false); assert.deepEqual(afterToggle.value,profileBefore); assert.deepEqual(afterSubmit.value,profileBefore); assert.equal(reopened.value.teacherId,'demo-seed-jordan'); assert.equal(reopened.value.name,profileBefore.displayName); assert.equal(reopened.source,'runtime'); assert.deepEqual(runtimeAfter,runtimeBefore);
  result.cases.nonowner={ownerTeacherIdBefore:runtimeBefore.session.teacherId,ownerTeacherIdAfter:runtimeAfter.session.teacherId,viewed:{profileId:'demo-jordan',teacherIdBefore:profileBefore.teacherId,teacherIdAfter:reopened.value.teacherId,nameBefore:profileBefore.name,nameAfter:reopened.value.name,sourceAfterReopen:reopened.source},toggle:{ok:toggle.ok,error:toggle.error},submit:{ok:submit.ok,error:submit.error},providerRuntimeSnapshotUnchanged:true,otherProfileOverlayUnchanged:true,reopenedProfileUnchanged:true};
}
{
  const {controller,runtime}=await setup(); await controller.navigate('#/teachers/demo-avery'); const before=structuredClone(controller.state.journey.profile.value); const runtimeBefore=runtime.snapshot();
  assert.equal(runtimeBefore.session.teacherId,before.teacherId); const submit=await controller.dispatch('public:profile-edit',{name:'Demo Avery owner edited'}); const after=structuredClone(controller.state.journey.profile.value); await controller.navigate('#/teachers/demo-avery'); const reopened=structuredClone(controller.state.journey.profile.value); const runtimeAfter=runtime.snapshot();
  assert.equal(submit.ok,true); assert.equal(after.name,'Demo Avery owner edited'); assert.equal(reopened.name,after.name); assert.equal(reopened.teacherId,'demo-seed-avery'); assert.deepEqual(runtimeAfter,runtimeBefore);
  result.cases.ownedPublicAlias={ownerTeacherId:runtimeBefore.session.teacherId,profileTeacherIdBefore:before.teacherId,profileTeacherIdAfter:reopened.teacherId,save:{ok:submit.ok,localOnly:submit.localOnly},nameAfter:after.name,nameAfterReopen:reopened.name,providerRuntimeSnapshotUnchanged:true};
}
{
  const {controller,runtime}=await setup(); const runtimeBefore=runtime.snapshot(); await controller.navigate('#/pages/teacher.html'); const before=structuredClone(controller.state.journey.profile); const toggle=await controller.dispatch('public:edit-profile'); const submit=await controller.dispatch('public:profile-edit',{name:'Demo forbidden captured edit'}); const after=structuredClone(controller.state.journey.profile); const runtimeAfter=runtime.snapshot();
  assert.equal(before.source,'captured-readonly'); assert.equal(toggle.error.code,'read_only_reference'); assert.equal(submit.error.code,'read_only_reference'); assert.equal(after.value.name,before.value.name); assert.deepEqual(runtimeAfter,runtimeBefore);
  result.cases.capturedReference={ownerTeacherId:runtimeBefore.session.teacherId,requested:{profileId:controller.route.profileId,source:before.source,readOnly:before.readOnly},toggle:{ok:toggle.ok,error:toggle.error},submit:{ok:submit.ok,error:submit.error},nameBefore:before.value.name,nameAfter:after.value.name,providerRuntimeSnapshotUnchanged:true};
}
{
  const {controller,runtime}=await setup(false); const runtimeBefore=runtime.snapshot(); const profileBefore=structuredClone(controller.state.journey.profile.value); const toggle=await controller.dispatch('public:edit-profile'); const submit=await controller.dispatch('public:profile-edit',{name:'Anonymous edit'}); const profileAfter=structuredClone(controller.state.journey.profile.value); const runtimeAfter=runtime.snapshot();
  assert.equal(toggle.error.code,'authentication_required'); assert.equal(submit.error.code,'authentication_required'); assert.equal(controller.state.journey.profile.editOpen,false); assert.deepEqual(profileAfter,profileBefore); assert.deepEqual(runtimeAfter,runtimeBefore);
  result.cases.anonymous={ownerTeacherId:null,viewedTeacherId:profileBefore.teacherId,toggle:{ok:toggle.ok,error:toggle.error},submit:{ok:submit.ok,error:submit.error},profileUnchanged:true,providerRuntimeSnapshotUnchanged:true};
}
{
  const {controller,runtime}=await setup(); await controller.navigate('#/public-profile/demo-avery'); const runtimeBefore=runtime.snapshot(); const profileBefore=structuredClone(controller.state.journey.profile.value); controller.state.journey.session.teacherId=''; const toggle=await controller.dispatch('public:edit-profile'); const submit=await controller.dispatch('public:profile-edit',{name:'Missing identity edit'}); const profileAfter=structuredClone(controller.state.journey.profile.value); const runtimeAfter=runtime.snapshot();
  assert.equal(profileBefore.teacherId,'demo-seed-avery'); assert.equal(toggle.error.code,'profile_owner_mismatch'); assert.equal(submit.error.code,'profile_owner_mismatch'); assert.deepEqual(profileAfter,profileBefore); assert.deepEqual(runtimeAfter,runtimeBefore);
  result.cases.missingSessionTeacherId={sessionTeacherIdBefore:'',profileTeacherId:profileBefore.teacherId,toggle:{ok:toggle.ok,error:toggle.error},submit:{ok:submit.ok,error:submit.error},profileUnchanged:true,providerRuntimeSnapshotUnchanged:true};
}
console.log(JSON.stringify(result,null,2));
