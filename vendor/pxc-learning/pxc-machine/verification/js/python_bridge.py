"""Public Python fixture runner for the independent JavaScript implementation.

Run ``python3 -B python_bridge.py --list`` for cases. Otherwise send one JSON
object per stdin line; each produces one flushed JSON response on stdout:

    {"case":"nand","delta":false}
    {"case":"cpu-demo","name":"countdown","delta":true}
    {"case":"cpu-seeded","seed":42,"steps":12}
    {"case":"lane-a-fulladder"}
    {"case":"lane-b-device","steps":1000,"delta":true}

Responses contain explicit inputs, configuration, and actual run_net traces.
Declarations are the trace's calculations/fgs/composites/groups/constants/inputs.
Compact detail omits only per-state pxcLog and seekLog; every bit value,
evaluated/reused Calculation index, FG verdict, bus, and total remains intact.
Use "detail":"full" for both logs. pythonSeconds measures run_net alone.
No evaluator or opcode implementation is copied or inspected by this bridge.
"""

import argparse
from itertools import product
import json
from pathlib import Path
import random
import sys
from time import perf_counter


sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(BASE), str(BASE / "lanes/composition"),
               str(BASE / "lanes/devices")]

from core import Net, run_net
from circuits import DEMOS, assemble, build_cpu


CASES = [
    {"case": "nand", "states": 4, "meaning": "All four NAND input rows"},
    {"case": "wire", "states": 4, "meaning": "Both input values, held and changed"},
    {"case": "delay", "states": 5, "initial": 0,
     "meaning": "All four previous/current output transitions"},
    *[{"case": "cpu-demo", "name": name, "states": len(demo["inputs"])}
      for name, demo in DEMOS.items()],
    {"case": "cpu-seeded", "seed": 1, "length": 8, "steps": 12,
     "meaning": "Seeded bytes, initial registers/RAM, and input observations"},
    {"case": "cpu-program", "program": [16, 192, 240], "steps": 5,
     "meaning": "Explicit instruction bytes, initial state, and byte inputs"},
    {"case": "lane-a-fulladder", "states": 8,
     "meaning": "Instantiate the selected Lane A composition; exhaust inputs"},
    {"case": "lane-b-device", "steps": 1000, "initialMs": 0,
     "meaning": "1001 complete states, including the first one-second strobe"},
]


def integer(request, key, default, low=0, high=10_000):
    value = request.get(key, default)
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{key} must be an integer in {low}..{high}")
    return value


def flag(request, key, default=False):
    value = request.get(key, default)
    if type(value) is not bool:
        raise ValueError(f"{key} must be Boolean")
    return value


def byte_inputs(request, steps, defaults):
    values = request.get("inputs", defaults)
    if (not isinstance(values, list) or len(values) != steps + 1 or
            any(type(value) is not int or not 0 <= value <= 255 for value in values)):
        raise ValueError("inputs must contain one integer byte per state")
    return values, [{f"cpu/in/{bit}": (value >> bit) & 1 for bit in range(8)}
                    for value in values]


def fixture(request):
    """Declare a circuit and its observations without executing circuit logic."""
    kind = request.get("case")
    if kind == "nand":
        net = Net("independent-runtime NAND truth table")
        a, b = net.input("a"), net.input("b")
        net.bus("Q", [net.nand("q", a, b)])
        stimuli = [dict(a=a, b=b) for a, b in product((0, 1), repeat=2)]
        return net, stimuli, {"steps": 3}
    if kind == "wire":
        net = Net("independent-runtime wire")
        source = net.input("input")
        net.bus("Q", [net.wire("q", source)])
        return net, [{"input": value} for value in [0, 0, 1, 0]], {"steps": 3}
    if kind == "delay":
        initial = integer(request, "initial", 0, high=1)
        net = Net("independent-runtime delay transitions")
        source = net.input("input")
        net.bus("Q", [net.delay("q", source, initial)])
        values = [0, 1, 1, 0, 0]
        return net, [{"input": value} for value in values], {
            "steps": 4, "initial": initial}
    if kind in ("cpu-demo", "cpu-seeded", "cpu-program"):
        config = {}
        if kind == "cpu-demo":
            name = request.get("name", "countdown")
            if name not in DEMOS:
                raise ValueError(f"Unknown demo {name!r}; choose {list(DEMOS)}")
            demo = DEMOS[name]
            program = assemble(demo["source"])
            steps = integer(request, "steps", len(demo["inputs"]) - 1)
            defaults = [demo["inputs"][min(t, len(demo["inputs"]) - 1)]
                        for t in range(steps + 1)]
            initial = request.get("initial", {})
            config.update(name=name, source=demo["source"])
        elif kind == "cpu-seeded":
            seed = integer(request, "seed", 1, high=2**32 - 1)
            length = integer(request, "length", 8, low=1, high=16)
            steps = integer(request, "steps", 12)
            rng = random.Random(seed)
            program = [(rng.randrange(15) << 4) | rng.randrange(16)
                       for _ in range(length - 1)] + [0xF0]
            initial = request.get("initial", {
                "A": rng.randrange(256), "PC": 0, "OUT": rng.randrange(256),
                "HALT": 0, "RAM": [rng.randrange(256) for _ in range(16)]})
            defaults = [rng.randrange(256) for _ in range(steps + 1)]
            config.update(seed=seed, length=length,
                          generator="Python random.Random; explicit results included")
        else:
            if "program" not in request:
                raise ValueError("cpu-program requires instruction byte array program")
            program = request["program"]
            steps = integer(request, "steps", 5)
            defaults = [0] * (steps + 1)
            initial = request.get("initial", {})
        values, stimuli = byte_inputs(request, steps, defaults)
        net = build_cpu(program, initial=initial)
        config.update(program=list(program) + [0] * (16 - len(program)),
                      initial=initial, inputs=values, steps=steps)
        return net, stimuli, config
    if kind == "lane-a-fulladder":
        from composition import compose, instantiate
        requirement = json.loads((BASE / "lanes/composition/requirements.json")
                                 .read_text())["fullAdder"]
        report = compose(requirement)
        net = Net("independent-runtime selected Lane A full adder")
        addresses = [net.input(f"input/{i}") for i in range(3)]
        outputs = instantiate(net, "full-adder", addresses, report)
        for name, address in zip(requirement["outputs"], outputs):
            net.bus(name, [address])
        stimuli = [dict(zip(addresses, row["inputs"])) for row in requirement["rows"]]
        return net, stimuli, {"steps": 7, "requirement": requirement,
                              "selection": report["selection"]}
    if kind == "lane-b-device":
        from device import build_stopwatch, inputs
        steps = integer(request, "steps", 1000)
        initial = integer(request, "initialMs", 0, high=99_999_999)
        wrong = flag(request, "wrongStrobe")
        controls = request.get("controls", [{"run": 1, "reset": 0}] * (steps + 1))
        if (not isinstance(controls, list) or len(controls) != steps + 1 or
                any(type(row) is not dict or set(row) != {"run", "reset"} or
                    any(type(bit) is not int or bit not in (0, 1) for bit in row.values())
                    for row in controls)):
            raise ValueError("controls needs one {run: bit, reset: bit} row per state")
        return build_stopwatch(initial, wrong_strobe=wrong), inputs(controls), {
            "steps": steps, "initialMs": initial, "wrongStrobe": wrong,
            "controls": controls, "tickMilliseconds": 1}
    raise ValueError(f"Unknown case {kind!r}; use {{\"case\":\"list\"}}")


def respond(request):
    if type(request) is not dict:
        raise ValueError("request must be a JSON object")
    if request.get("case") == "list":
        return {"ok": True, "schema": "pxc-python-fixture-list/v1", "cases": CASES}
    delta = flag(request, "delta")
    detail = request.get("detail", "compact")
    if detail not in ("compact", "full"):
        raise ValueError("detail must be compact or full")
    started = perf_counter()
    net, stimuli, config = fixture(request)
    build_seconds = perf_counter() - started
    started = perf_counter()
    trace = run_net(net, config["steps"], stimuli=stimuli, delta=delta)
    python_seconds = perf_counter() - started
    if detail == "compact":
        for state in trace["states"]:
            state.pop("pxcLog")
            state.pop("seekLog")
    return {"ok": True, "schema": "pxc-python-fixture/v1", "id": request.get("id"),
            "case": request["case"], "config": {**config, "delta": delta},
            "stimuli": stimuli, "detail": detail, "trace": trace,
            "pythonSeconds": python_seconds, "buildSeconds": build_seconds}


def self_test():
    nand = respond({"case": "nand"})
    assert [s["buses"]["Q"] for s in nand["trace"]["states"]] == [1, 1, 1, 0]
    delay = respond({"case": "delay", "delta": True})
    assert [s["buses"]["Q"] for s in delay["trace"]["states"]] == [0, 0, 1, 1, 0]
    full = respond({"case": "delay", "detail": "full", "delta": True})["trace"]
    for state in full["states"]:
        assert len(state.pop("pxcLog")) == len(state["evaluated"])
        assert len(state.pop("seekLog")) == len(state["evaluated"]) + len(state["reused"])
    assert full == delay["trace"]
    print(json.dumps({"ok": True, "checks": ["NAND rows", "delay transitions",
                                               "compact trace preserves all remaining fields"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.list:
        print(json.dumps(respond({"case": "list"}), separators=(",", ":")))
        return
    if args.self_test:
        self_test()
        return
    for line in sys.stdin:
        try:
            response = respond(json.loads(line))
        except Exception as error:
            response = {"ok": False, "error": type(error).__name__, "message": str(error)}
        print(json.dumps(response, separators=(",", ":")), flush=True)
        del response


if __name__ == "__main__":
    main()
