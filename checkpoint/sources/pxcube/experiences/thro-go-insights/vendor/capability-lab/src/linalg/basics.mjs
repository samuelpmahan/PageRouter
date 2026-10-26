// Dependency-free, browser-safe linear algebra primitives and descriptors.

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function finiteResult(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} produced a non-finite result`);
  return value;
}
function cleanZero(value) { return value === 0 ? 0 : value; }

export function vectorInput(vector, label = 'vector') {
  if (!Array.isArray(vector) || vector.length === 0) throw new TypeError(`${label} must be a non-empty array`);
  for (let index = 0; index < vector.length; index += 1) finiteNumber(vector[index], `${label}[${index}]`);
  return vector;
}

export function matrixInput(matrix, label = 'matrix') {
  if (!Array.isArray(matrix) || matrix.length === 0) throw new TypeError(`${label} must be a non-empty array of rows`);
  const columns = Array.isArray(matrix[0]) ? matrix[0].length : 0;
  if (columns === 0) throw new TypeError(`${label} rows must be non-empty arrays`);
  for (let r = 0; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!Array.isArray(row) || row.length !== columns) throw new RangeError(`${label} must be rectangular (row ${r} has the wrong length)`);
    for (let c = 0; c < row.length; c += 1) finiteNumber(row[c], `${label}[${r}][${c}]`);
  }
  return { rows: matrix.length, columns };
}

function sameLength(a, b, label = 'vectors') {
  vectorInput(a, 'a'); vectorInput(b, 'b');
  if (a.length !== b.length) throw new RangeError(`${label} must have the same length`);
}

function vectorResult(values, label) { for (let i = 0; i < values.length; i += 1) finiteResult(values[i], `${label}[${i}]`); return values; }

export function vectorAdd(a, b) { sameLength(a, b); return vectorResult(a.map((v, i) => v + b[i]), 'vector addition'); }
export function vectorSubtract(a, b) { sameLength(a, b); return vectorResult(a.map((v, i) => v - b[i]), 'vector subtraction'); }
export function vectorScale(vector, scalar) {
  vectorInput(vector); finiteNumber(scalar, 'scalar');
  return vectorResult(vector.map((v) => v * scalar), 'vector scaling');
}
export function vectorDivide(vector, scalar) {
  vectorInput(vector); finiteNumber(scalar, 'scalar');
  if (scalar === 0) throw new RangeError('cannot divide a vector by zero');
  return vectorResult(vector.map((v) => v / scalar), 'vector division');
}
export function dot(a, b) {
  sameLength(a, b);
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum = finiteResult(sum + finiteResult(a[i] * b[i], 'dot product'), 'dot product');
  return sum;
}
export function cross(a, b) {
  sameLength(a, b);
  if (a.length !== 3) throw new RangeError('cross product requires 3D vectors');
  return vectorResult([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], 'cross product');
}
export function norm(vector) { vectorInput(vector); return finiteResult(vector.reduce((length, value) => Math.hypot(length, value), 0), 'Euclidean norm'); }
export function l1Norm(vector) { vectorInput(vector); return finiteResult(vector.reduce((sum, value) => finiteResult(sum + Math.abs(value), 'L1 norm'), 0), 'L1 norm'); }
export function infinityNorm(vector) { vectorInput(vector); return vector.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0); }
export function distance(a, b) { return norm(vectorSubtract(a, b)); }
export function normalize(vector) {
  const length = norm(vector);
  if (length === 0) throw new RangeError('cannot normalize the zero vector');
  return vectorDivide(vector, length);
}
export function project(vector, onto) {
  sameLength(vector, onto, 'projection vectors');
  const unit = normalize(onto);
  return vectorScale(unit, dot(vector, unit));
}

export function matrixAdd(a, b) {
  const sa = matrixInput(a, 'a'), sb = matrixInput(b, 'b');
  if (sa.rows !== sb.rows || sa.columns !== sb.columns) throw new RangeError('matrix addition requires equal shapes');
  return a.map((row, r) => row.map((value, c) => finiteResult(value + b[r][c], 'matrix addition')));
}
export function matrixScale(matrix, scalar) {
  matrixInput(matrix); finiteNumber(scalar, 'scalar');
  return matrix.map((row) => row.map((value) => finiteResult(value * scalar, 'matrix scaling')));
}
export function transpose(matrix) {
  const shape = matrixInput(matrix);
  return Array.from({ length: shape.columns }, (_, c) => matrix.map((row) => row[c]));
}
export function matvec(matrix, vector) {
  const shape = matrixInput(matrix); vectorInput(vector);
  if (shape.columns !== vector.length) throw new RangeError('matrix column count must match vector length');
  return matrix.map((row) => dot(row, vector));
}
export function matrixMultiply(a, b) {
  const sa = matrixInput(a, 'a'), sb = matrixInput(b, 'b');
  if (sa.columns !== sb.rows) throw new RangeError('matrix multiplication requires columns of a to match rows of b');
  const bt = transpose(b);
  return a.map((row) => bt.map((column) => dot(row, column)));
}
export function identity(size) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 1000) throw new RangeError('size must be an integer from 1 to 1000');
  return Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => Number(r === c)));
}

export function rotate2D(vector, angle) {
  vectorInput(vector); finiteNumber(angle, 'angle');
  if (vector.length !== 2) throw new RangeError('2D rotation requires a 2D vector');
  const c = Math.cos(angle), s = Math.sin(angle);
  return vectorResult([c * vector[0] - s * vector[1], s * vector[0] + c * vector[1]], '2D rotation');
}
export function rotate3D(vector, axis, angle) {
  vectorInput(vector); vectorInput(axis, 'axis'); finiteNumber(angle, 'angle');
  if (vector.length !== 3 || axis.length !== 3) throw new RangeError('3D rotation requires 3D vector and axis');
  const u = normalize(axis), [x, y, z] = u, c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const rotation = [
    [t*x*x+c, t*x*y-s*z, t*x*z+s*y],
    [t*x*y+s*z, t*y*y+c, t*y*z-s*x],
    [t*x*z-s*y, t*y*z+s*x, t*z*z+c],
  ];
  return matvec(rotation, vector);
}
export function transform2D(translation, rotation, scale) {
  vectorInput(translation, 'translation'); vectorInput(scale, 'scale'); finiteNumber(rotation, 'rotation');
  if (translation.length !== 2 || scale.length !== 2) throw new RangeError('2D transform requires 2D translation and scale');
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return [[c*scale[0], -s*scale[1], translation[0]], [s*scale[0], c*scale[1], translation[1]], [0, 0, 1]].map((row) => vectorResult(row.map(cleanZero), '2D transform'));
}
export function transform3D(translation, rotation, scale) {
  vectorInput(translation, 'translation'); vectorInput(rotation, 'rotation'); vectorInput(scale, 'scale');
  if (translation.length !== 3 || rotation.length !== 3 || scale.length !== 3) throw new RangeError('3D transform requires 3D translation, Euler rotation, and scale');
  // Euler order is XYZ, represented by Rz * Ry * Rx; scale is applied first.
  const [x, y, z] = rotation, cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const r = [
    [cz*cy, cz*sy*sx-sz*cx, cz*sy*cx+sz*sx],
    [sz*cy, sz*sy*sx+cz*cx, sz*sy*cx-cz*sx],
    [-sy*1, cy*sx, cy*cx],
  ];
  const result = r.map((row, i) => [row[0]*scale[0], row[1]*scale[1], row[2]*scale[2], translation[i]]);
  result.push([0, 0, 0, 1]);
  return result.map((row) => vectorResult(row.map(cleanZero), '3D transform'));
}
export function applyTransform(matrix, vector) {
  const shape = matrixInput(matrix); vectorInput(vector);
  if (shape.rows !== shape.columns || ![3, 4].includes(shape.rows) || vector.length !== shape.rows - 1) {
    throw new RangeError('applyTransform requires a 3x3/2D or 4x4/3D homogeneous matrix and matching point');
  }
  const transformed = matvec(matrix, [...vector, 1]);
  const w = transformed[transformed.length - 1];
  if (w === 0) throw new RangeError('transformed homogeneous coordinate has w=0');
  return vectorResult(transformed.slice(0, -1).map((value) => value / w), 'transformed point');
}

const V = (n) => ({ type: 'array', minItems: n, maxItems: n, items: { type: 'number' } });
const M = { type: 'array', minItems: 1, items: { type: 'array', minItems: 1, items: { type: 'number' } } };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const e = (a, b) => ({ input: a, expected: b });
const atom = (name, fn, inputSchema, outputSchema, example, formula, caveats = []) => ({
  id: `linalg.${name}`, title: name, description: `${name} for finite real-valued vectors or matrices.`, kind: 'atomic', dependsOn: [], inputSchema, outputSchema,
  examples: [example], formula, caveats, run: (input) => fn(...Object.keys(inputSchema.properties).map((key) => input[key])),
});
const composed = (name, inputSchema, outputSchema, dependsOn, example, formula, caveats = [], run) => ({
  id: `linalg.${name}`, title: name, description: `${name} composed from declared linear algebra capabilities.`, kind: 'composed', dependsOn: dependsOn.map((id) => `linalg.${id}`), inputSchema, outputSchema,
  examples: [example], formula, caveats, run,
});
const vec2 = V(2), vec3 = V(3), vec = { type: 'array', minItems: 1, items: { type: 'number' } }, scalar = { type: 'number' };
const pairVec = obj({ a: vec, b: vec });

export const basicCapabilities = [
  atom('vectorAdd', vectorAdd, pairVec, vec, e({ a: [1,2], b: [3,4] }, [4,6]), 'a + b'),
  atom('vectorSubtract', vectorSubtract, pairVec, vec, e({ a: [4,6], b: [1,2] }, [3,4]), 'a - b'),
  atom('vectorScale', vectorScale, obj({ vector: vec, scalar }), vec, e({ vector: [2,-1], scalar: 3 }, [6,-3]), 's v'),
  atom('vectorDivide', vectorDivide, obj({ vector: vec, scalar }), vec, e({ vector: [6,-3], scalar: 3 }, [2,-1]), 'v / s', ['Rejects a zero divisor.']),
  atom('dot', dot, pairVec, scalar, e({ a: [1,2,3], b: [4,5,6] }, 32), 'Σ aᵢbᵢ', ['A finite-input calculation that overflows is rejected.']),
  atom('cross', cross, obj({ a: vec3, b: vec3 }), vec3, e({ a: [1,0,0], b: [0,1,0] }, [0,0,1]), 'a × b', ['Defined here only for 3D vectors.']),
  atom('norm', norm, obj({ vector: vec }), scalar, e({ vector: [3,4] }, 5), '√Σvᵢ²', ['Uses Math.hypot to avoid avoidable overflow; result may still exceed the finite-double range.']),
  atom('l1Norm', l1Norm, obj({ vector: vec }), scalar, e({ vector: [-3,4] }, 7), 'Σ|vᵢ|'),
  atom('infinityNorm', infinityNorm, obj({ vector: vec }), scalar, e({ vector: [-3,4] }, 4), 'max |vᵢ|'),
  composed('distance', obj({ a: vec, b: vec }), scalar, ['vectorSubtract','norm'], e({ a: [1,2], b: [4,6] }, 5), '‖a − b‖', [], (input, ctx) => ctx.call('linalg.norm', { vector: ctx.call('linalg.vectorSubtract', { a: input.a, b: input.b }) })),
  composed('normalize', obj({ vector: vec }), vec, ['norm','vectorDivide'], e({ vector: [3,4] }, [0.6,0.8]), 'v / ‖v‖', ['Rejects the zero vector.'], (input, ctx) => {
    const length = ctx.call('linalg.norm', { vector: input.vector });
    if (length === 0) throw new RangeError('cannot normalize the zero vector');
    return ctx.call('linalg.vectorDivide', { vector: input.vector, scalar: length });
  }),
  composed('project', obj({ vector: vec, onto: vec }), vec, ['normalize','dot','vectorScale'], e({ vector: [3,4], onto: [1,0] }, [3,0]), 'projᵤ(v) = (v·û)û, where û = u/‖u‖', ['Rejects a zero projection direction.'], (input, ctx) => {
    const unit = ctx.call('linalg.normalize', { vector: input.onto });
    const coefficient = ctx.call('linalg.dot', { a: input.vector, b: unit });
    return ctx.call('linalg.vectorScale', { vector: unit, scalar: coefficient });
  }),
  atom('matrixAdd', matrixAdd, obj({ a: M, b: M }), M, e({ a: [[1,2]], b: [[3,4]] }, [[4,6]]), 'A + B'),
  atom('matrixScale', matrixScale, obj({ matrix: M, scalar }), M, e({ matrix: [[1,-2]], scalar: 2 }, [[2,-4]]), 'sA'),
  atom('transpose', transpose, obj({ matrix: M }), M, e({ matrix: [[1,2,3],[4,5,6]] }, [[1,4],[2,5],[3,6]]), 'Aᵀ'),
  composed('matvec', obj({ matrix: M, vector: vec }), vec, ['dot'], e({ matrix: [[1,2],[3,4]], vector: [5,6] }, [17,39]), 'A v', [], (input, ctx) => {
    const shape = matrixInput(input.matrix);
    if (shape.columns !== input.vector.length) throw new RangeError('matrix column count must match vector length');
    return input.matrix.map((row) => ctx.call('linalg.dot', { a: row, b: input.vector }));
  }),
  composed('matrixMultiply', obj({ a: M, b: M }), M, ['transpose','dot'], e({ a: [[1,2],[3,4]], b: [[5,6],[7,8]] }, [[19,22],[43,50]]), 'AB, with each entry equal to a row-column dot product', [], (input, ctx) => {
    const aShape = matrixInput(input.a, 'a'), bShape = matrixInput(input.b, 'b');
    if (aShape.columns !== bShape.rows) throw new RangeError('matrix multiplication requires columns of a to match rows of b');
    const columns = ctx.call('linalg.transpose', { matrix: input.b });
    return input.a.map((row) => columns.map((column) => ctx.call('linalg.dot', { a: row, b: column })));
  }),
  atom('identity', identity, obj({ size: { type: 'integer', minimum: 1, maximum: 1000 } }), M, e({ size: 3 }, [[1,0,0],[0,1,0],[0,0,1]]), 'Iₙ'),
  atom('rotate2D', rotate2D, obj({ vector: vec2, angle: scalar }), vec2, e({ vector: [1,0], angle: Math.PI/2 }, [0,1]), '[[cos θ, −sin θ],[sin θ, cos θ]]v', ['Angle is in radians.']),
  composed('rotate3D', obj({ vector: vec3, axis: vec3, angle: scalar }), vec3, ['normalize','matvec'], e({ vector: [1,0,0], axis: [0,0,1], angle: Math.PI/2 }, [0,1,0]), 'Rodrigues axis-angle rotation', ['Angle is in radians; axis must be nonzero.'], (input, ctx) => {
    const [x,y,z] = ctx.call('linalg.normalize', { vector: input.axis }), c = Math.cos(input.angle), s = Math.sin(input.angle), t = 1-c;
    const matrix = [[t*x*x+c,t*x*y-s*z,t*x*z+s*y],[t*x*y+s*z,t*y*y+c,t*y*z-s*x],[t*x*z-s*y,t*y*z+s*x,t*z*z+c]];
    return ctx.call('linalg.matvec', { matrix, vector: input.vector });
  }),
  atom('transform2D', transform2D, obj({ translation: vec2, rotation: scalar, scale: vec2 }), M, e({ translation: [5,-2], rotation: 0, scale: [2,3] }, [[2,0,5],[0,3,-2],[0,0,1]]), 'homogeneous translation · rotation · scale', ['Rotation is radians; scale is applied before rotation.']),
  atom('transform3D', transform3D, obj({ translation: vec3, rotation: vec3, scale: vec3 }), M, e({ translation: [1,2,3], rotation: [0,0,0], scale: [2,3,4] }, [[2,0,0,1],[0,3,0,2],[0,0,4,3],[0,0,0,1]]), 'homogeneous transform with Rz·Ry·Rx; scale is applied first', ['Euler angles are radians in XYZ input order; rotation matrix order is Rz·Ry·Rx.']),
  composed('applyTransform', obj({ matrix: M, vector: vec }), vec, ['matvec'], e({ matrix: [[1,0,5],[0,1,-2],[0,0,1]], vector: [2,3] }, [7,1]), 'homogeneous matrix times [point, 1], followed by division by w', ['Accepts 3×3/2D or 4×4/3D homogeneous matrices; rejects w=0.'], (input, ctx) => {
    const shape = matrixInput(input.matrix);
    if (shape.rows !== shape.columns || ![3,4].includes(shape.rows) || input.vector.length !== shape.rows-1) throw new RangeError('applyTransform requires a 3x3/2D or 4x4/3D homogeneous matrix and matching point');
    vectorInput(input.vector);
    const transformed = ctx.call('linalg.matvec', { matrix: input.matrix, vector: [...input.vector, 1] });
    const w = transformed.at(-1);
    if (w === 0) throw new RangeError('transformed homogeneous coordinate has w=0');
    return vectorResult(transformed.slice(0,-1).map((value) => value / w), 'transformed point');
  }),
];
