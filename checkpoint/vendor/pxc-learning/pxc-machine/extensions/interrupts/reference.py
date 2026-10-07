"""Interrupt contract v1 as ordinary integers, independent of all gate code.

State t uses inputs[t]/irqs[t] to produce state t+1. Every returned state
also includes its combinational observations, so inputs cover steps+1 states.
"""

STATE_WIDTHS = {"A": 8, "PC": 4, "OUT": 8, "HALT": 1, "IE": 1,
                "PENDING": 1, "ACTIVE": 1, "SAVED_PC": 4, "SAVED_A": 8,
                "TIMER": 5, "SCAN_ROW": 3}
BUS_WIDTHS = {**STATE_WIDTHS, "IN": 8, "EXT_IRQ": 1, "INSTRUCTION": 8,
              "OPCODE": 4, "OPERAND": 4, "IRQ": 1, "ACCEPT": 1, "RETURN": 1,
              "SCAN_DATA": 8, "ROW_ENABLE": 8,
              **{f"RAM{i:02}": 8 for i in range(16)}}


def _bounded(value, width, label):
    if type(value) is not int or not 0 <= value < 1 << width:
        raise ValueError(f"{label} must be an integer in 0..{(1 << width) - 1}")


def expected_buses(state):
    """Project the reference's RAM list onto the circuit's named byte buses."""
    return {**{key: value for key, value in state.items() if key != "RAM"},
            **{f"RAM{i:02}": value for i, value in enumerate(state["RAM"])}}


def run_reference_interrupts(program, steps, *, initial=None, inputs=None, irqs=None):
    if type(steps) is not int or steps < 0:
        raise ValueError("steps must be a nonnegative integer")
    if len(program) != 16:
        raise ValueError("program must have exactly 16 bytes")
    for instruction in program:
        _bounded(instruction, 8, "instruction")
    state = {**dict.fromkeys(STATE_WIDTHS, 0), "RAM": [0] * 16}
    if initial and set(initial) - state.keys():
        raise ValueError("unknown initial state key")
    state.update(initial or {})
    for name, width in STATE_WIDTHS.items():
        _bounded(state[name], width, name)
    if len(state["RAM"]) != 16:
        raise ValueError("RAM must have exactly 16 bytes")
    for byte in state["RAM"]:
        _bounded(byte, 8, "RAM byte")
    state["RAM"] = list(state["RAM"])
    inputs = [0] * (steps + 1) if inputs is None else list(inputs)
    irqs = [0] * (steps + 1) if irqs is None else list(irqs)
    for observations, width, label in ((inputs, 8, "input byte"), (irqs, 1, "external IRQ")):
        if len(observations) < steps + 1:
            raise ValueError(f"one {label} observation is required for each of steps+1 states")
        for value in observations:
            _bounded(value, width, label)

    states = []
    for tick in range(steps + 1):
        instruction = program[state["PC"]]
        opcode, operand = divmod(instruction, 16)
        irq = int(state["TIMER"] == 31 or irqs[tick])
        accept = int(state["IE"] and not state["ACTIVE"] and not state["HALT"] and (state["PENDING"] or irq))
        returning = int(state["ACTIVE"] and not state["HALT"] and instruction == 0x03)
        states.append({**state, "IN": inputs[tick], "EXT_IRQ": irqs[tick],
                       "INSTRUCTION": instruction, "OPCODE": opcode, "OPERAND": operand,
                       "IRQ": irq, "ACCEPT": accept, "RETURN": returning,
                       "SCAN_DATA": state["RAM"][state["SCAN_ROW"]],
                       "ROW_ENABLE": 1 << state["SCAN_ROW"]})
        if tick == steps:
            break
        old = state
        state = dict(old, RAM=list(old["RAM"]), TIMER=(old["TIMER"] + 1) % 32,
                     SCAN_ROW=(old["SCAN_ROW"] + 1) % 8,
                     PENDING=0 if accept else int(old["PENDING"] or irq))
        if accept:
            state.update(SAVED_PC=old["PC"], SAVED_A=old["A"], PC=8, ACTIVE=1)
        elif returning:
            state.update(PC=old["SAVED_PC"], A=old["SAVED_A"], ACTIVE=0)
        elif not old["HALT"]:
            a, memory = old["A"], old["RAM"][operand]
            state["PC"] = (old["PC"] + 1) % 16
            if instruction == 0x01:
                state["IE"] = 1
            elif instruction == 0x02:
                state["IE"] = 0
            elif opcode == 1:
                state["A"] = operand
            elif opcode == 2:
                state["A"] = memory
            elif opcode == 3:
                state["RAM"][operand] = a
            elif opcode == 4:
                state["A"] = (a + memory) % 256
            elif opcode == 5:
                state["A"] = (a - memory) % 256
            elif opcode == 6:
                state["A"] = a & memory
            elif opcode == 7:
                state["A"] = a | memory
            elif opcode == 8:
                state["A"] = a ^ memory
            elif opcode == 9 or opcode == 10 and a == 0 or opcode == 11 and a != 0:
                state["PC"] = operand
            elif opcode == 12:
                state["OUT"] = a
            elif opcode == 13:
                state["A"] = inputs[tick]
            elif opcode == 14:
                state["A"] = (a * 2) % 256
            elif opcode == 15:
                state.update(HALT=1, PC=old["PC"])
    return states
