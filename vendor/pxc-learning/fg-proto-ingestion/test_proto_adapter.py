from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import proto_adapter
from proto_adapter import bind_proto, cpu_proto, ingest, integer_step, source_hashes


def cases():
    state = {"A": 7, "PC": 0, "OUT": 0, "HALT": 0, "RAM": [0] * 16}
    for name, instruction, expected in [
        ("load-literal", 0x13, {"A": 3, "PC": 1}),
        ("store-literal", 0x32, {"PC": 1, "RAM": [0, 0, 7] + [0] * 13}),
        ("out-literal", 0xC0, {"PC": 1, "OUT": 7}),
    ]:
        yield name, {"state": deepcopy(state), "program": [instruction] + [0] * 15, "inputByte": 0}, {**deepcopy(state), **expected}


def wrong_pc(**arguments):
    result = integer_step(**arguments)
    result["state"]["PC"] = (result["state"]["PC"] + 1) % 16
    return result


class ProtoIngestionTests(unittest.TestCase):
    evidence = {"cases": [], "counterexamples": [], "scope": "Declared CPU Proto bound into unchanged native Pipeline"}

    @classmethod
    def setUpClass(cls):
        cls.before = source_hashes()

    @classmethod
    def tearDownClass(cls):
        cls.evidence.update(sourceHashes=cls.before, originalSourcesUnchanged=cls.before == source_hashes())
        cls.evidence["adapterSourceHashes"] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (Path(__file__), Path(__file__).with_name("proto_adapter.py"), Path(__file__).with_name("readonly.py"))}
        Path(__file__).with_name("proto-evidence.json").write_text(json.dumps(cls.evidence, indent=2) + "\n")

    def test_part_unresolved_and_opaque_proto_stages(self):
        part = ingest({"address": "image/state", "as": "part", "value": {"exists": True}, "unknown": "retained"})
        self.assertEqual(part["value"], {"exists": True})
        self.assertEqual(part["proto"]["unknown"], "retained")
        self.assertEqual(part["order"], ["image/state/calc"])
        self.assertEqual(part["declarations"]["image/state/calc"]["inputs"], ("image/state/definition",))
        self.assertEqual(part["log"][0]["rule"], "ingest-Part")
        self.evidence["partLowering"] = part
        proto = cpu_proto()
        proto["unknown"] = {"learning": "do not discard me"}
        staged = ingest(proto)
        self.assertEqual(staged["status"], "PARTIAL")
        self.assertEqual(staged["observations"], [])
        self.assertEqual(staged["proto"], proto)
        opaque = ingest(bind_proto(proto, "opaque/TsJsFunction"))
        self.assertEqual(opaque["status"], "PARTIAL")
        self.evidence["unresolved"] = staged
        self.evidence["opaque"] = opaque

    def test_same_contract_binds_gates_and_integer_native_closure(self):
        for name, inputs, expected in cases():
            rows = []
            for implementation in ("cpu.gates", "cpu.integer"):
                result = ingest(bind_proto(cpu_proto(), implementation), inputs)
                self.assertEqual(result["status"], "ACCEPT")
                self.assertEqual(result["acceptedOutputs"]["state"], expected)
                native = result["native"]
                self.assertLess(native["order"].index("capability/observe/result/calc"),
                                native["order"].index("capability/validate/invoke/result/calc"))
                self.assertIn("capability/validate/readonly/result/calc", native["order"])
                self.assertIn("capability/validate/ports/readOnly", native["declarations"])
                self.assertIn("capability/validate/ports/effects", native["declarations"])
                self.assertNotIn("capability/validate/ports/state", native["declarations"])
                self.assertIn("ReadOnlyValidation", [feature["id"] for feature in native["features"]])
                self.assertEqual(result["readOnly"]["status"], "PASS")
                self.assertIn("capability/observe/result", native["declarations"])
                self.assertIn("request/executeRef", native["declarations"])
                self.assertIn("request/contractRef", native["declarations"])
                self.assertEqual(result["observations"][0]["candidate"], expected)
                self.assertTrue(result["originalSourcesUnchanged"])
                rows.append(result)
            self.evidence["cases"].append({"case": name, "expected": expected, "providers": rows})

    def test_bad_execution_retains_actual_boundary_and_is_rejected(self):
        _, inputs, expected = next(cases())
        result = ingest(bind_proto(cpu_proto(), "cpu.wrongPC", validate="cpu.validate.integer"), inputs,
                        implementations={"cpu.wrongPC": wrong_pc})
        self.assertEqual(result["status"], "REJECT")
        self.assertIsNone(result["acceptedOutputs"])
        self.assertNotEqual(result["observations"][0]["candidate"], expected)
        self.assertEqual(result["observations"][0]["candidate"]["PC"], 2)
        self.assertIn("CPU Step contract mismatch", result["validation"][0]["because"])
        self.evidence["counterexamples"].append({"case": "wrongPC-observed-then-rejected", **result})

    def test_local_final_observer_and_overridable_weak_validation(self):
        with self.assertRaisesRegex(ValueError, "final"):
            bind_proto(cpu_proto(), "cpu.integer", observe="cpu.hideEvidence")
        _, inputs, expected = next(cases())
        result = ingest(bind_proto(cpu_proto(), "cpu.wrongPC", validate="cpu.weak"), inputs,
                        implementations={"cpu.wrongPC": wrong_pc, "cpu.weak": lambda **args: {"state": args["candidate"]}})
        self.assertEqual(result["status"], "ACCEPT")
        self.assertEqual(result["readOnly"]["status"], "PASS")
        mismatch = result["acceptedOutputs"]["state"] != expected
        self.assertTrue(mismatch)
        self.evidence["counterexamples"].append({"case": "weak-validator-accepts-semantic-mismatch",
                                                "independentLiteralMismatch": mismatch, "expected": expected, **result})

    def test_final_slot_bindings_hold_and_optional_bindings_are_retained(self):
        proto = bind_proto(cpu_proto(), "cpu.integer", validate="cpu.weak")
        retained = bind_proto(proto, "cpu.integer")
        self.assertEqual(retained["slots"]["validate"]["binding"], "cpu.weak")
        for name, overrides in [("execute", {"execute": "cpu.gates"}),
                                ("validate", {"execute": "cpu.integer", "validate": "cpu.validate.gates"})]:
            final = deepcopy(proto)
            final["slots"][name]["mode"] = "final"
            with self.assertRaisesRegex(ValueError, name + " slot is final"):
                bind_proto(final, **overrides)
            self.evidence["counterexamples"].append({"case": "final-" + name + "-cannot-rebind",
                                                    "selectedBinding": final["slots"][name]["binding"]})

    def test_validator_cannot_replace_the_observed_transformation(self):
        _, inputs, expected = next(cases())

        def substituting_validator(**arguments):
            proto_adapter.make_cpu("gates")[2]["cpu.validate"](**arguments)
            return {"state": {**deepcopy(arguments["candidate"]), "PC": 2}}

        result = ingest(bind_proto(cpu_proto(), "cpu.integer", validate="cpu.substitute"), inputs,
                        implementations={"cpu.substitute": substituting_validator})
        self.assertEqual(result["status"], "ACCEPT")
        self.assertEqual(result["observations"][0]["candidate"], expected)
        self.assertEqual(result["acceptedOutputs"]["state"], expected)
        self.assertEqual(result["effects"]["reported"]["state"]["PC"], 2)
        self.assertEqual(result["readOnly"]["status"], "PASS")
        self.assertEqual(result["native"]["definition"]["returns"]["state"], "transition.state")
        self.evidence["counterexamples"].append({"case": "substituting-validator-does-not-replace-transition",
            "earlierMistake": "Root returned validate.state, allowing accepted state to differ from observed candidate.",
            **result})

    def test_validator_has_no_authoritative_state_output_port(self):
        _, inputs, _ = next(cases())
        native_run = proto_adapter.run

        def select_forbidden_port(*args, **kwargs):
            kwargs["definitions"]["Cpu.Step"]["returns"]["state"] = "validate.state"
            return native_run(*args, **kwargs)

        with patch.object(proto_adapter, "run", select_forbidden_port):
            result = ingest(bind_proto(cpu_proto(), "cpu.integer"), inputs)
        self.assertEqual(result["status"], "ENGINE_REJECT")
        self.assertIn("missing output validate.state", result["cause"]["because"])
        self.assertIsNone(result["acceptedOutputs"])
        self.evidence["counterexamples"].append({"case": "validator-state-port-is-not-linkable", **result})

    def test_net_borrowed_mutations_reject_without_mutating_upstream(self):
        _, inputs, expected = next(cases())
        supplied_before = deepcopy(inputs)

        def mutating_validator(**arguments):
            arguments["candidate"]["PC"] = 2
            arguments["state"]["RAM"][0] = 255
            arguments["program"][0] = 0
            return {"state": arguments["candidate"]}

        result = ingest(bind_proto(cpu_proto(), "cpu.integer", validate="cpu.mutate"), inputs,
                        implementations={"cpu.mutate": mutating_validator})
        self.assertEqual(result["status"], "REJECT")
        self.assertEqual(result["readOnly"]["status"], "REJECT")
        self.assertEqual(set(result["readOnly"]["changes"]), {"candidate", "state", "program"})
        self.assertEqual(result["observations"][0]["candidate"], expected)
        self.assertEqual(result["native"]["outputs"]["state"], expected)
        self.assertEqual(inputs, supplied_before)
        self.assertIsNone(result["acceptedOutputs"])
        self.evidence["counterexamples"].append({"case": "borrowed-json-net-mutations-rejected", **result})

        def type_mutator(**arguments):
            arguments["candidate"]["PC"] = True
            return {"state": arguments["candidate"]}

        typed = ingest(bind_proto(cpu_proto(), "cpu.integer", validate="cpu.typeMutate"), inputs,
                       implementations={"cpu.typeMutate": type_mutator})
        self.assertEqual(typed["readOnly"]["status"], "REJECT")
        self.assertIs(typed["effects"]["after"]["candidate"]["PC"], True)
        self.evidence["counterexamples"].append({"case": "borrowed-type-change-rejected",
            "because": "Python equates 1 and True; canonical JSON distinguishes the boundary values.", **typed})

    def test_mutate_restore_and_external_effect_remain_visible_limits(self):
        _, inputs, expected = next(cases())
        outside_effects = []

        def restore_validator(**arguments):
            before = arguments["candidate"]["PC"]
            arguments["candidate"]["PC"] = 2
            outside_effects.append("candidate was temporarily changed to PC2")
            arguments["candidate"]["PC"] = before
            return {"state": arguments["candidate"]}

        result = ingest(bind_proto(cpu_proto(), "cpu.integer", validate="cpu.restore"), inputs,
                        implementations={"cpu.restore": restore_validator})
        self.assertEqual(result["status"], "ACCEPT")
        self.assertEqual(result["readOnly"]["status"], "PASS")
        self.assertEqual(result["acceptedOutputs"]["state"], expected)
        self.assertEqual(len(outside_effects), 1)
        self.evidence["counterexamples"].append({"case": "mutate-restore-and-external-effects-unobserved",
            "knownTransientAndExternalEffects": outside_effects,
            "because": "ReadOnly compares net borrowed JSON arguments, not every write or external state.", **result})

    def test_observation_mismatch_is_declared_reject(self):
        _, inputs, _ = next(cases())
        native_run = proto_adapter.run

        def corrupt_boundary(*args, **kwargs):
            supplied = kwargs["implementations"]
            native_observer = supplied["cpu.observe"]

            def broken_observer(**arguments):
                result = native_observer(**arguments)
                result["observation"]["candidate"]["PC"] = 2
                return result

            kwargs["implementations"] = {**supplied, "cpu.observe": broken_observer}
            return native_run(*args, **kwargs)

        with patch.object(proto_adapter, "run", corrupt_boundary):
            result = ingest(bind_proto(cpu_proto(), "cpu.integer"), inputs)
        self.assertEqual(result["status"], "REJECT")
        self.assertIsNone(result["acceptedOutputs"])
        self.assertIn("does not match validation inputs", result["validation"][0]["because"])
        self.assertIn("candidate", result["validation"][0]["mismatches"])
        self.evidence["counterexamples"].append({"case": "injected-observation-mismatch-rejected",
            "earlierMistake": "Validator depended on observation but discarded its value.", **result})

    def test_missing_meaning_reveals_nominal_engine_frontier(self):
        _, inputs, _ = next(cases())
        proto = bind_proto(cpu_proto(), "cpu.integer")
        proto["interface"]["inputs"]["state"] = "StateWithUnresolvedMeaning"
        missing = ingest(proto, inputs)
        self.assertEqual(missing["status"], "ENGINE_REJECT")
        self.assertIsNone(missing["acceptedOutputs"])
        self.assertIn("unknown schema StateWithUnresolvedMeaning", missing["cause"]["because"])
        self.evidence["counterexamples"].append({"case": "missing-named-meaning", **missing})
        incompatible = ingest(proto, inputs, schemas={"StateWithUnresolvedMeaning": lambda value: True})
        self.assertEqual(incompatible["status"], "ENGINE_REJECT")
        self.assertIn("incompatible meanings", incompatible["cause"]["because"])
        self.evidence["counterexamples"].append({"case": "new-name-even-valid-predicate-does-not-infer-link",
                                                **incompatible})


if __name__ == "__main__":
    unittest.main()
