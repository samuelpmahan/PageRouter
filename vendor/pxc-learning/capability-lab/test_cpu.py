"""Bounded CPU capability checks; run with python test_cpu.py."""
import unittest

from cpu import probe


class CpuCapabilityTests(unittest.TestCase):
    def test_step_capability_and_rejected_providers(self):
        report = probe()
        self.assertEqual(report["failures"], [])
        self.assertTrue(all(check["passed"] for check in report["checks"]))
        self.assertEqual(report["observations"]["opcodeCoverage"], list(range(16)))
        self.assertGreaterEqual(report["observations"]["casesCompared"], 24)
        self.assertEqual(
            {row["case"] for row in report["observations"]["rejections"]},
            {"wrong-pc", "missing-out", "missing-output-port"},
        )


if __name__ == "__main__":
    unittest.main()
