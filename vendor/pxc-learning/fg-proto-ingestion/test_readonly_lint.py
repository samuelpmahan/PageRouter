from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import proto_adapter
from proto_adapter import bind_proto, cpu_proto, ingest, integer_step, source_hashes
from readonly_lint import compile_readonly
from readonly import check, verdict


def example():
    return {"state": {"A": 7, "PC": 0, "OUT": 0, "HALT": 0, "RAM": [0] * 16},
            "program": [0x13] + [0] * 15, "inputByte": 0}


def declared(binding="cpu.report", **changes):
    return {"binding": binding, "reads": ["invoke.$input.candidate"], "writes": [], **changes}


class ReadOnlyLintTests(unittest.TestCase):
    evidence = {"cases": [], "limits": ["Effect metadata is a claim, not source-to-effects proof."]}

    @classmethod
    def setUpClass(cls):
        cls.before = source_hashes()

    @classmethod
    def tearDownClass(cls):
        cls.evidence.update(sourceHashes=cls.before, originalSourcesUnchanged=cls.before == source_hashes())
        cls.evidence["adapterSourceHashes"] = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
            for name in ("readonly_lint.py", "proto_adapter.py", "test_readonly_lint.py", "readonly.py")}
        Path(__file__).with_name("readonly-lint-evidence.json").write_text(json.dumps(cls.evidence, indent=2) + "\n")

    def altered(self, change, effects=None):
        counters = {"execute": 0, "validate": 0}

        def execute(**arguments):
            counters["execute"] += 1
            return integer_step(**arguments)

        def validate(**arguments):
            counters["validate"] += 1
            return {"report": deepcopy(arguments["candidate"])}

        proto = bind_proto(cpu_proto(), "cpu.counted", validate="cpu.report")
        if effects is not None:
            proto["validatorEffects"] = effects
        lint = proto_adapter.compile_readonly

        def altered_lint(definitions, root, rules):
            change(definitions)
            return lint(definitions, root, rules)

        with patch.object(proto_adapter, "compile_readonly", altered_lint):
            result = ingest(proto, example(), implementations={"cpu.counted": execute, "cpu.report": validate})
        return result, counters

    def record(self, name, result, **extra):
        self.evidence["cases"].append({"case": name, **extra, **result})

    def test_normal_engines_have_native_preflight_and_explicit_effect_frontier(self):
        for engine in ("cpu.gates", "cpu.integer"):
            result = ingest(bind_proto(cpu_proto(), engine), example())
            self.assertEqual(result["status"], "ACCEPT")
            lint = result["compileLint"]
            self.assertEqual(lint["outputs"]["verdict"]["status"], "PARTIAL")
            self.assertEqual(lint["outputs"]["check"]["violations"], [])
            self.assertIn("ReadOnly.Compile", [item["id"] for item in lint["features"]])
            self.assertEqual(lint["order"][0], "capability/resolve/result/calc")
            self.assertEqual(lint["outputs"]["graph"]["nodes"]["capability"]["outputs"]["state"]["origin"],
                             "capability/transition/ports/state")
            self.record("normal-" + engine, result)

    def test_legal_replacement_port_is_banned_before_target_execution(self):
        def replace(definitions):
            definitions["Validation.Invoke"]["outputs"]["state"] = "CpuState"
            definitions["ReadOnlyValidation"]["outputs"]["state"] = "CpuState"
            definitions["ReadOnlyValidation"]["returns"]["state"] = "invoke.state"
            definitions["Cpu.Step"]["returns"]["state"] = "validate.state"
        result, counters = self.altered(replace, declared())
        self.assertEqual(result["status"], "LINT_REJECT")
        self.assertEqual(counters, {"execute": 0, "validate": 0})
        self.assertIsNone(result["acceptedOutputs"])
        violation = result["compileLint"]["outputs"]["check"]["violations"][0]
        self.assertEqual(violation["actual"], "capability/validate/invoke/ports/state")
        # This is a legal native graph when the new lint is omitted, not merely
        # a missing output already forbidden by the old linker.
        definitions = result["compileLint"]["inputParts"]["request/definitions"]
        proto = result["proto"]
        inputs = {**example(), "contractRef": proto,
                  **{name + "Ref": {"address": "implementation/" + slot["binding"], "key": slot["binding"]}
                     for name, slot in proto["slots"].items()}}
        schemas = proto_adapter.make_cpu()[3]
        schemas.update({name: lambda value: type(value) is dict for name in
            ("ImplementationRef", "ProtoDefinition", "BoundaryObservation", "ValidationEffects", "ReadOnlyOutcome", "ValidationOutcome")})

        def invoke(**arguments):
            return {"effects": {"before": deepcopy(arguments), "after": deepcopy(arguments),
                                "reported": {}, "validation": {"status": "ACCEPT"}},
                    "state": {**deepcopy(arguments["candidate"]), "PC": 2}}

        unchecked = proto_adapter.run("Cpu.Step", inputs, definitions=definitions, schemas=schemas,
            implementations={"cpu.transition": lambda executeRef, **args: integer_step(**args),
                             "cpu.observe": lambda **args: {"observation": deepcopy(args)},
                             "validation.invoke": invoke, "readonly.check": check, "validation.verdict": verdict})
        self.assertEqual(unchecked["outputs"]["state"]["PC"], 2)
        self.record("legal-port-forbidden-producer", result, counters=counters, uncheckedNative=unchecked)

    def test_forwarded_outputs_resolve_to_leaf_not_step_or_port_name(self):
        def nested(definitions):
            definitions["Validation.Invoke"]["outputs"]["state"] = "CpuState"
            definitions["ReadOnlyValidation"]["outputs"]["state"] = "CpuState"
            definitions["ReadOnlyValidation"]["returns"]["state"] = "invoke.state"
            for level, child in (("One", "ReadOnlyValidation"), ("Two", "One")):
                wrapped = deepcopy(definitions[child])
                wrapped["steps"] = [{"id": "transition", "use": child,
                    "bind": {name: "$input." + name for name in wrapped["inputs"]}}]
                wrapped["returns"] = {name: "transition." + name for name in wrapped["outputs"]}
                definitions[level] = wrapped
            definitions["Cpu.Step"]["steps"][2]["use"] = "Two"
            definitions["Cpu.Step"]["returns"]["state"] = "validate.state"
        result, counters = self.altered(nested, declared(reads=["$input.candidate"]))
        self.assertEqual(result["status"], "LINT_REJECT")
        self.assertEqual(counters["execute"], 0)
        origin = result["compileLint"]["outputs"]["graph"]["nodes"]["capability"]["outputs"]["state"]
        self.assertEqual(origin["origin"], "capability/validate/transition/transition/invoke/ports/state")
        self.assertGreater(len(origin["route"]), 3)
        self.record("nested-forwarding-banned", result, counters=counters)

    def test_nested_borrowed_alias_write_is_banned_and_new_report_write_allowed(self):
        def alias(definitions):
            definitions["Alias.Read"] = {"kind": "calculation", "label": "Borrowed alias",
                "inputs": {"renamed": "CpuState"}, "outputs": {"report": "ValidationEffects"}, "implementation": "unused.alias"}
            definitions["ReadOnlyValidation"]["steps"].append({"id": "child", "use": "Alias.Read",
                "bind": {"renamed": "$input.candidate"}})
        rejected, counters = self.altered(alias, declared(writes=["invoke.$output.effects", "child.$input.renamed"]))
        self.assertEqual(rejected["status"], "LINT_REJECT")
        self.assertEqual(counters["validate"], 0)
        self.assertIn("ReadOnly borrowed target", rejected["compileLint"]["outputs"]["check"]["violations"][0]["because"])
        self.record("write-through-renamed-child-input", rejected, counters=counters)

        allowed, counters = self.altered(lambda definitions: None,
                                        declared(writes=["invoke.$output.effects"]))
        self.assertEqual(allowed["status"], "ACCEPT")
        self.assertEqual(allowed["compileLint"]["outputs"]["verdict"]["status"], "PASS")
        self.assertEqual(allowed["effects"]["reported"]["report"]["PC"], 1)
        self.assertEqual(counters, {"execute": 1, "validate": 1})
        self.record("read-and-new-report-allowed", allowed, counters=counters)

    def test_opaque_passthrough_is_a_distinct_producer_even_with_allowed_dependency(self):
        def opaque(definitions):
            definitions["Opaque.Copy"] = {"kind": "calculation", "label": "Opaque state forwarding claim",
                "inputs": {"state": "CpuState"}, "outputs": {"state": "CpuState"}, "implementation": "opaque.copy"}
            definitions["Cpu.Step"]["steps"].append({"id": "proxy", "use": "Opaque.Copy",
                                                    "bind": {"state": "transition.state"}})
            definitions["Cpu.Step"]["returns"]["state"] = "proxy.state"
        result, counters = self.altered(opaque, declared())
        self.assertEqual(result["status"], "LINT_REJECT")
        self.assertEqual(counters, {"execute": 0, "validate": 0})
        violations = result["compileLint"]["outputs"]["check"]["violations"]
        self.assertEqual(violations[0]["actual"], "capability/proxy/ports/state")
        self.assertEqual(violations[0]["expected"], "capability/transition/ports/state")
        self.record("opaque-passthrough-cannot-borrow-producer-identity", result, counters=counters)

    def test_opaque_mutator_has_frontier_then_runtime_reject(self):
        def mutate(**arguments):
            arguments["candidate"]["PC"] = 2
            return {}
        result = ingest(bind_proto(cpu_proto(), "cpu.integer", validate="cpu.opaque"), example(),
                        implementations={"cpu.opaque": mutate})
        self.assertEqual(result["compileLint"]["outputs"]["verdict"]["status"], "PARTIAL")
        self.assertEqual(result["status"], "REJECT")
        self.assertEqual(result["readOnly"]["status"], "REJECT")
        self.record("opaque-runtime-mutation-reject", result)

    def test_false_effect_claim_does_not_prove_mutate_restore_purity(self):
        writes = []
        def restore(**arguments):
            old = arguments["candidate"]["PC"]
            arguments["candidate"]["PC"] = 2
            writes.append("PC temporarily changed")
            arguments["candidate"]["PC"] = old
            return {}
        proto = bind_proto(cpu_proto(), "cpu.integer", validate="cpu.restore")
        proto["validatorEffects"] = declared("cpu.restore")
        result = ingest(proto, example(), implementations={"cpu.restore": restore})
        self.assertEqual(result["status"], "ACCEPT")
        self.assertEqual(result["compileLint"]["outputs"]["verdict"]["status"], "PASS")
        self.assertEqual(result["compileLint"]["outputs"]["check"]["sourceEffectsCompleteness"], "UNVERIFIED")
        self.assertEqual(result["readOnly"]["status"], "PASS")
        self.assertEqual(writes, ["PC temporarily changed"])
        self.record("false-no-writes-claim-retained", result, actualWrites=writes)

    def test_stale_binding_claim_and_missing_effect_reference_are_rejected(self):
        for effects in (declared("cpu.someOtherValidator"), declared(writes=["invoke.$input.notAPort"])):
            result, counters = self.altered(lambda definitions: None, effects)
            self.assertEqual(result["status"], "LINT_REJECT")
            self.assertEqual(counters, {"execute": 0, "validate": 0})
            self.record("stale-or-unresolved-effect-claim", result, counters=counters)

    def test_unresolved_and_recursive_graphs_do_not_claim_resolved_closure(self):
        for change in (
            lambda definitions: definitions["Cpu.Step"]["returns"].update(state="absent.state"),
            lambda definitions: definitions["Cpu.Step"]["steps"][2].update(use="Cpu.Step"),
        ):
            result, counters = self.altered(change, declared())
            self.assertEqual(result["status"], "LINT_REJECT")
            self.assertEqual(counters, {"execute": 0, "validate": 0})
            self.assertEqual(result["compileLint"]["outputs"]["graph"]["status"], "UNRESOLVED")
            self.record("unresolved-graph-stops-target", result, counters=counters)


if __name__ == "__main__":
    unittest.main()
