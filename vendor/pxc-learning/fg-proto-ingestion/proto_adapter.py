"""Bind a small CPU Proto using the existing PxC dependency engine.

Proto is a staged declaration, not an arbitrary-source parser. An abstract slot
is an unbound execution role. Overridable/final are policies of this one chosen
contract: they are not universal fields required on every FunctionalGuarantee.
All imperative work stays in registered Calculation implementations. The
diagnostic validation wrapper retains failure and completes the native graph;
REJECT never supplies acceptedOutputs, even though candidate Parts are retained.
"""
from copy import deepcopy
from dataclasses import asdict
import hashlib
from pathlib import Path
import sys

LAB = Path(__file__).resolve().parents[1] / "capability-lab"
sys.path.insert(0, str(LAB))
from runtime import Pipeline, run
from cpu import make_cpu, gates_step, integer_step
from readonly import make_readonly_validation
from readonly_lint import compile_readonly


def cpu_proto():
    _, definitions, _, _ = make_cpu()
    interface = definitions["Cpu.Step"]
    return {
        "address": "proto/cpu/step", "as": "calculation",
        "interface": {name: deepcopy(interface[name]) for name in ("inputs", "outputs")},
        "slots": {
            "execute": {"mode": "abstract", "binding": None},
            "validate": {"mode": "overridable", "binding": None},
            "observe": {"mode": "final", "binding": "cpu.observe"},
        },
    }


def bind_proto(proto, execute, *, validate=None, observe=None):
    """Known selections bind an abstract slot; opaque selections stay staged."""
    result = deepcopy(proto)
    selections = {"execute": execute}
    if validate is not None:
        selections["validate"] = validate
    elif result["slots"]["validate"]["binding"] is None:
        selections["validate"] = {"cpu.gates": "cpu.validate.integer",
                                  "cpu.integer": "cpu.validate.gates"}.get(execute)
    if observe is not None:
        selections["observe"] = observe
    for name, binding in selections.items():
        slot = result["slots"][name]
        if slot["mode"] == "final" and binding != slot["binding"]:
            raise ValueError(f"this contract's {name} slot is final")
        slot["binding"] = binding
    return result


def source_hashes():
    files = [LAB / "runtime.py", LAB / "cpu.py"] + [LAB.parent / "pxc-machine" / name
             for name in ("pipeline.py", "core.py", "circuits.py", "oracle.py")]
    return {str(file.relative_to(LAB.parent)): hashlib.sha256(file.read_bytes()).hexdigest()
            for file in files}


def ingest(proto, inputs=None, *, implementations=None, schemas=None):
    """Stage an addressed Part or bind this CPU Calculation's functional contract.

    Calculations remain specialized Parts in Pipeline's native declarations.
    Unknown Proto metadata is retained in the addressed contractRef input Part.
    Port meaning names use the engine's existing nominal equality (same name),
    not semantic type inference. Unknown bindings return an explicit frontier.
    """
    before = source_hashes()
    proto = deepcopy(proto)
    stage = Pipeline()
    if proto["as"] == "part":
        definition = stage.input(proto["address"] + "/definition", proto)
        address = stage.declare(proto["address"], "ingest-Part", [definition],
                                lambda declaration: deepcopy(declaration["value"]))
        stage.seek([address])
        return {"status": "PART", "proto": proto, "address": address,
                "value": stage.values[address], "declarations": {
                    key: asdict(value) for key, value in stage.parts.items()}, "frontier": [],
                "order": stage.order, "log": stage.log,
                "sourceHashes": before, "originalSourcesUnchanged": before == source_hashes()}
    if proto["as"] != "calculation":
        raise ValueError("explicit Proto target must be part or calculation")
    _, definitions, _, defaults = make_cpu("gates")
    gates_validator = make_cpu("integer")[2]["cpu.validate"]
    integer_validator = make_cpu("gates")[2]["cpu.validate"]
    callables = {"cpu.gates": gates_step, "cpu.integer": integer_step,
                 "cpu.validate.gates": gates_validator,
                 "cpu.validate.integer": integer_validator}
    callables.update(implementations or {})
    frontier = []
    for name, slot in proto["slots"].items():
        binding = slot["binding"]
        if binding is None or (name != "observe" and binding not in callables):
            frontier.append({"slot": name, "mode": slot["mode"], "binding": binding,
                             "because": "execution role is unbound" if binding is None else "opaque callable binding",
                             "try": "bind a known registered Calculation implementation"})
    address = stage.input(proto["address"] + "/definition", proto)
    if frontier:
        return {"status": "PARTIAL", "proto": proto, "address": address,
                "declarations": {key: asdict(value) for key, value in stage.parts.items()},
                "frontier": frontier, "observations": [], "sourceHashes": before}
    if proto["slots"]["observe"]["binding"] != "cpu.observe":
        raise ValueError("this experiment only binds its declared boundary observer")
    recorded = []
    meanings = {"ImplementationRef": lambda value: type(value) is dict and
                type(value.get("address")) is str and type(value.get("key")) is str,
                "ProtoDefinition": lambda value: type(value) is dict,
                "BoundaryObservation": lambda value: type(value) is dict,
                "ValidationOutcome": lambda value: type(value) is dict and value.get("status") in ("ACCEPT", "REJECT")}
    meanings.update(defaults)
    meanings.update(schemas or {})
    refs = {name + "Ref": {"address": "implementation/" + slot["binding"],
                            "key": slot["binding"]} for name, slot in proto["slots"].items()}
    original_inputs = deepcopy(definitions["Cpu.Transition"]["inputs"])
    interface = proto["interface"]
    definitions["Cpu.Transition"]["inputs"] = {**original_inputs, "executeRef": "ImplementationRef"}
    validation_inputs = {**original_inputs, "candidate": "CpuState",
                         "validateRef": "ImplementationRef", "observation": "BoundaryObservation"}
    definitions["Cpu.Observe"] = {
        "kind": "calculation", "label": "Observe input and candidate at CPU boundary",
        "inputs": {**original_inputs, "candidate": "CpuState", "executeRef": "ImplementationRef",
                   "observeRef": "ImplementationRef", "contractRef": "ProtoDefinition"},
        "outputs": {"observation": "BoundaryObservation"}, "implementation": "cpu.observe",
    }
    root = definitions["Cpu.Step"]
    root["inputs"] = {**deepcopy(interface["inputs"]), "contractRef": "ProtoDefinition",
                       **{name: "ImplementationRef" for name in refs}}
    root["outputs"] = {**deepcopy(interface["outputs"]), "validation": "ValidationOutcome",
                       "readOnly": "ReadOnlyOutcome", "effects": "ValidationEffects"}
    root["returns"]["state"] = "transition.state"
    root["returns"]["validation"] = "validate.verdict"
    root["returns"]["readOnly"] = "validate.readOnly"
    root["returns"]["effects"] = "validate.effects"
    bindings = {name: "$input." + name for name in original_inputs}
    root["steps"] = [
        {"id": "transition", "use": "Cpu.Transition", "bind": {**bindings, "executeRef": "$input.executeRef"}},
        {"id": "observe", "use": "Cpu.Observe", "bind": {
            **bindings, "candidate": "transition.state", "executeRef": "$input.executeRef",
            "observeRef": "$input.observeRef", "contractRef": "$input.contractRef"}},
        {"id": "validate", "use": "ReadOnlyValidation", "after": ["observe"], "bind": {
            **bindings, "candidate": "transition.state", "observation": "observe.observation",
            "validateRef": "$input.validateRef"}},
    ]

    def execute(*, executeRef, **arguments):
        return callables[executeRef["key"]](**arguments)

    def observe(**arguments):
        observation = deepcopy(arguments)
        recorded.append(observation)
        return {"observation": observation}

    def invoke(*, validateRef, observation, **arguments):
        borrowed_before, reported = deepcopy(arguments), None
        try:
            mismatches = {name: {"observed": observation.get(name), "actual": value}
                          for name, value in arguments.items() if observation.get(name) != value}
            if mismatches:
                validation = {
                    "status": "REJECT", "implementation": validateRef["key"],
                    "because": "CPU boundary observation does not match validation inputs",
                    "mismatches": mismatches}
            else:
                reported = deepcopy(callables[validateRef["key"]](**arguments))
                validation = {"status": "ACCEPT", "implementation": validateRef["key"]}
        except Exception as error:
            validation = {"status": "REJECT", "implementation": validateRef["key"], "because": str(error)}
        return {"effects": {"before": borrowed_before, "after": deepcopy(arguments),
                            "reported": reported, "validation": validation}}

    readonly_definitions, readonly_calculations, readonly_meanings = make_readonly_validation(validation_inputs, invoke)
    definitions.update(readonly_definitions)
    meanings.update(readonly_meanings)

    # This build's FunctionalGuarantee selects its producer and borrowed-state
    # policies. Effect declarations belong to the selected binding, not all code.
    compile_lint = compile_readonly(definitions, "Cpu.Step", {
        "authoritativeOutput": {"node": "capability", "port": "state",
                                "expectedNode": "capability/transition", "expectedPort": "state"},
        "readOnlyActor": "capability/validate", "borrowedInputs": ["candidate", "state", "program"],
        "binding": proto["slots"]["validate"]["binding"], "effects": proto.get("validatorEffects"),
    })
    if compile_lint["outputs"]["verdict"]["status"] == "REJECT":
        return {"status": "LINT_REJECT", "acceptedOutputs": None, "proto": proto, "native": None,
                "compileLint": compile_lint, "observations": recorded,
                "frontier": compile_lint["outputs"]["verdict"]["frontier"],
                "sourceHashes": before, "originalSourcesUnchanged": before == source_hashes()}
    # Implementation-specific diagnostic hook: missing effect knowledge may
    # continue to boundary checks. Known banned links above always stop the build.
    # A matching effect declaration remains a claim; it does not prove Python purity.

    try:
        native = run("Cpu.Step", {**deepcopy(inputs), **refs, "contractRef": proto},
                     definitions=definitions, schemas=meanings, implementations={
                         "cpu.transition": execute, "cpu.observe": observe, **readonly_calculations})
    except Exception as error:
        cause = {"type": type(error).__name__, "because": str(error)}
        return {"status": "ENGINE_REJECT", "acceptedOutputs": None, "proto": proto,
                "observations": recorded, "native": None, "compileLint": compile_lint,
                "declarations": {key: asdict(value) for key, value in stage.parts.items()},
                "cause": cause, "frontier": [{**cause, "try": "supply the missing meaning or declared compatible binding"}],
                "sourceHashes": before, "originalSourcesUnchanged": before == source_hashes(),
                "scope": "Staging declarations only: native run did not return its partially built registry."}
    verdict = native["outputs"]["validation"]
    accepted = verdict["status"] == "ACCEPT"
    return {"status": "ACCEPT" if accepted else "REJECT", "proto": proto, "frontier": [],
            "acceptedOutputs": {"state": native["outputs"]["state"]} if accepted else None,
            "observations": recorded, "validation": [verdict], "native": native, "compileLint": compile_lint,
            "readOnly": native["outputs"]["readOnly"], "effects": native["outputs"]["effects"],
            "sourceHashes": before, "originalSourcesUnchanged": before == source_hashes(),
            "limits": ["Declared CPU input/port names only; no arbitrary code parsing.",
                       "Meaning links are nominal strings; matching names do not prove semantic compatibility.",
                       "Validation failure completes this diagnostic graph but cannot supply acceptedOutputs.",
                       "ReadOnly observes net borrowed JSON argument changes; mutate/restore and external/global effects remain unobserved."]}
