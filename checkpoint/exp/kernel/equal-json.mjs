// Structural equality for JSON data: null, booleans, numbers, strings, arrays
// and plain objects. Object key order does not matter; array order does.
// Numbers and strings compare with ===, so 0 equals -0. Two references to the
// same object are equal without looking inside. The function does not guard
// against cycles: validate with a JSON check first if the input is untrusted.
// Values outside JSON are not given meaning here: Dates, RegExps, Maps and Sets
// are compared by their own enumerable keys only (so two Dates are equal), NaN
// is never equal to NaN, and function values are compared by identity.
function equalJson(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

export { equalJson };
