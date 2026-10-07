import {deepFreeze} from './contract.mjs';

export const SCHOOL_FIXTURES = deepFreeze([
  {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'},
  {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo STEM School'},
  {state: 'Demo California', county: 'Demo Alameda', district: 'Demo Bay District', school: 'Demo Bay School'},
]);
export const FIXTURE_WISHLIST_URL = 'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW';
export const SEED_PUBLIC_PROFILES = deepFreeze([
  {id: 'demo-avery', teacherId: 'demo-seed-avery', displayName: 'Demo Avery', bio: 'Synthetic science teacher profile.',
    subjects: ['Science'], wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY', school: SCHOOL_FIXTURES[0], seeded: true},
  {id: 'demo-jordan', teacherId: 'demo-seed-jordan', displayName: 'Demo Jordan', bio: 'Synthetic arts teacher profile.',
    subjects: ['Art'], wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-JORDAN', school: SCHOOL_FIXTURES[2], seeded: true},
]);

export function newFixtureState() {
  return {version: 1, fixture: true, nextId: 1, selectedTeacherId: null, sessionTeacherId: null,
    teachers: SEED_PUBLIC_PROFILES.map((profile) => ({
      id: profile.teacherId,
      teacher: {name: profile.displayName, email: `${profile.id.slice(5)}@fixture.test`, phoneNumber: 'DEMO'},
      school: {...profile.school}, registrationStatus: 'approved', profile: structuredClone(profile),
    }))};
}
