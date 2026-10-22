// The canonical-json@1 contract as data. Every implementation in PageRouter that claims the contract
// (this kernel, and checkpoint/exp/canonical-json with its delegating sites) runs these same cases.
// ok: the exact canonical text. refuse: the error code the value must be refused with.
const deep = (n) => { let v = 1; for (let i = 0; i < n; i += 1) v = [v]; return v; };
const BS = '\\'; // one backslash, so the expected texts below read literally

export const CONTRACT_ID = 'canonical-json@1';

export const CASES = [
  // scalars
  { name: 'null', make: () => null, ok: 'null' },
  { name: 'booleans', make: () => [true, false], ok: '[true,false]' },
  { name: 'strings with escapes', make: () => 'e\u2028"\\\n\t\u0007\u{1F600}', ok: `"e\u2028${BS}"${BS}${BS}${BS}n${BS}t${BS}u0007\u{1F600}"` },
  { name: 'non-ASCII passes through unescaped', make: () => '\u00e9\u{1F600}', ok: '"\u00e9\u{1F600}"' },
  { name: 'lone surrogate is escaped, never emitted raw', make: () => '\ud800', ok: `"${BS}ud800"` },
  { name: 'number text is the shortest round-trip form', make: () => [1e21, 1e-7, 5e-324, 0.1 + 0.2, 2 ** 53, 1.5, -2], ok: '[1e+21,1e-7,5e-324,0.30000000000000004,9007199254740992,1.5,-2]' },
  { name: 'empty containers', make: () => [{}, []], ok: '[{},[]]' },
  // -0 folds to 0
  { name: '-0 folds to 0', make: () => -0, ok: '0' },
  { name: '-0 in an array folds to 0', make: () => [-0], ok: '[0]' },
  { name: '-0 in an object folds to 0', make: () => ({ a: -0 }), ok: '{"a":0}' },
  // numbers that are not JSON
  { name: 'NaN is refused', make: () => NaN, refuse: 'NON_FINITE' },
  { name: 'Infinity is refused', make: () => Infinity, refuse: 'NON_FINITE' },
  { name: '-Infinity is refused', make: () => -Infinity, refuse: 'NON_FINITE' },
  { name: 'NaN inside an object is refused', make: () => ({ a: NaN }), refuse: 'NON_FINITE' },
  // values that are not JSON
  { name: 'undefined is refused', make: () => undefined, refuse: 'NOT_JSON' },
  { name: 'undefined object field is refused, not dropped', make: () => ({ a: undefined }), refuse: 'NOT_JSON' },
  { name: 'undefined array element is refused, not nulled', make: () => [undefined], refuse: 'NOT_JSON' },
  { name: 'function is refused', make: () => () => 1, refuse: 'NOT_JSON' },
  { name: 'function field is refused', make: () => ({ f() {} }), refuse: 'NOT_JSON' },
  { name: 'symbol is refused', make: () => Symbol('x'), refuse: 'NOT_JSON' },
  { name: 'BigInt is refused', make: () => 10n, refuse: 'NOT_JSON' },
  { name: 'BigInt field is refused', make: () => ({ a: 10n }), refuse: 'NOT_JSON' },
  { name: 'Date is refused, not printed as {}', make: () => new Date(0), refuse: 'NOT_JSON' },
  { name: 'Date field is refused', make: () => ({ d: new Date(0) }), refuse: 'NOT_JSON' },
  { name: 'Map is refused', make: () => new Map([['a', 1]]), refuse: 'NOT_JSON' },
  { name: 'Set is refused', make: () => new Set([1]), refuse: 'NOT_JSON' },
  { name: 'Uint8Array is refused, not printed as {"0":1}', make: () => new Uint8Array([1, 2]), refuse: 'NOT_JSON' },
  { name: 'Float64Array field is refused', make: () => ({ u: new Float64Array([1.5]) }), refuse: 'NOT_JSON' },
  { name: 'boxed Number is refused', make: () => new Number(5), refuse: 'NOT_JSON' },
  { name: 'class instance is refused', make: () => new (class P { constructor() { this.a = 1; } })(), refuse: 'NOT_JSON' },
  // arrays
  { name: 'sparse array is refused', make: () => [1, , 3], refuse: 'SPARSE_ARRAY' }, // eslint-disable-line no-sparse-arrays
  { name: 'new Array(2) is refused', make: () => new Array(2), refuse: 'SPARSE_ARRAY' },
  { name: 'array with a named property is refused, not silently shortened', make: () => { const a = [1]; a.extra = 2; return a; }, refuse: 'NOT_JSON' },
  { name: 'array with a symbol property is refused', make: () => { const a = [1]; a[Symbol('s')] = 2; return a; }, refuse: 'NOT_JSON' },
  { name: 'array with a foreign prototype is refused', make: () => Object.setPrototypeOf([], {}), refuse: 'NOT_JSON' },
  { name: 'array element behind a getter is refused', make: () => { const a = []; Object.defineProperty(a, 0, { get: () => 1, enumerable: true }); return a; }, refuse: 'NOT_JSON' },
  // objects
  { name: 'object with a symbol key is refused, not shortened', make: () => ({ a: 1, [Symbol('k')]: 2 }), refuse: 'NOT_JSON' },
  { name: 'object with a getter is refused', make: () => ({ get g() { return 1; } }), refuse: 'NOT_JSON' },
  { name: 'object with a non-enumerable field is refused, not shortened', make: () => { const o = { a: 1 }; Object.defineProperty(o, 'h', { value: 2, enumerable: false }); return o; }, refuse: 'NOT_JSON' },
  { name: 'null-prototype object is plain', make: () => Object.assign(Object.create(null), { a: 1 }), ok: '{"a":1}' },
  { name: 'own __proto__ data key is data', make: () => JSON.parse('{"__proto__":1,"a":2}'), ok: '{"__proto__":1,"a":2}' },
  { name: 'keys sort by UTF-16 code unit, integer-like keys included', make: () => ({ b: 1, a: { d: 1, c: 2 }, 10: 1, 9: 2 }), ok: '{"10":1,"9":2,"a":{"c":2,"d":1},"b":1}' },
  { name: 'key order is UTF-16, not code point', make: () => ({ '\u{1F600}': 1, '\uffff': 2, '\u00e9': 3, z: 4 }), ok: '{"z":4,"\u00e9":3,"\u{1F600}":1,"\uffff":2}' },
  { name: 'empty and escaped keys', make: () => ({ '': 1, 'a"b': 2 }), ok: `{"":1,"a${BS}"b":2}` },
  // structure
  { name: 'shared (acyclic) references are fine', make: () => { const s = { x: 1 }; return { a: s, b: s }; }, ok: '{"a":{"x":1},"b":{"x":1}}' },
  { name: 'object cycle is refused', make: () => { const o = {}; o.o = o; return o; }, refuse: 'CYCLE' },
  { name: 'array cycle is refused', make: () => { const a = []; a.push(a); return a; }, refuse: 'CYCLE' },
  { name: 'depth 256 is accepted', make: () => deep(256), ok: '['.repeat(256) + '1' + ']'.repeat(256) },
  { name: 'depth 257 is refused', make: () => deep(257), refuse: 'VALUE_DEPTH' },
  { name: 'depth 20000 is refused by the limit, not by a stack overflow', make: () => deep(20000), refuse: 'VALUE_DEPTH' },
];
