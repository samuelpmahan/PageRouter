"""Independent integer reference for PLAN.md; never imports the gate implementation.

Host arithmetic is intentional here: this is a separate checking engine, never
the PxC machine's execution path. Inputs[t] is observed while executing state t.
"""


def run_reference(program, steps, *, initial=None, inputs=None):
    def bounded(value, maximum, label):
        if type(value) is not int or not 0 <= value <= maximum:
            raise ValueError(f"{label} must be an integer in 0..{maximum}")

    if type(steps) is not int or steps < 0:
        raise ValueError("steps must be a nonnegative integer")
    if len(program) != 16:
        raise ValueError("program must have exactly 16 bytes")
    for instruction in program:
        bounded(instruction, 255, "instruction")
    state = {"A": 0, "PC": 0, "OUT": 0, "HALT": 0, "RAM": [0] * 16}
    if initial and set(initial) - state.keys():
        raise ValueError("unknown initial state key")
    state.update(initial or {})
    for key, maximum in [("A", 255), ("PC", 15), ("OUT", 255), ("HALT", 1)]:
        bounded(state[key], maximum, key)
    if len(state["RAM"]) != 16:
        raise ValueError("RAM must have exactly 16 bytes")
    for byte in state["RAM"]:
        bounded(byte, 255, "RAM byte")
    state["RAM"] = list(state["RAM"])
    inputs = [0] * steps if inputs is None else list(inputs)
    if len(inputs) < steps:
        raise ValueError("one input observation is required for each executing state")
    for byte in inputs:
        bounded(byte, 255, "input byte")

    states = [state]
    for tick in range(steps):
        old = states[-1]
        state = dict(old, RAM=list(old["RAM"]))
        if not old["HALT"]:
            opcode, operand = divmod(program[old["PC"]], 16)
            a, memory = old["A"], old["RAM"][operand]
            state["PC"] = (old["PC"] + 1) % 16
            if opcode == 1:
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
                state["HALT"] = 1
                state["PC"] = old["PC"]
        states.append(state)
    return states
