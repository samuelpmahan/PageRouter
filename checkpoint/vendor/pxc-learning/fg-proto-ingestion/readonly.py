"""A reusable declaration composition for net borrowed JSON argument changes.

ReadOnly is intentionally scoped to two observed invocation boundaries. It does
not observe transient mutate/restore, globals, files, other threads or I/O.
The supplied Invoke Calculation captures before/after/reported/validation data.
The FunctionalGuarantee exposes evidence and verdicts, never the borrowed state.
"""
from copy import deepcopy
import json


def check(*, effects):
    before, after = effects["before"], effects["after"]
    # Python's 1 == True would hide a changed JSON type; compare canonical JSON.
    def content(value):
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    changes = {name: {"before": before.get(name), "after": after.get(name)}
               for name in before.keys() | after.keys()
               if name not in before or name not in after or content(before[name]) != content(after[name])}
    return {"readOnly": {"status": "REJECT" if changes else "PASS", "changes": changes,
                         "scope": "net borrowed JSON argument changes at invocation boundaries"}}


def verdict(*, effects, readOnly):
    result = deepcopy(effects["validation"])
    if readOnly["status"] == "REJECT":
        result.update(status="REJECT", because="ReadOnly: validator changed borrowed arguments",
                      borrowedChanges=deepcopy(readOnly["changes"]))
    return {"verdict": result}


def make_readonly_validation(inputs, invoke):
    """Return definitions, Calculation implementations and local meaning predicates."""
    definitions = {
        "Validation.Invoke": {
            "kind": "calculation", "label": "Invoke selected validator and capture boundary effects",
            "inputs": deepcopy(inputs), "outputs": {"effects": "ValidationEffects"},
            "implementation": "validation.invoke"},
        "ReadOnly.Check": {
            "kind": "calculation", "label": "Check net borrowed argument changes",
            "inputs": {"effects": "ValidationEffects"}, "outputs": {"readOnly": "ReadOnlyOutcome"},
            "implementation": "readonly.check"},
        "Validation.Verdict": {
            "kind": "calculation", "label": "Compose validation and ReadOnly verdicts",
            "inputs": {"effects": "ValidationEffects", "readOnly": "ReadOnlyOutcome"},
            "outputs": {"verdict": "ValidationOutcome"}, "implementation": "validation.verdict"},
        "ReadOnlyValidation": {
            "kind": "functionalGuarantee", "label": "ReadOnly validation",
            "inputs": deepcopy(inputs), "outputs": {
                "verdict": "ValidationOutcome", "readOnly": "ReadOnlyOutcome", "effects": "ValidationEffects"},
            "steps": [
                {"id": "invoke", "use": "Validation.Invoke", "bind": {name: "$input." + name for name in inputs}},
                {"id": "readonly", "use": "ReadOnly.Check", "bind": {"effects": "invoke.effects"}},
                {"id": "verdict", "use": "Validation.Verdict",
                 "bind": {"effects": "invoke.effects", "readOnly": "readonly.readOnly"}},
            ],
            "returns": {"verdict": "verdict.verdict", "readOnly": "readonly.readOnly", "effects": "invoke.effects"}},
    }
    schemas = {
        "ValidationEffects": lambda value: type(value) is dict,
        "ReadOnlyOutcome": lambda value: type(value) is dict and value.get("status") in ("PASS", "REJECT"),
        "ValidationOutcome": lambda value: type(value) is dict and value.get("status") in ("ACCEPT", "REJECT"),
    }
    return definitions, {"validation.invoke": invoke, "readonly.check": check,
                         "validation.verdict": verdict}, schemas
