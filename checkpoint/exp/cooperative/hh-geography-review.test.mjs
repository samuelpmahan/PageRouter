import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {renderGeographyReview, runMountedGeographyCheck} from './hh-geography-review.mjs';

const reportURL = new URL('../../vendor/hh-geography-review/review.json', import.meta.url);

test('mounted fixture check executes real services without browser storage or production authority', async () => {
  const result = await runMountedGeographyCheck();
  assert.equal(result.protected, true);
  assert.notEqual(result.attemptedSchool.district, result.registeredSchool.district);
  assert.deepEqual(result.createdProfile.school, result.registeredSchool);
  assert.equal(result.productionAuthority, false);
  assert.equal(result.persistence, 'volatile-memory');
  assert.equal(result.operations.length, 4);
  assert.ok(result.operations.every(operation => operation.ok));
  assert.equal(result.receipts.length, 5);
  assert.ok(result.receipts.every(receipt => receipt.status === 'produced'));
});

test('review presents executed backend results separately from the browser fixture and rollout', () => {
  const report = JSON.parse(fs.readFileSync(reportURL));
  const html = renderGeographyReview(report);
  assert.match(html, /31 passed/);
  assert.match(html, /403/);
  assert.match(html, /200/);
  assert.match(html, /not deployed to helpteachers.net/i);
  assert.match(html, /Recorded Python HTTP test/);
  assert.match(html, /Run mounted fixture check/);
  assert.match(html, /Administrator-reviewed transfer/);
  assert.match(html, /Existing users/);
  assert.match(html, /hithero-teacher-geography.patch/);
  assert.doesNotMatch(html, /mailto:/);
});

test('all published review artifacts are exact-hash bound to the report', () => {
  const report = JSON.parse(fs.readFileSync(reportURL));
  assert.equal(report.backend.tests.cases.length, report.backend.tests.passed);
  assert.equal(report.backend.tests.failed, 0);
  for (const artifact of report.artifacts) {
    const bytes = fs.readFileSync(new URL(artifact.file, reportURL));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.file);
  }
  const trace = JSON.parse(fs.readFileSync(new URL('http-regression.json', reportURL)));
  assert.equal(trace.before.createProfile.status, 200);
  assert.equal(trace.after.createProfile.status, 403);
  assert.deepEqual(trace.before.storedProfileDistricts, ['District B']);
  assert.deepEqual(trace.after.storedProfileDistricts, []);
});

test('recorded test labels are escaped before HTML rendering', () => {
  const report = JSON.parse(fs.readFileSync(reportURL));
  report.backend.tests.cases[0].name = '<img src=x onerror=alert(1)>';
  const html = renderGeographyReview(report);
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img src=x'));
});
