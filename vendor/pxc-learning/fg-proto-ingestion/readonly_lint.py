"""Resolve this finite declaration graph, then lint a selected ReadOnly policy.

This analyzes declared links and effect metadata, not arbitrary Python bodies.
The ordinary native linker still checks port meanings, schemas and executability.
Graph resolution and checks are Calculations composed by a FunctionalGuarantee;
the CPU target does not execute while this preflight runs.
"""
from copy import deepcopy
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "capability-lab"))
from runtime import run


def resolve_graph(*, definitions, root):
    graph = {"status": "RESOLVED", "root": root, "nodes": {}, "links": [], "frontier": []}

    def routed(value, at):
        return {"origin": value["origin"], "route": [at, *value["route"]]}

    def build(identity, path, incoming, chain=()):
        if identity in chain:
            raise ValueError(f"recursive definition without a finite instance: {identity}")
        if identity not in definitions:
            raise ValueError(f"missing definition: {identity}")
        definition = definitions[identity]
        node = {"definition": identity, "kind": definition["kind"],
                "inputs": deepcopy(incoming), "outputs": {}}
        graph["nodes"][path] = node
        if set(incoming) != set(definition["inputs"]):
            raise ValueError(f"{path}: bindings do not match input ports")
        if definition["kind"] == "calculation":
            # Calculation outputs are distinct producers. Without a declared
            # forwarding composition we cannot infer an alias from its body.
            node["outputs"] = {name: {"origin": path + "/ports/" + name,
                                       "route": [path + "/ports/" + name]}
                               for name in definition["outputs"]}
            return node
        if definition["kind"] != "functionalGuarantee":
            raise ValueError(f"{path}: unknown definition kind {definition['kind']}")
        steps = {step["id"]: step for step in definition.get("steps", [])}
        if len(steps) != len(definition.get("steps", [])):
            raise ValueError(f"{path}: duplicate step identifiers")
        children, visiting = {}, set()

        def resolve(reference):
            if not isinstance(reference, str) or "." not in reference:
                raise ValueError(f"{path}: invalid reference {reference!r}")
            owner, port = reference.split(".", 1)
            if owner == "$input":
                if port not in incoming:
                    raise ValueError(f"{path}: missing input {port}")
                return routed(incoming[port], path + "/inputs/" + port)
            if owner not in steps:
                raise ValueError(f"{path}: missing step {owner}")
            outputs = link(owner)["outputs"]
            if port not in outputs:
                raise ValueError(f"{path}: missing output {reference}")
            return routed(outputs[port], path + "/" + owner + "/ports/" + port)

        def link(name):
            if name in children:
                return children[name]
            if name in visiting:
                raise ValueError(f"{path}: same-state dependency cycle at {name}")
            if name not in steps:
                raise ValueError(f"{path}: missing sequence predecessor {name}")
            visiting.add(name)
            step = steps[name]
            arguments = {port: resolve(reference) for port, reference in step["bind"].items()}
            for port, reference in step["bind"].items():
                graph["links"].append({"kind": "bind", "at": path + "/" + name + "/inputs/" + port,
                                       "reference": reference, **deepcopy(arguments[port])})
            for predecessor in step.get("after", []):
                link(predecessor)
            children[name] = build(step["use"], path + "/" + name, arguments, (*chain, identity))
            visiting.remove(name)
            return children[name]

        for name in steps:
            link(name)
        if set(definition["returns"]) != set(definition["outputs"]):
            raise ValueError(f"{path}: returns do not match output ports")
        for name, reference in definition["returns"].items():
            value = routed(resolve(reference), path + "/ports/" + name)
            node["outputs"][name] = value
            graph["links"].append({"kind": "return", "at": path + "/ports/" + name,
                                   "reference": reference, **deepcopy(value)})
        return node

    try:
        if root not in definitions:
            raise ValueError(f"missing definition: {root}")
        build(root, "capability", {name: {"origin": "request/" + name, "route": ["request/" + name]}
                                   for name in definitions[root]["inputs"]})
    except (KeyError, TypeError, ValueError) as error:
        graph["status"] = "UNRESOLVED"
        graph["frontier"].append({"because": str(error), "try": "resolve the finite declared links before linting their effects"})
    return {"graph": graph}


def check_links(*, graph, rules):
    result = {"violations": [], "frontier": [], "effectLinks": [],
              "sourceEffectsCompleteness": "UNVERIFIED",
              "scope": "Declared origins and selected binding's effect claims; no source-body purity proof"}

    def fail(because, **details):
        result["violations"].append({"because": because, **details})

    if graph["status"] != "RESOLVED":
        fail("declared graph closure is unresolved", frontier=deepcopy(graph["frontier"]))
        return {"check": result}
    nodes = graph["nodes"]
    try:
        output = rules["authoritativeOutput"]
        actual = nodes[output["node"]]["outputs"][output["port"]]
        expected = nodes[output["expectedNode"]]["outputs"][output["expectedPort"]]
        if actual["origin"] != expected["origin"]:
            fail("authoritative state must come from the selected transition output",
                 actual=actual["origin"], expected=expected["origin"], route=actual["route"])
        actor = rules["readOnlyActor"]
        protected = {nodes[actor]["inputs"][name]["origin"]: name for name in rules["borrowedInputs"]}
    except KeyError as error:
        fail("ReadOnly rule refers to an unresolved node or port", reference=str(error))
        return {"check": result}

    effects = rules.get("effects")
    if effects is None:
        result["frontier"].append({"binding": rules["binding"],
            "because": "selected validator has no effect declaration",
            "try": "declare its local reads/writes; verify the declaration against the implementation separately"})
        return {"check": result}
    if type(effects) is not dict or effects.get("binding") != rules["binding"]:
        fail("effect declaration does not match selected validator binding",
             selected=rules["binding"], declared=effects.get("binding") if type(effects) is dict else None)
        return {"check": result}
    if any(type(effects.get(mode)) is not list for mode in ("reads", "writes")):
        fail("effect declaration must supply read and write reference lists")
        return {"check": result}

    def effect_origin(reference):
        if not isinstance(reference, str):
            raise ValueError("effect reference must be a string")
        if reference.startswith(("$input.", "$output.")):
            path, owner, port = actor, *reference.split(".", 1)
        elif ".$input." in reference or ".$output." in reference:
            marker = ".$input." if ".$input." in reference else ".$output."
            children, port = reference.split(marker, 1)
            path, owner = actor + "/" + children.replace(".", "/"), marker[1:-1]
        else:
            children, port = reference.rsplit(".", 1)
            path, owner = actor + "/" + children.replace(".", "/"), "$output"
        if path not in nodes:
            raise ValueError(f"missing actor-closure node {path}")
        ports = nodes[path]["inputs" if owner == "$input" else "outputs"]
        if port not in ports:
            raise ValueError(f"missing effect port {path}/{owner}/{port}")
        return ports[port]

    for mode in ("reads", "writes"):
        for reference in effects[mode]:
            try:
                origin = effect_origin(reference)
                result["effectLinks"].append({"mode": mode, "reference": reference, **deepcopy(origin)})
                if mode == "writes" and origin["origin"] in protected:
                    fail("declared write reaches a ReadOnly borrowed target", reference=reference,
                         target=protected[origin["origin"]], **deepcopy(origin))
            except (KeyError, ValueError) as error:
                fail("effect reference is unresolved", reference=reference, detail=str(error))
    return {"check": result}


def compile_verdict(*, check):
    return {"verdict": {"status": "REJECT" if check["violations"] else "PARTIAL" if check["frontier"] else "PASS",
                         "violations": deepcopy(check["violations"]), "frontier": deepcopy(check["frontier"]),
                         "sourceEffectsCompleteness": check["sourceEffectsCompleteness"]}}


def compile_readonly(definitions, root, rules):
    """Compile the lint composition with exact definition/rule Parts as inputs."""
    lint = {
        "Graph.Resolve": {"kind": "calculation", "label": "Resolve finite declared producers and aliases",
            "inputs": {"definitions": "Definitions", "root": "DefinitionId"},
            "outputs": {"graph": "ResolvedGraph"}, "implementation": "graph.resolve"},
        "ReadOnly.LinkCheck": {"kind": "calculation", "label": "Check selected ReadOnly link policy",
            "inputs": {"graph": "ResolvedGraph", "rules": "ReadOnlyRules"},
            "outputs": {"check": "LinkCheck"}, "implementation": "readonly.links"},
        "Compile.Verdict": {"kind": "calculation", "label": "Compose lint verdict without hiding unresolved effects",
            "inputs": {"check": "LinkCheck"}, "outputs": {"verdict": "CompileVerdict"}, "implementation": "compile.verdict"},
        "ReadOnly.Compile": {"kind": "functionalGuarantee", "label": "ReadOnly compilation lint",
            "inputs": {"definitions": "Definitions", "root": "DefinitionId", "rules": "ReadOnlyRules"},
            "outputs": {"graph": "ResolvedGraph", "check": "LinkCheck", "verdict": "CompileVerdict"},
            "steps": [
                {"id": "resolve", "use": "Graph.Resolve", "bind": {"definitions": "$input.definitions", "root": "$input.root"}},
                {"id": "check", "use": "ReadOnly.LinkCheck", "bind": {"graph": "resolve.graph", "rules": "$input.rules"}},
                {"id": "verdict", "use": "Compile.Verdict", "bind": {"check": "check.check"}}],
            "returns": {"graph": "resolve.graph", "check": "check.check", "verdict": "verdict.verdict"}},
    }
    schemas = {name: lambda value: type(value) is dict for name in
               ("Definitions", "ResolvedGraph", "ReadOnlyRules", "LinkCheck", "CompileVerdict")}
    schemas["DefinitionId"] = lambda value: type(value) is str
    inputs = {"definitions": deepcopy(definitions), "root": root, "rules": deepcopy(rules)}
    native = run("ReadOnly.Compile", inputs, definitions=lint, schemas=schemas,
                 implementations={"graph.resolve": resolve_graph, "readonly.links": check_links,
                                  "compile.verdict": compile_verdict})
    # Native Pipeline logs input addresses but does not return their values.
    # Retain the exact consumed Parts for deterministic replay of this check.
    native["inputParts"] = {"request/" + name: value for name, value in inputs.items()}
    return native
