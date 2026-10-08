import test from 'node:test';
import assert from 'node:assert/strict';
import {
  basicCapabilities, vectorAdd, vectorSubtract, vectorScale, vectorDivide, dot, cross,
  norm, l1Norm, infinityNorm, distance, normalize, project, matrixAdd, matrixScale,
  transpose, matrixMultiply, matvec, identity, rotate2D, rotate3D, transform2D,
  transform3D, applyTransform,
} from '../../src/linalg/basics.mjs';

const close = (actual, expected, tolerance = 1e-12) => {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, index) => close(actual[index], value, tolerance));
  } else {
    assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} not close to ${expected}`);
  }
};

function clone(value) { return structuredClone(value); }
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test('independent vector fixtures and geometric invariants', () => {
  assert.deepEqual(vectorAdd([1,2,3], [4,-2,1]), [5,0,4]);
  assert.deepEqual(vectorSubtract([4,2,1], [1,5,1]), [3,-3,0]);
  assert.deepEqual(vectorScale([2,-3], 2.5), [5,-7.5]);
  assert.deepEqual(vectorDivide([6,-3], 3), [2,-1]);
  assert.equal(dot([1,2,3], [4,-5,6]), 12);
  assert.deepEqual(cross([1,0,0], [0,1,0]), [0,0,1]);
  assert.equal(norm([3,4]), 5);
  close(norm([1e200,1e200]), Math.SQRT2 * 1e200, 1e-15);
  assert.equal(l1Norm([-3,4]), 7);
  assert.equal(infinityNorm([-3,4]), 4);
  assert.equal(distance([1,2], [4,6]), 5);
  close(normalize([3,4]), [0.6,0.8]);
  assert.deepEqual(normalize([1e-320]), [1]);
  assert.deepEqual(project([3,4], [1,0]), [3,0]);
  close(rotate2D([1,0], Math.PI / 2), [0,1]);
  close(rotate3D([1,0,0], [0,0,2], Math.PI / 2), [0,1,0]);
  close(rotate2D([3,4], 0.8).reduce((s, x) => s + x*x, 0), 25);
});

test('independent matrix and homogeneous-transform fixtures', () => {
  assert.deepEqual(matrixAdd([[1,2],[3,4]], [[-1,2],[1,0]]), [[0,4],[4,4]]);
  assert.deepEqual(matrixScale([[1,-2]], 2), [[2,-4]]);
  assert.deepEqual(transpose([[1,2,3],[4,5,6]]), [[1,4],[2,5],[3,6]]);
  assert.deepEqual(matvec([[1,2],[3,4]], [5,6]), [17,39]);
  assert.deepEqual(matrixMultiply([[1,2],[3,4]], [[5,6],[7,8]]), [[19,22],[43,50]]);
  assert.deepEqual(matrixMultiply(identity(3), [[2],[3],[4]]), [[2],[3],[4]]);
  assert.deepEqual(transform2D([5,-2], 0, [2,3]), [[2,0,5],[0,3,-2],[0,0,1]]);
  assert.deepEqual(transform3D([1,2,3], [0,0,0], [2,3,4]), [[2,0,0,1],[0,3,0,2],[0,0,4,3],[0,0,0,1]]);
  close(transform3D([0,0,0], [0,0,Math.PI/2], [1,1,1]), [[0,-1,0,0],[1,0,0,0],[0,0,1,0],[0,0,0,1]]);
  assert.deepEqual(applyTransform([[1,0,5],[0,1,-2],[0,0,1]], [2,3]), [7,1]);
});

test('invalid numbers, shapes, and degenerate operations fail clearly', () => {
  assert.throws(() => vectorAdd([1], [1,2]), /same length/);
  assert.throws(() => vectorScale([1], Infinity), /finite number/);
  assert.throws(() => vectorScale([Number.MAX_VALUE], 2), /non-finite/);
  assert.throws(() => vectorDivide([1], 0), /zero/);
  assert.throws(() => dot([1e308], [1e308]), /non-finite/);
  assert.throws(() => norm([Number.MAX_VALUE, Number.MAX_VALUE]), /non-finite/);
  assert.throws(() => normalize([0,0]), /zero vector/);
  assert.throws(() => project([1,2], [0,0]), /zero vector/);
  assert.throws(() => cross([1,2], [3,4]), /3D/);
  assert.throws(() => transpose([[1,2],[3]]), /rectangular/);
  assert.throws(() => matrixMultiply([[1,2]], [[1,2]]), /match/);
  assert.throws(() => matvec([[1,2]], [1]), /column count/);
  assert.throws(() => rotate3D([1,0,0], [0,0,0], 1), /zero vector/);
  assert.throws(() => applyTransform([[1,0,0],[0,1,0],[0,0,0]], [1,2]), /w=0/);
  assert.throws(() => vectorAdd(Array(2), [1,2]), /finite number/);
  assert.throws(() => transpose([[1,2], ,]), /rectangular/);
});

test('direct operations do not mutate inputs and work when frozen', () => {
  const vector = deepFreeze([1,2,3]);
  const matrix = deepFreeze([[1,2],[3,4]]);
  assert.deepEqual(vectorAdd(vector, [2,3,4]), [3,5,7]);
  assert.deepEqual(matrixMultiply(matrix, identity(2)), matrix);
  assert.deepEqual(vector, [1,2,3]);
  assert.deepEqual(matrix, [[1,2],[3,4]]);
});

test('every descriptor example independently matches and declared calls really execute', () => {
  const byId = new Map(basicCapabilities.map((descriptor) => [descriptor.id, descriptor]));
  assert.equal(byId.size, basicCapabilities.length, 'descriptor IDs must be unique');
  const execute = (descriptor, input, trace = []) => {
    const directCalls = [];
    const result = descriptor.run(input, {
      call(id, childInput) {
        assert.ok(descriptor.dependsOn.includes(id), `${descriptor.id} called undeclared ${id}`);
        directCalls.push(id);
        trace.push(id);
        const child = byId.get(id);
        assert.ok(child, `missing dependency ${id}`);
        return execute(child, childInput, trace).result;
      },
    });
    return { result, directCalls };
  };
  for (const descriptor of basicCapabilities) {
    for (const example of descriptor.examples) {
      const input = clone(example.input);
      const before = clone(input);
      const trace = [];
      const actual = execute(descriptor, input, trace);
      close(actual.result, example.expected, 1e-10);
      assert.deepEqual(input, before, `${descriptor.id} mutated its input`);
      if (descriptor.kind === 'atomic') assert.deepEqual(descriptor.dependsOn, []);
      else {
        for (const dependency of descriptor.dependsOn) assert.ok(actual.directCalls.includes(dependency), `${descriptor.id} declared but did not call ${dependency}`);
      }
    }
  }
});

test('descriptor atom argument binding is independent of caller property order', () => {
  const scale = basicCapabilities.find((item) => item.id === 'linalg.vectorScale');
  assert.deepEqual(scale.run({ scalar: 3, vector: [2,-1] }), [6,-3]);
  const rotate = basicCapabilities.find((item) => item.id === 'linalg.rotate2D');
  close(rotate.run({ angle: Math.PI/2, vector: [1,0] }), [0,1]);
});
