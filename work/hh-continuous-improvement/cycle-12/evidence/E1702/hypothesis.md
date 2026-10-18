# E1702 H2 independent hypothesis (frozen before probe)

Scope: disposable in-memory `createFixtureProvider({fixture:true})` only; synthetic teacher record; no PageRouter writes, Git, browser, backend, or production account.

Hypothesis: after a synthetic teacher is authenticated and the profile-creation form is typed through `updateDraft`, a held `TeacherProfile.createProfile` known transport failure or unknown outcome will not erase the live name/bio/wishlist draft. The failure sync will leave the create form rendered with those exact current values, and neither failure will enable automatic retry. `public:retry` should report `nothing_to_retry` without another provider invocation. A later explicit `public:profile-create` submission should consume the retained draft; a valid success should make one profile, render the submitted overlay values, and close/clear the creation form.

Prediction: for each held failure, provider profile remains absent, rendered form remains present with exact typed values, runtime Parts/receipts show only the failed attempt, and retry count remains one. For explicit resubmission after known failure, the second attempt should succeed and use current retained draft values. An independent fresh success case should likewise create exactly one profile and clear the now-irrelevant draft.

Falsifier: any failure drops/rewrites draft or form values; provider mutation occurs on failed/unknown attempt; retry reissues the write; an explicit new submission does not use the retained draft; success leaves the form/draft inconsistent or creates more than one profile.

Inputs will use synthetic labels/emails and a fixture-only provider. No passwords or credentials are used or captured. Captured outputs exclude email/account IDs and all user-entered raw values; only status flags, counts, and assertion booleans are emitted.
