"""Build memory from reusable bit-cell, register, and bank declarations.

State is explicit: pass a memory list in, receive a new memory list out.
Reads observe the resulting memory, after the optional selected-word write.
Run this file to exhaust two finite domains and retain a wrong-selection example.
"""

from collections import Counter
from itertools import product
import json
from pathlib import Path

from runtime import describe, run


def make_storage(words=2, width=2):
    """Return the declared memory, computations, and local state schemas."""
    if type(words) is not int or type(width) is not int or min(words, width) < 1:
        raise ValueError("words and width must be positive integers")
    definitions, implementations = {}, {}
    schemas = {"bool": lambda value: type(value) is bool}

    def word_type(bits):
        name = f"word{bits}"
        schemas[name] = lambda value: type(value) is int and 0 <= value < 2**bits
        return name

    def memory_type(count):
        name = f"memory{count}x{width}"
        schemas[name] = lambda value: (
            type(value) is list and len(value) == count
            and all(type(v) is int and 0 <= v < 2**width for v in value)
        )
        return name

    def address_type(count):
        name = f"address{count}"
        schemas[name] = lambda value: type(value) is int and 0 <= value < count
        return name

    def calculation(name, inputs, outputs, implementation, label):
        definitions[name] = dict(kind="calculation", label=label, inputs=inputs,
                                 outputs=outputs, implementation=name)
        implementations[name] = implementation
        return name

    def functional(name, inputs, outputs, steps, returns, label):
        definitions[name] = dict(kind="functionalGuarantee", label=label,
                                 inputs=inputs, outputs=outputs, steps=steps,
                                 returns=returns)
        return name

    bit = word_type(1)
    cell = calculation(
        "storage.bit_cell", {"old": bit, "value": bit, "write": "bool"},
        {"word": bit}, lambda old, value, write: {"word": value if write else old},
        "Bit cell: select the incoming bit when writing; otherwise retain state",
    )

    def register(bits):
        name = f"storage.register{bits}"
        if name in definitions:
            return name
        word = word_type(bits)
        ports = {"old": word, "value": word, "write": "bool"}
        if bits == 1:
            steps = [{"id": "cell", "use": cell,
                      "bind": {port: f"$input.{port}" for port in ports}}]
            returns = {"word": "cell.word"}
        else:
            high_word = word_type(bits - 1)
            split = calculation(
                f"storage.split_word{bits}", {"old": word, "value": word},
                {"old_low": bit, "new_low": bit,
                 "old_high": high_word, "new_high": high_word},
                lambda old, value: {"old_low": old & 1, "new_low": value & 1,
                                    "old_high": old >> 1, "new_high": value >> 1},
                "Separate the lowest bit from the remaining bits",
            )
            join = calculation(
                f"storage.join_word{bits}", {"low": bit, "high": high_word},
                {"word": word}, lambda low, high: {"word": low | (high << 1)},
                "Assemble the selected bits into one word",
            )
            steps = [
                {"id": "split", "use": split,
                 "bind": {"old": "$input.old", "value": "$input.value"}},
                {"id": "low", "use": register(1),
                 "bind": {"old": "split.old_low", "value": "split.new_low",
                          "write": "$input.write"}},
                {"id": "high", "use": register(bits - 1),
                 "bind": {"old": "split.old_high", "value": "split.new_high",
                          "write": "$input.write"}},
                {"id": "join", "use": join,
                 "bind": {"low": "low.word", "high": "high.word"}},
            ]
            returns = {"word": "join.word"}
        return functional(name, ports, {"word": word}, steps, returns,
                          "Register: recursively compose cells with one write signal")

    def bank(count):
        name = f"storage.bank{count}x{width}"
        if name in definitions:
            return name
        memory, address, word = memory_type(count), address_type(count), word_type(width)
        ports = {"memory": memory, "address": address, "value": word, "write": "bool"}
        if count == 1:
            unpack = calculation(
                f"storage.unpack{width}", {"memory": memory}, {"word": word},
                lambda memory: {"word": memory[0]}, "Unpack the single stored word",
            )
            pack = calculation(
                f"storage.pack{width}", {"word": word}, {"memory": memory, "read": word},
                lambda word: {"memory": [word], "read": word},
                "Return the updated state and read that resulting word",
            )
            steps = [
                {"id": "unpack", "use": unpack, "bind": {"memory": "$input.memory"}},
                {"id": "register", "use": register(width),
                 "bind": {"old": "unpack.word", "value": "$input.value", "write": "$input.write"}},
                {"id": "pack", "use": pack, "bind": {"word": "register.word"}},
            ]
            returns = {"memory": "pack.memory", "read": "pack.read"}
        else:
            left, right = count // 2, count - count // 2
            route = calculation(
                f"storage.route{count}x{width}",
                {"memory": memory, "address": address, "write": "bool"},
                {"left_memory": memory_type(left), "right_memory": memory_type(right),
                 "left_address": address_type(left), "right_address": address_type(right),
                 "left_write": "bool", "right_write": "bool"},
                lambda memory, address, write: {
                    "left_memory": memory[:left], "right_memory": memory[left:],
                    "left_address": address % left, "right_address": (address - left) % right,
                    "left_write": write and address < left,
                    "right_write": write and address >= left,
                },
                "Route the address and enable writing in exactly its selected bank",
            )
            join = calculation(
                f"storage.join_bank{count}x{width}",
                {"left_memory": memory_type(left), "right_memory": memory_type(right),
                 "left_read": word, "right_read": word, "address": address},
                {"memory": memory, "read": word},
                lambda left_memory, right_memory, left_read, right_read, address: {
                    "memory": left_memory + right_memory,
                    "read": left_read if address < left else right_read,
                },
                "Join both resulting banks and read the addressed word",
            )
            steps = [{"id": "route", "use": route,
                      "bind": {port: f"$input.{port}" for port in ("memory", "address", "write")}}]
            for side, size in (("left", left), ("right", right)):
                steps.append({"id": side, "use": bank(size), "bind": {
                    "memory": f"route.{side}_memory", "address": f"route.{side}_address",
                    "write": f"route.{side}_write", "value": "$input.value",
                }})
            steps.append({"id": "join", "use": join, "bind": {
                "left_memory": "left.memory", "right_memory": "right.memory",
                "left_read": "left.read", "right_read": "right.read", "address": "$input.address",
            }})
            returns = {"memory": "join.memory", "read": "join.read"}
        return functional(name, ports, {"memory": memory, "read": word}, steps, returns,
                          "Memory: selected-word write; read observes the resulting memory")

    raw_bank = bank(words)
    ports = definitions[raw_bank]["inputs"]
    outputs = definitions[raw_bank]["outputs"]

    def validate(memory, address, value, write, updated_memory, read):
        observed = {"memory": updated_memory, "read": read}
        wanted = expected(memory, address, value, write)
        if observed != wanted:
            raise ValueError(f"memory semantics mismatch: expected {wanted}, actual {observed}")
        return observed

    validation = calculation(
        f"storage.validate{words}x{width}",
        {**ports, "updated_memory": outputs["memory"], "read": outputs["read"]},
        outputs, validate,
        "Validate selected-word write, retention of every other word, and resulting-state read",
    )
    capability = functional(
        f"storage.memory{words}x{width}", ports, outputs,
        [{"id": "bank", "use": raw_bank,
          "bind": {port: f"$input.{port}" for port in ports}},
         {"id": "validate", "use": validation,
          "bind": {**{port: f"$input.{port}" for port in ports},
                   "updated_memory": "bank.memory", "read": "bank.read"}}],
        {"memory": "validate.memory", "read": "validate.read"},
        "Validated memory: selected-word write; read observes the resulting memory",
    )
    return capability, definitions, implementations, schemas


def storage_features(definition_id, definitions):
    """Count instantiated declarations, including repeated uses of a definition."""
    counts = Counter()

    def visit(name):
        counts[name] += 1
        for step in definitions[name].get("steps", []):
            visit(step["use"])

    visit(definition_id)
    words = sum(count for name, count in counts.items() if name.startswith("storage.bank1x"))
    bits = counts["storage.bit_cell"]
    return {"words": words, "bits_per_word": bits // words, "capacity_bits": bits,
            "functional_instances": sum(count for name, count in counts.items()
                                        if definitions[name]["kind"] == "functionalGuarantee"),
            "calculation_instances": sum(count for name, count in counts.items()
                                         if definitions[name]["kind"] == "calculation"),
            "description": definitions[definition_id]["label"],
            "input_parts": definitions[definition_id]["inputs"],
            "output_parts": definitions[definition_id]["outputs"],
            "evidence_limit": "counts come from composition; operation claims need the behavioral checks"}


def expected(memory, address, value, write):
    """Independent whole-word specification; it does not use cell/bank routing."""
    result = [value if write and index == address else old for index, old in enumerate(memory)]
    return {"memory": result, "read": result[address]}


def probe():
    name, definitions, implementations, schemas = make_storage(2, 2)
    inputs = {"memory": [0, 0], "address": 0, "value": 1, "write": True}
    route_id = "storage.route2x2"
    original_route = implementations[route_id]

    def wrong_selection(**arguments):
        routed = original_route(**arguments)
        routed["left_write"], routed["right_write"] = routed["right_write"], routed["left_write"]
        return routed

    mutant_implementations = {**implementations, route_id: wrong_selection}
    wanted = expected(**inputs)
    raw_bank = "storage.bank2x2"
    raw_correct = run(raw_bank, inputs, definitions=definitions,
                      implementations=implementations, schemas=schemas)
    assert raw_correct["outputs"] == wanted
    mutant = run(raw_bank, inputs, definitions=definitions,
                 implementations=mutant_implementations, schemas=schemas)
    # First check: the same declarations and valid primitive values can still be wrong.
    assert mutant["outputs"] != wanted
    assert mutant["outputs"] == {"memory": [0, 1], "read": 0}
    rejection = None
    try:
        run(name, inputs, definitions=definitions,
            implementations=mutant_implementations, schemas=schemas)
    except ValueError as error:
        rejection = str(error)
    assert rejection is not None and "memory semantics mismatch" in rejection
    corrected = run(name, inputs, definitions=definitions, implementations=implementations, schemas=schemas)
    assert corrected["outputs"] == wanted
    assert inputs["memory"] == [0, 0], "Input state must remain unchanged"

    observations = []
    for words, width in ((2, 2), (4, 2)):
        name, definitions, implementations, schemas = make_storage(words, width)
        features = storage_features(name, definitions)
        assert features["words"] == words and features["capacity_bits"] == words * width
        checked = 0
        for state in product(range(2**width), repeat=words):
            for address, value, write in product(range(words), range(2**width), (False, True)):
                inputs = dict(memory=list(state), address=address, value=value, write=write)
                result = run(name, inputs, definitions=definitions,
                             implementations=implementations, schemas=schemas)
                assert result["outputs"] == expected(**inputs), (inputs, result["outputs"])
                assert inputs["memory"] == list(state), "Input state changed"
                checked += 1
        observations.append({"configuration": f"{words} words x {width} bits", "cases": checked,
                             "features_from_composition": features,
                             "distinct_definitions": len(definitions),
                             "compiled_calculation_order": result["order"],
                             "result": "every state, address, value and write flag matched"})

    return {
        "question": "Can one parameterized declaration derive executable memory and its feature description without hand-defining each bit?",
        "prediction": "Yes, for this bounded memory model; declarations alone will not prove its semantics.",
        "observations": observations,
        "failures": [{
            "mutation": "Swap the two bank write signals; keep every declaration and schema unchanged",
            "input": {"memory": [0, 0], "address": 0, "value": 1, "write": True},
            "expected": wanted, "actual": mutant["outputs"],
            "primitive_checks": "All values satisfied their declared schemas",
            "because": "Both write signals remain booleans, but they select the wrong stored word.",
            "try": "Compose independent whole-word validation on the returned path to reject the mutant; restore address-directed write selection for a usable result.",
            "validated_composition_rejection": rejection,
            "corrected": corrected["outputs"],
        }],
        "checks": {"mutant_caught_before_correct_case": True, "correct_case_passed": True,
                   "raw_bank_successful": raw_correct["outputs"] == wanted,
                   "raw_bank_admitted_schema_valid_mutant": mutant["outputs"] != wanted,
                   "wrong_mutant_rejected_by_composition": rejection is not None,
                   "exhaustive_cases": sum(item["cases"] for item in observations),
                   "inputs_preserved": True,
                   "command": "python3 outputs/capability-lab/storage.py"},
        "declaration_example": describe("storage.memory2x2", make_storage(2, 2)[1]),
        "limitations": [
            "State is an explicit Python list passed between calls; persistent storage is not implemented.",
            "The atomic selection calculation is a pure Python bit selector, not a physical gate circuit.",
            "Only 2x2 and 4x2 configurations have exhaustive behavioral evidence.",
            "No clock timing, concurrent access, reset, or power-loss behavior is modeled.",
            "Feature counts follow the declaration; semantic operation claims are justified by the finite checks.",
        ],
    }


if __name__ == "__main__":
    report = probe()
    destination = Path(__file__).with_name("storage-report.json")
    destination.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(destination), "checks": report["checks"]}, indent=2))
