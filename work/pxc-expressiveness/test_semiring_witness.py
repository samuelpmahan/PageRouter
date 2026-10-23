"""Minimal executable expressiveness probe, not a claim about PxC's current implementation.

Run: python3 -m unittest discover -s work/pxc-expressiveness -p 'test_*.py'
"""
import unittest

def evaluate(expr, values, plus, times, zero, one):
    if isinstance(expr, str):
        return values.get(expr, zero)
    op, *args = expr
    if op == "or":
        result = zero
        for arg in args:
            result = plus(result, evaluate(arg, values, plus, times, zero, one))
        return result
    if op == "and":
        result = one
        for arg in args:
            result = times(result, evaluate(arg, values, plus, times, zero, one))
        return result
    raise ValueError(op)

# R = (a*b + c)*d. Expression is a derivation witness, not a cached scalar.
R = ("and", ("or", ("and", "a", "b"), "c"), "d")

class ExpressivenessWitness(unittest.TestCase):
    def test_alternative_derivation_survives(self):
        algebra = (lambda a,b: a or b, lambda a,b: a and b, False, True)
        self.assertTrue(evaluate(R, dict(a=False,b=True,c=True,d=True), *algebra))
        self.assertFalse(evaluate(R, dict(a=False,b=True,c=False,d=True), *algebra))

    def test_same_derivation_different_semiring(self):
        boolean = (lambda a,b: a or b, lambda a,b: a and b, False, True)
        natural = (lambda a,b: a+b, lambda a,b: a*b, 0, 1)
        self.assertTrue(evaluate(R, dict.fromkeys("abcd", True), *boolean))
        self.assertEqual(evaluate(R, dict.fromkeys("abcd", 1), *natural), 2)

    def test_joint_dependency(self):
        natural = (lambda a,b: a+b, lambda a,b: a*b, 0, 1)
        self.assertEqual(evaluate(R, dict(a=1,b=0,c=0,d=1), *natural), 0)
        self.assertEqual(evaluate(R, dict(a=1,b=1,c=0,d=1), *natural), 1)

if __name__ == "__main__":
    unittest.main()
