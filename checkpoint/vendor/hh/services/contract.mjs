/** HH Teacher Journey v1. Browser projections never establish production authority. */
export const HH_CONTRACT_VERSION = 'hh-teacher-journey/1';
export const HH_PORTS = Object.freeze([
  'SchoolData.getStates', 'SchoolData.getCounties', 'SchoolData.getDistricts', 'SchoolData.getSchools',
  'Registration.registerTeacher', 'Registration.getOwnStatus',
  'Session.getSession', 'Session.login', 'Session.logout',
  'TeacherProfile.createProfile', 'TeacherProfile.getOwnProfile', 'TeacherProfile.openPublicProfile',
  'Demo.reset', 'Demo.simulateApproval',
]);
export const HH_HTTP_DECLARATIONS = Object.freeze({
  'SchoolData.getStates': {method: 'GET', path: '/api/get_states/'},
  'SchoolData.getCounties': {method: 'GET', path: '/api/get_counties/{state}'},
  'SchoolData.getDistricts': {method: 'GET', path: '/api/get_districts/{state}/{county}'},
  'SchoolData.getSchools': {method: 'GET', path: '/api/get_schools/{state}/{county}/{district}'},
  'Registration.registerTeacher': {method: 'POST', path: '/profile/register/'},
  'Registration.getOwnStatus': {method: 'GET', path: '/api/registration/state', support: 'isolated-preview-only'},
  'Session.getSession': {method: 'GET', path: '/api/profile/'},
  'Session.login': {method: 'POST', path: '/profile/login/'},
  'Session.logout': {method: 'GET', path: '/profile/logout/'},
  'TeacherProfile.createProfile': {method: 'POST', path: '/profile/create_teacher_profile/'},
  'TeacherProfile.getOwnProfile': {method: 'GET', path: '/profile/myinfo/', limitation: 'legacy-selected-teacher-session'},
  'TeacherProfile.openPublicProfile': {method: 'GET', path: '/teacher/{url_id}', limitation: 'legacy-selected-teacher-session'},
  'Demo.reset': {support: 'fixture-only'},
  'Demo.simulateApproval': {support: 'fixture-only'},
});
export const HH_MESSAGES = Object.freeze({
  fixture: 'Synthetic demo only. No real email, authentication, payments, or production database.',
  pending_saved: 'Demo registration saved as pending. Simulated approval is required before demo login.',
  simulated_mail_failure: 'Pending registration was saved; the simulated confirmation email failed.',
  already_pending: 'This demo teacher already has a pending registration.',
  registered_email: 'This demo teacher is already approved. Use demo login.',
  approval_simulated: 'Demo approval simulated. You are still logged out.',
  pending_denied: 'Pending demo teachers cannot log in. Simulate approval first.',
  authentication_required: 'Use demo login before creating a profile.',
  profile_exists: 'This demo teacher already has one profile.',
  unsupported: 'This HTTP port is declared but not verified or connected. No request was sent.',
  storage_unavailable: 'Per-tab demo storage is unavailable. This change was not saved.',
  synthetic_only: 'Use a .test demo email and synthetic demo details only.',
});
export function clone(value) { return structuredClone(value); }
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
export function success(port, mode, outcome, data = {}, message = '') {
  return deepFreeze({ok: true, port, mode, fixture: mode === 'fixture', outcome, data: clone(data), message});
}
export function failure(port, mode, code, message, {outcome = code, retryable = false, outcomeKnown = true, data = {}} = {}) {
  return deepFreeze({ok: false, port, mode, fixture: mode === 'fixture', outcome, data: clone(data),
    error: {code, message, retryable, outcomeKnown}, message});
}
export function initialJourney(mode = 'fixture') {
  return deepFreeze({kind: 'TeacherJourney', contractVersion: HH_CONTRACT_VERSION, mode, fixture: mode === 'fixture',
    session: {status: mode === 'fixture' ? 'anonymous' : 'unknown', role: null, teacherId: null},
    registration: {status: mode === 'fixture' ? 'none' : 'unknown', teacherId: null, email: null},
    ownProfile: {status: 'unknown', profile: null}, request: {status: 'idle'}});
}
