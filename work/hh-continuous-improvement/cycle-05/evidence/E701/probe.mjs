import {createFixtureProvider, createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '../../../PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';

function deferredFixtureProvider() {
  const base = createFixtureProvider({fixture: true});
  let announceStart;
  let releaseCall;
  const started = new Promise(resolve => { announceStart = resolve; });
  const held = new Promise(resolve => { releaseCall = resolve; });
  let holdCreate = true;
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'TeacherProfile.createProfile' && holdCreate) {
      holdCreate = false;
      announceStart();
      await held;
    }
    return invoke(input);
  }]));
  return {
    provider: {...base, services: Object.freeze(services)},
    started,
    release() { releaseCall(); },
  };
}

async function setupSyntheticTeacher(controller) {
  await controller.initialize('#/register');
  for (const [key, value] of Object.entries({
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy',
  })) await controller.selectSchool(key, value);
  await controller.dispatch('public:terms-consent', {accepted: true});
  const registered = await controller.dispatch('public:register', {
    name: 'Cycle Five Synthetic', email: 'cycle-five@example.invalid',
    password: 'Ephemeral-Only-39', confirm_password: 'Ephemeral-Only-39',
  });
  if (!registered.ok) throw new Error(`synthetic registration failed: ${registered.error?.code}`);
  const approved = await controller.dispatch('public:approve');
  if (!approved.ok) throw new Error(`synthetic approval failed: ${approved.error?.code}`);
  const loggedIn = await controller.dispatch('public:login', {
    email: 'cycle-five@example.invalid', password: 'Ephemeral-Only-39',
  });
  if (!loggedIn.ok) throw new Error(`synthetic login failed: ${loggedIn.error?.code}`);
  await controller.navigate('#/profile');
  return controller.state.journey.session.teacherId;
}

const delayed = deferredFixtureProvider();
const runtime = createServiceRuntime(delayed.provider);
const controller = createPublicController({runtime, community: createCommunity()});
const teacherId = await setupSyntheticTeacher(controller);
const baseline = {
  mode: runtime.mode,
  fixture: runtime.fixture,
  persistence: runtime.capabilities.persistence,
  teacherId,
  route: controller.route.path,
  ownProfile: controller.state.journey.profile.status,
};

const createPromise = controller.dispatch('public:profile-create', {
  name: 'Cycle Five Own Profile', bio: 'Synthetic profile created in volatile fixture.',
});
await delayed.started;
const duringCreate = {
  mutationGuardStatus: controller.state.request.status,
  route: controller.route.path,
  profileStatus: controller.state.journey.profile.status,
};

const otherRoute = await controller.navigate('#/public-profile/demo-avery');
const whileCreatePending = {
  navigationOk: otherRoute.ok,
  route: controller.route.path,
  routeProfileId: controller.route.profileId,
  displayedProfileId: controller.state.journey.profile.value?.id || null,
  displayedTeacherId: controller.state.journey.profile.value?.teacherId || null,
  displayedName: controller.state.journey.profile.value?.name || null,
  displayedReadOnly: controller.state.journey.profile.readOnly === true || controller.state.journey.profile.value?.readOnly === true,
};
delayed.release();
const createResult = await createPromise;
const afterCreate = {
  createOk: createResult.ok,
  providerSessionTeacherId: runtime.snapshot().session.teacherId,
  providerOwnProfileId: runtime.snapshot().ownProfile.profile?.id || null,
  route: controller.route.path,
  routeProfileId: controller.route.profileId,
  profileStatus: controller.state.journey.profile.status,
  displayedProfileId: controller.state.journey.profile.value?.id || null,
  displayedTeacherId: controller.state.journey.profile.value?.teacherId || null,
  displayedName: controller.state.journey.profile.value?.name || null,
  displayedReadOnly: controller.state.journey.profile.readOnly === true || controller.state.journey.profile.value?.readOnly === true,
  profileSource: controller.state.journey.profile.source,
};
const wrongRouteEditResult = await controller.dispatch('public:edit-profile');
const afterWrongRouteEdit = {
  editOk: wrongRouteEditResult.ok,
  editError: wrongRouteEditResult.error?.code || null,
  editOpen: controller.state.journey.profile.editOpen,
};

await controller.navigate(`#/public-profile/profile-${teacherId}`);
const ownRouteControl = {
  route: controller.route.path,
  routeProfileId: controller.route.profileId,
  displayedProfileId: controller.state.journey.profile.value?.id || null,
  displayedTeacherId: controller.state.journey.profile.value?.teacherId || null,
  editResult: (await controller.dispatch('public:edit-profile')).ok,
};
await controller.dispatch('public:edit-profile');

await controller.navigate('#/public-profile/reference-sarah');
const capturedReferenceControl = {
  route: controller.route.path,
  profileId: controller.state.journey.profile.value?.id || null,
  readOnly: controller.state.journey.profile.readOnly === true,
  editResult: await controller.dispatch('public:edit-profile'),
};

console.log(JSON.stringify({
  schema: 'hh-cycle05-E701-probe-output/v1',
  baseline,
  duringCreate,
  whileCreatePending,
  afterCreate,
  afterWrongRouteEdit,
  ownRouteControl,
  capturedReferenceControl: {
    route: capturedReferenceControl.route,
    profileId: capturedReferenceControl.profileId,
    readOnly: capturedReferenceControl.readOnly,
    editOk: capturedReferenceControl.editResult.ok,
    editError: capturedReferenceControl.editResult.error?.code || null,
  },
}, null, 2));
