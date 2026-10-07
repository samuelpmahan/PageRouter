"""Behavioral validators for interrupt CPU traces; candidate verdicts are ignored.

These functions return evidence for the enclosing Pipeline's registered FGs.
Local transition checks cover the supplied observations; the independent oracle
also binds their initial state, program, stimulus, and requested state count.
"""
from .reference import BUS_WIDTHS, STATE_WIDTHS, expected_buses, run_reference_interrupts


def _result(issues, **summary):
    return dict(status="FAIL" if issues else "PASS", loss=len(issues), issues=issues, **summary)


def _observations(trace):
    issues, observations = [], []
    states = trace.get("states") if isinstance(trace, dict) else None
    if not isinstance(states, list) or not states:
        return [], [dict(kind="state-closure", detail="a nonempty state list is required")]
    for tick, state in enumerate(states):
        if not isinstance(state, dict):
            issues.append(dict(t=tick, kind="state-shape"))
            continue
        if type(state.get("t")) is not int or state["t"] != tick:
            issues.append(dict(t=tick, kind="state-identity", actual=state.get("t")))
        buses = state.get("buses")
        if not isinstance(buses, dict):
            issues.append(dict(t=tick, kind="missing-buses"))
            continue
        observations.append(buses)
        for name, width in BUS_WIDTHS.items():
            if name not in buses:
                issues.append(dict(t=tick, kind="missing-bus", field=name))
            elif type(buses[name]) is not int or not 0 <= buses[name] < 1 << width:
                issues.append(dict(t=tick, kind="bus-width", field=name, actual=buses[name], width=width))
    return observations, issues


def _equal(issues, tick, kind, field, actual, expected):
    if type(actual) is not type(expected) or actual != expected:
        issues.append(dict(t=tick, kind=kind, field=field, expected=expected, actual=actual))


def _control(state):
    irq = int(state["TIMER"] == 31 or state["EXT_IRQ"])
    accept = int(state["IE"] and not state["ACTIVE"] and not state["HALT"] and (state["PENDING"] or irq))
    returning = int(state["ACTIVE"] and not state["HALT"] and state["INSTRUCTION"] == 3)
    return irq, accept, returning


def check_instruction_conformance(trace, program, steps, *, initial=None, inputs=None, irqs=None):
    """Compare every requested architectural bus and all 16 memory bytes."""
    expected = run_reference_interrupts(program, steps, initial=initial, inputs=inputs, irqs=irqs)
    actual, issues = _observations(trace)
    if len(actual) != len(expected):
        issues.append(dict(kind="state-closure", expected=len(expected), actual=len(actual)))
    for tick, (observed, required) in enumerate(zip(actual, expected)):
        for name, value in expected_buses(required).items():
            if name in observed:
                _equal(issues, tick, "architecture", name, observed[name], value)
    return _result(issues, statesCompared=min(len(actual), len(expected)), statesRequired=len(expected),
                   busesPerState=len(BUS_WIDTHS))


def check_interrupt_context(trace):
    """Validate entry/return registers and preservation from observed transitions."""
    states, issues = _observations(trace)
    if issues:
        return _result(issues)
    entries, returns = [], []
    memory = tuple(f"RAM{i:02}" for i in range(16))
    for tick, old in enumerate(states):
        _, accept, returning = _control(old)
        _equal(issues, tick, "interrupt-control", "ACCEPT", old["ACCEPT"], accept)
        _equal(issues, tick, "interrupt-control", "RETURN", old["RETURN"], returning)
        if tick + 1 == len(states):
            continue
        new = states[tick + 1]
        if accept:
            entries.append(tick + 1)
            wanted = {"PC": 8, "ACTIVE": 1, "SAVED_PC": old["PC"], "SAVED_A": old["A"]}
            holds = ("A", "OUT", "HALT", "IE", *memory)
            kind = "interrupt-entry"
        elif returning:
            returns.append(tick + 1)
            wanted = {"PC": old["SAVED_PC"], "A": old["SAVED_A"], "ACTIVE": 0}
            holds = ("OUT", "HALT", "IE", "SAVED_PC", "SAVED_A", *memory)
            kind = "interrupt-return"
        else:
            wanted = {}
            holds = ("ACTIVE", "SAVED_PC", "SAVED_A")
            kind = "context-hold"
            if old["HALT"]:
                holds = (*[key for key in STATE_WIDTHS if key not in ("TIMER", "SCAN_ROW", "PENDING")], *memory)
                kind = "halt-hold"
        wanted.update({name: old[name] for name in holds})
        for name, value in wanted.items():
            _equal(issues, tick + 1, kind, name, new[name], value)
    return _result(issues, entryStates=entries, returnStates=returns,
                   transitionsChecked=max(0, len(states) - 1))


def check_pending_semantics(trace):
    """Validate timer, interrupt masking, non-nesting, and one-bit coalescing."""
    states, issues = _observations(trace)
    if issues:
        return _result(issues)
    request_states = []
    for tick, old in enumerate(states):
        irq, accept, returning = _control(old)
        if irq:
            request_states.append(tick)
        _equal(issues, tick, "request-source", "IRQ", old["IRQ"], irq)
        _equal(issues, tick, "request-acceptance", "ACCEPT", old["ACCEPT"], accept)
        if tick + 1 == len(states):
            continue
        new = states[tick + 1]
        pending = 0 if accept else int(old["PENDING"] or irq)
        _equal(issues, tick + 1, "request-coalescing", "PENDING", new["PENDING"], pending)
        _equal(issues, tick + 1, "timer-advance", "TIMER", new["TIMER"], (old["TIMER"] + 1) % 32)
        ie = old["IE"]
        if not old["HALT"] and not accept and not returning and old["INSTRUCTION"] in (1, 2):
            ie = int(old["INSTRUCTION"] == 1)
        _equal(issues, tick + 1, "interrupt-enable", "IE", new["IE"], ie)
    return _result(issues, requestStates=request_states, transitionsChecked=max(0, len(states) - 1))


def check_display_mapping(trace):
    """RAM[0..7] are rows; column x is bit x, with one enabled scan row."""
    states, issues = _observations(trace)
    if issues:
        return _result(issues)
    for tick, state in enumerate(states):
        row = state["SCAN_ROW"]
        _equal(issues, tick, "scan-memory-columns", "SCAN_DATA", state["SCAN_DATA"], state[f"RAM{row:02}"])
        _equal(issues, tick, "scan-row-enable", "ROW_ENABLE", state["ROW_ENABLE"], 1 << row)
        if tick:
            _equal(issues, tick, "scan-advance", "SCAN_ROW", row, (states[tick - 1]["SCAN_ROW"] + 1) % 8)
    return _result(issues, statesChecked=len(states), columnsPerRow=8, memoryRows=8)


def check_trace_structure(trace, expected_plan, steps, stimuli):
    """Recompute primitive execution with separately supplied plan and stimuli."""
    if expected_plan is None or steps is None:
        return dict(status="UNVERIFIED", loss=1, issues=[dict(kind="missing-independent-obligations")])
    _, issues = _observations(trace)
    count = len(trace.get("states", [])) if isinstance(trace, dict) and isinstance(trace.get("states"), list) else 0
    if count != steps + 1:
        issues.append(dict(kind="state-closure", expected=steps + 1, actual=count))
    if issues:
        return _result(issues)
    from core import audit_trace
    try:
        audited = audit_trace(trace, expected_plan, steps, stimuli)
    except (KeyError, IndexError, TypeError, ValueError) as error:
        return _result([dict(kind="malformed-execution", detail=str(error))])
    return audited
