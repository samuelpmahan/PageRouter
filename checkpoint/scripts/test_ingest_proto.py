"""CLI checks for staging, bound execution, and pre-execution rejection."""
import json
from pathlib import Path
import subprocess
import sys
import unittest


CLI = Path(__file__).with_name("ingest-proto.py")
TEST_ROOT = CLI.parents[1]


class IngestProtoCLITests(unittest.TestCase):
    def call(self, *args):
        process = subprocess.run([sys.executable, str(CLI), *map(str, args)],
                                 capture_output=True, text=True)
        return process.returncode, json.loads(process.stdout)

    def test_unbound_and_bound_cpu(self):
        code, staged = self.call("cpu")
        self.assertEqual(code, 0)
        self.assertEqual(staged["status"], "PARTIAL")
        self.assertEqual([x["slot"] for x in staged["frontier"]], ["execute", "validate"])
        inputs = TEST_ROOT / ".test-ingest-inputs.json"
        try:
            inputs.write_text(json.dumps({"state": {"A": 7, "PC": 0, "OUT": 0,
                "HALT": 0, "RAM": [0] * 16}, "program": [0x13] + [0] * 15,
                "inputByte": 0}))
            code, accepted = self.call("cpu", "--provider", "cpu.gates", "--inputs", inputs)
            self.assertEqual(code, 0)
            self.assertEqual(accepted["status"], "ACCEPT")
            self.assertEqual(accepted["acceptedOutputs"]["state"]["A"], 3)
            self.assertEqual(accepted["readOnly"]["status"], "PASS")
            self.assertLess(accepted["order"].index("capability/observe/result/calc"),
                            accepted["order"].index("capability/validate/invoke/result/calc"))
        finally:
            inputs.unlink(missing_ok=True)

    def test_forbidden_declared_write_rejected_before_execution(self):
        proto = TEST_ROOT / ".test-ingest-proto.json"
        try:
            proto.write_text(json.dumps({"address": "proto/cpu/step", "as": "calculation",
                "interface": {"inputs": {"state": "CpuState", "program": "Program16",
                    "inputByte": "Byte"}, "outputs": {"state": "CpuState"}},
                "slots": {"execute": {"mode": "abstract", "binding": None},
                    "validate": {"mode": "overridable", "binding": None},
                    "observe": {"mode": "final", "binding": "cpu.observe"}},
                "validatorEffects": {"binding": "cpu.validate.integer",
                    "reads": ["invoke.$input.candidate"],
                    "writes": ["invoke.$input.candidate"]}}))
            code, rejected = self.call(proto, "--provider", "cpu.gates")
            self.assertEqual(code, 1)
            self.assertEqual(rejected["status"], "LINT_REJECT")
            self.assertIsNone(rejected["acceptedOutputs"])
        finally:
            proto.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
