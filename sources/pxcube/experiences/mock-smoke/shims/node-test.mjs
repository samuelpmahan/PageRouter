// Minimal browser stand-in for the default export of `node:test`.
// The repo's real test modules import this through the import map, so the
// browser runs the byte-identical test files. Importing a test file only
// registers its tests; the experience UI runs the registry on demand, so one
// page load can run the suite more than once (reset, then re-import with a
// cache-busting query).
const registry = [];
function test(name, fn) {
  if (typeof name !== 'string' || typeof fn !== 'function') throw new TypeError('test(name, fn) expected');
  registry.push({ name, fn });
}
test.reset = () => { registry.length = 0; };
test.count = () => registry.length;
test.runAll = async onResult => {
  const results = [];
  for (const { name, fn } of registry) {
    let result;
    try { await fn(); result = { name, ok: true }; }
    catch (error) { result = { name, ok: false, error: error && error.message ? error.message : String(error) }; }
    results.push(result);
    if (typeof onResult === 'function') {
      try { onResult(result); } catch { /* reporting must never fail the run */ }
    }
  }
  return results;
};
export default test;
