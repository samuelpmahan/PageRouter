# Teacher geography authorization correction

Prepared October 17, 2026 for owner review against
`EngSmallz/hithero` main commit `cc195c20696314d36fd02a3888419002624c2274`.
This patch is not deployed. No production accounts, records, or credentials were used.

## Original behavior and trace

1. `POST /profile/register/` saves state, county, district, and school in `new_users`.
2. `POST /validation/validate_user/{user_email}` compares an applicant's state,
   county, and district against the reviewer's editable `teacher_list` profile.
   It copies only credentials/contact information/role to `registered_users`
   and deletes the pending row, losing approval geography.
3. `POST /profile/create_teacher_profile/` accepts unrelated geography.
4. `POST /profile/update_teacher_school/` also accepts unrelated geography.
5. Later approvals and waiting-list access trust the resulting profile. Wednesday
   approval reminders select recipients by the same editable profile geography.

The synthetic HTTP regression reproduced a District A approval followed by
successful District B profile creation on the original code. That test explicitly
sets `createCount=0` to model the possible production column default; neither that
default nor production exploitability was inspected. No live exploit was attempted.
The October 2 HH parity checklist independently records the scope-loss issue:
https://drive.google.com/file/d/16ni6cCb5BKkzlG4zvMC_YZgcUKT-JZSy/view

## Corrected invariant

A teacher may validate applicants only in the state/county/district of their
latest recorded approval, while their public profile matches that district.
Neither editable profile fields nor browsing-session geography can grant scope.
School changes within that district remain allowed: school is preserved in the
approval snapshot, but the existing authorization boundary is district-wide.

- New approval atomically creates the registered account, an approval snapshot
  with reviewer ID and UTC timestamp, and removes the pending applicant.
  `createCount=0` is explicit. Credential/contact/role behavior is preserved.
- Profile creation requires an approved district. Geographic edits outside it
  return 403 before any write. Denials remain 403 rather than becoming 500.
  These API paths return JSON with both `detail` and `message`, so the existing
  forms can display the administrator-review instruction. The validation list
  renders a denied response as text instead of trying to iterate missing users.
  Other 403 pages retain their HTML response. No layout changes are included.
- Approval, profile geography operations, and waiting-list access recheck the
  current database role, so a stale session cannot retain a removed role.
- Waiting-list scope and Wednesday reminder eligibility use recorded approval.
- SQL Server account-row locks serialize changes with validation. Pending-row
  locks prevent competing reviewers from moving the same queued applicant twice.
- Admin geographic review appends history and updates existing profile geography
  in one transaction. Previous approval snapshots remain unchanged.

## Legitimate changes and legacy accounts

After independently verifying the teacher's destination district, an authenticated
administrator submits form fields `state`, `county`, `district`, and `school` to:

`POST /validation/approve_geography/{registered_user_id}`

Use the existing admin session and the teacher's numeric registered-user ID.
This endpoint rejects teachers, anonymous users, stale roles, missing targets,
non-teacher targets, blank fields, and fields longer than 255 characters.
It is an API for administrative review; no redesign, review inbox, or email
workflow is included. Existing admin tools or the owner's API client can call it.
Teachers should contact the site's administrators for a cross-district move;
submitting a profile edit alone does not queue a review or change approval.

Existing profiles remain public. Legacy users can log in and edit ordinary
profile content and their school within their current district. They cannot
validate others or read the waiting list until an administrator records a
reviewed scope. Legacy approved users with no profile also require scope review
before first profile creation. NULL legacy `createCount` is repaired from the
actual profile count during that review; existing non-NULL counts are preserved.

There is deliberately no automatic trust backfill from `teacher_list`: it was
user-editable. Original approval geography was deleted, so reconstructing it
requires trusted historical evidence or fresh human verification. Plan an admin
review of existing validators before campaign traffic; otherwise their validation
work stops until reviewed. Admin-wide initial approval and multiple-profile
creation behavior is retained.

## Migration and deployment gate

1. Owner checks the patch against the current main SHA and reviews the behavior
   and tests. Rebase/retest if main has advanced.
2. Back up the database and stage
   `migrations/20261017_teacher_geography_approvals.sql` under the owner's normal
   deployment process. It adds one table and index and changes no existing rows.
   It assumes the existing tables use `dbo`; confirm this before applying.
3. Run the migration in staging before the application. Existing `create_all`
   behavior can also create this missing table, but is not a deployment plan.
4. Test against staging Azure SQL/ODBC: migration rerun, two simultaneous reviewers
   approving one queued applicant, transfer-versus-validation locking, transaction
   rollback, account deletion/cascade, and case/Unicode geography comparisons.
   SQLite tests and MSSQL compilation do not prove SQL Server runtime behavior.
5. Review legacy teacher scope using trusted evidence and the admin endpoint.
   Coordinate this with rollout: old code can still change geography, so do not
   backfill trust while old application instances continue serving writes.
6. Deploy only through owner approval. Production changes and migrations were
   not performed by this task. Retain approval history if application rollback is
   necessary; rolling back to the original code reopens the authorization defect.

New table: `teacher_geography_approvals` stores user ID (foreign key with delete
cascade), Unicode geographic fields, reviewer ID, and UTC approval time. The
latest increasing approval ID is authoritative. Reviewer ID has no foreign key
so deleting a reviewer does not erase or block other users' approval history.
Deleting the subject account deletes its own snapshots via cascade.

## Verification and owner handoff

Install `requirements-test.txt`, then run `python -m pytest -q` from the repo root.
Tests import the actual application and use real HTTP requests, session login,
SQLAlchemy queries, and isolated SQLite databases. Only ODBC import, engine
creation, dotenv, email, and CAPTCHA/network boundaries are replaced. No Azure
SQL, real mail, or Google CAPTCHA requests are made. The original repository has
no test suite. Dependency warnings from existing code are reported separately.

The deliverable includes a standard Git patch, changed source files, migration,
synthetic tests, and verification output. An owner can create a review branch at
the base SHA and apply it using `git apply --check` followed by `git apply`.
Do not push to `main`: this repository deploys main through its Azure workflow.

The established review destination is the mounted Homeroom Heroes project in
PageRouter, under `#/hh/scope` (Scope & evidence), with the existing application
at `#/hh/run`. Review happens there; no separate owner email or writable fork is
needed. The mounted browser fixture already retains registration school and its
production HTTP ports remain disabled. The Python correction and recorded HTTP
regression evidence are review materials, not a claim that the browser runs the
Python server or that helpteachers.net is patched. Production rollout remains a
separate owner decision. No unrelated site/campaign changes are included.
