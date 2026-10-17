import {createFixtureProvider, createServiceRuntime} from '../../vendor/hh/services/index.mjs';
import {SCHOOL_FIXTURES, FIXTURE_WISHLIST_URL} from '../../vendor/hh/services/fixtures.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const artifactsPath = 'hh-geography-review/';

/** A fresh, volatile instance of the existing mounted runtime; no tab records. */
export async function runMountedGeographyCheck() {
  const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage: null}));
  const registeredSchool = SCHOOL_FIXTURES[0];
  const attemptedSchool = SCHOOL_FIXTURES.find(school => school.district !== registeredSchool.district);
  const operations = [];
  async function invoke(port, input) {
    const result = await runtime.invoke(port, input);
    operations.push({port, ok: result.ok, outcome: result.outcome, message: result.message});
    if (!result.ok) throw new Error(`${port}: ${result.message || result.error?.message}`);
    return result;
  }
  await invoke('Registration.registerTeacher', {teacher: {name: 'Demo Scope Review', email: 'scope-review@fixture.test', phoneNumber: 'DEMO'},
    school: registeredSchool, termsAccepted: true, demoAccount: true});
  await invoke('Demo.simulateApproval', {});
  await invoke('Session.login', {email: 'scope-review@fixture.test', demoAccount: true});
  const result = await invoke('TeacherProfile.createProfile', {displayName: 'Demo Scope Review', subjects: [],
    bio: 'Synthetic geography review', wishlistUrl: FIXTURE_WISHLIST_URL, school: attemptedSchool});
  const createdProfile = result.data.profile;
  return {kind: 'mounted-fixture-execution', productionAuthority: runtime.capabilities.productionAuthority,
    persistence: runtime.capabilities.persistence, registeredSchool, attemptedSchool, createdProfile,
    protected: createdProfile.school.district === registeredSchool.district && createdProfile.school.state === registeredSchool.state &&
      createdProfile.school.county === registeredSchool.county, operations, receipts: runtime.inspect().receipts};
}

export function renderGeographyReview(report) {
  const tests = report.backend.tests;
  const trace = report.backend.crossDistrict;
  const link = (file, label) => `<a href="${artifactsPath}${file}" target="_blank" rel="noopener">${label}</a>`;
  return `<div class="panel" id="hh-geography-review"><div class="row spread"><h2>Teacher geography approval review</h2><span class="badge amber">REVIEW CANDIDATE</span></div>
    <p>Approval scope must survive registration, profile creation and school edits. A profile change cannot grant authority in another district.</p>
    <p><strong>Not deployed to helpteachers.net.</strong> This is the Python backend correction under review. The mounted browser fixture has no production HTTP authority.</p>
    <div class="data-list"><div class="data-item"><strong>Same-district approval</strong><p>Approved state, county, district and school are retained with the reviewer and time.</p></div>
    <div class="data-item"><strong>Cross-district attempt</strong><p>Creating or editing a profile outside approved scope returns 403 before any write.</p></div>
    <div class="data-item"><strong>Administrator-reviewed transfer</strong><p>A reviewed transfer updates the profile and scope together; earlier approval history remains. Same-district school moves stay allowed.</p></div>
    <div class="data-item"><strong>Existing users</strong><p>Login and existing profiles remain. Validation authority needs administrator scope review; editable old profiles are never automatically trusted.</p></div></div>
    <h3>Recorded Python HTTP test</h3><p>Approved in District A, then submitted a District B profile. Isolated SQLite, synthetic accounts; no production requests. The test sets createCount to zero to isolate authorization; the live database default is uninspected.</p>
    <div class="two"><div><strong>Original ${escape(report.backend.baseCommit.slice(0, 7))}</strong><p>HTTP ${escape(trace.beforeStatus)} · District B profile stored.</p></div>
    <div><strong>Corrected candidate</strong><p>HTTP ${escape(trace.afterStatus)} · no profile stored.</p></div></div>
    <p><strong>${escape(tests.passed)} passed, ${escape(tests.failed)} failed</strong> · executed backend regressions, including transfers, legacy accounts and rollback.</p>
    <details class="details"><summary>Inspect all ${escape(tests.cases.length)} executed cases</summary><ul>${tests.cases.map(item => `<li><code>${escape(item.name)}</code> — ${escape(item.status)}</li>`).join('')}</ul></details>
    <div class="row">${link('hithero-teacher-geography.patch', 'Download correction patch')} ${link('OWNER-REVIEW.md', 'Migration and rollout notes')} ${link('http-regression.json', 'Before / after HTTP evidence')} ${link('tests.xml', 'Test results')}</div>
    <p class="mono">Backend base: ${escape(report.backend.baseCommit)}</p>
    <h3>Check the mounted fixture</h3><p>This runs the existing fixture service calls in fresh memory and attempts to supply a different district during profile creation. Its existing behavior retains registration school. This check does not execute Python or prove production deployment.</p>
    <button type="button" data-geography-check>Run mounted fixture check</button><pre data-geography-result role="status" aria-live="polite">Not run in this browser.</pre>
    <details class="details"><summary>Artifact hashes and verification boundaries</summary><p>Azure SQL migration and concurrency remain staging checks. Browser fixture results and recorded Python tests are separate evidence.</p><pre>${escape(JSON.stringify(report.artifacts, null, 2))}</pre></details></div>`;
}

export async function mountGeographyReview(root) {
  root.innerHTML = '<div class="panel" role="status">Loading teacher geography review…</div>';
  try {
    const response = await fetch(`${artifactsPath}review.json`);
    if (!response.ok) throw new Error(`Review evidence returned HTTP ${response.status}`);
    const report = await response.json();
    if (!root.isConnected) return;
    root.innerHTML = renderGeographyReview(report);
    const button = root.querySelector('[data-geography-check]');
    const output = root.querySelector('[data-geography-result]');
    button.addEventListener('click', async () => {
      button.disabled = true;
      output.textContent = 'Running existing fixture service calls…';
      try { output.textContent = JSON.stringify(await runMountedGeographyCheck(), null, 2); }
      catch (error) { output.textContent = `Check failed: ${error.message}`; }
      finally { button.disabled = false; }
    });
  } catch (error) {
    if (root.isConnected) root.textContent = `Teacher geography review is unavailable: ${error.message}`;
  }
}
