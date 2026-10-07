import test from 'node:test';
import assert from 'node:assert/strict';
import { routeFor, parseRoute, pinURL } from '../../src/project-router.mjs';

test('route helpers preserve only known projects and views with safe leaf paths', () => {
  const projects = [{id: 'pxcube'}, {id: 'hh'}];
  assert.deepEqual(parseRoute('#/hh/compose/recipe%2Fhome.json', projects), {project:'hh', view:'compose', leaf:'recipe/home.json'});
  assert.equal(routeFor('hh', 'compose', 'recipe/home.json'), '#/hh/compose/recipe%2Fhome.json');
  assert.deepEqual(parseRoute('#/unknown/overview', projects), {project:'pxcube',view:'overview',leaf:'',invalid:true});
  assert.deepEqual(parseRoute('#/hh/nope', projects), {project:'pxcube',view:'overview',leaf:'',invalid:true});
  assert.equal(parseRoute('#/hh', projects).view, 'overview');
});

test('route parser rejects decoded traversal, malformed encoding, and unsafe path syntax', () => {
  for (const hash of [
    '#/hh/overview/%2e%2e/private',
    '#/hh/overview/%2Fetc%2Fpasswd',
    '#/hh/overview/bad%ZZ',
    '#/hh/overview/x%00y',
    '#/hh/overview/__proto__/secret',
  ]) assert.equal(parseRoute(hash, [{id:'pxcube'}, {id:'hh'}]).invalid, true, hash);
  assert.throws(() => routeFor('hh', 'overview', '../private'));
  assert.throws(() => routeFor('__proto__', 'overview'));
});

test('pin URLs remain scoped under compiled project roots', () => {
  const base = 'https://example.test/app/';
  assert.equal(pinURL({id:'hh', entry:'index.html', digest:'a'.repeat(64)},base), 'https://example.test/app/compiled/hh/index.html');
  for (const project of [
    {id:'../outside', entry:'index.html', digest:'a'.repeat(64)},
    {id:'hh', entry:'../../outside.html', digest:'a'.repeat(64)},
    {id:'hh', entry:'/outside.html', digest:'a'.repeat(64)},
  ]) {
    let escaped = false;
    try { escaped = !new URL(pinURL(project, base)).pathname.startsWith('/app/compiled/hh/'); } catch { /* a rejection is safe */ }
    assert.equal(escaped, false, `pin escaped root: ${JSON.stringify(project)}`);
  }
});

test('Atlas is a canonical PxCube view while existing encoded leaf routes remain unchanged', () => {
  const projects = [{id:'pxcube'}, {id:'hh'}, {id:'justin'}];
  assert.equal(routeFor('pxcube','atlas'), '#/pxcube/atlas');
  assert.deepEqual(parseRoute('#/pxcube/atlas',projects), {project:'pxcube',view:'atlas',leaf:''});
  for (const project of ['hh','justin']) {
    assert.throws(()=>routeFor(project,'atlas'));
    assert.equal(parseRoute(`#/${project}/atlas`,projects).invalid,true);
  }
  assert.equal(parseRoute(routeFor('pxcube','run','experiences/connect4/index.html'),projects).leaf,'experiences/connect4/index.html');
});
