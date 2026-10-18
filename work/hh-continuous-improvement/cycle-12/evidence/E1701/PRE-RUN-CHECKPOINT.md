# HH12 H1 / E1701 pre-run checkpoint

Admission: native epoch 00 assigned E1701 to H1; current root state records the job running. Scope is only the actual synthetic volatile-fixture `TeacherProfile.createProfile` flow, with held known transport failure, held `outcome_unknown`, and a valid success control. No source/test edits, production/backend/browser activity, or Git actions are in scope.

## Frozen hypothesis

For an authenticated synthetic teacher on `#/profile` with a typed, nonsecret `createDraft`, a failed `TeacherProfile.createProfile` operation may lose the user's draft or remove its rendered form. A second risk is an automatic or unsafe retry of this write after a known or unknown transport outcome. The hypothesis is not presumed true.

## Source-based prediction

Current `checkpoint/vendor/hh/src/public-controller.mjs` reads values from `state.journey.profile.createDraft`, calls `TeacherProfile.createProfile`, and clears the draft only inside the success branch when the current route still shows the matching own profile. The `service` helper sets `lastRetry` only when a supplied retry closure exists; profile creation supplies none. `public:retry` should therefore return `nothing_to_retry` without another provider call. Failure should retain `createDraft` and, while the own profile is absent, `renderPublicSite` should retain `#hh-profile-create-form` with all three fields. The fixture provider's `checkFailure` rejects `transport_failure` and `outcome_unknown` before profile creation, so its provider snapshot/storage should remain profile-absent. A separate explicit resubmission should issue exactly one additional write using the retained draft; success should create one profile and clear the form draft. Success control should create a profile once and clear the draft/form.

## Falsifier and evidence limits

The draft-loss hypothesis is falsified if both held failure outcomes preserve exact typed values in controller draft and rendered fields, keep the create form available, leave provider profile absent, expose no write retry, and allow a deliberate resubmission to use the retained values. Any profile/provider mutation on held failure, missing or altered draft/form, retry call-count increase, or absent usable explicit resubmission contradicts the prediction and will be retained as observed. The fixture's `outcome_unknown` rejects before provider mutation; it cannot model or establish a real backend's possibly committed-but-unacknowledged write. This is not backend, production, or browser evidence.

## Planned command and privacy

After this checkpoint is saved, run the E1701 probe script once with Node from this workspace. The script uses generated passwords held only in process memory, passes them only through the existing secure credential boundary, asserts they never appear in fixture Parts/storage or returned evidence, and prints only nonsecret outcomes/field values/counts. Save stdout, stderr, and exit status separately. First harness failure is retained; do not patch product source/tests or conceal a failure.
