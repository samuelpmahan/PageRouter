"""Small experimental schema and shared math; no execution in Part declarations."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Part:
    address: str
    depends: tuple[str, ...] = ()


@dataclass(frozen=True)
class Calculation(Part):
    rule: str = ""
    inputs: tuple[str, ...] = ()
    output: str = ""
    initial: int | None = None


@dataclass(frozen=True)
class FunctionalGuarantee(Part):
    left: str = ""
    right: str = ""
    validators: tuple[str, ...] = ()


@dataclass(frozen=True)
class Observation:
    status: str
    value: object = None
    reason: str = ""


ARITY = {"wire": 1, "not": 1, "and": 2, "or": 2, "xor": 2,
         "mux": 3, "delay": 1}


def apply_rule(rule, values):
    """One implementation of the primitive math, shared by all model variants."""
    if rule.startswith("get:"):
        index = int(rule.removeprefix("get:"))
        if (len(values) != 1 or not isinstance(values[0], tuple)
                or not 0 <= index < len(values[0])):
            raise ValueError(f"{rule} needs a bundle containing that index")
        return values[0][index]
    if rule.startswith("check:"):
        left, right = values
        checked = rule.removeprefix("check:")
        if checked in ("eq", "wire"):
            return int(left == right)
        if checked in ("both", "either"):
            return apply_rule("all" if checked == "both" else "any", (left, right))
        if checked == "add":
            a, b, carry = left
            integer = lambda bits: sum(bit << index for index, bit in enumerate(bits))
            return int(integer(right) == integer(a) + integer(b) + carry)
        inputs = left if isinstance(left, tuple) else (left,)
        return int(apply_rule(checked, inputs) == right)
    if rule == "bundle":
        return tuple(values)
    if any(type(value) is not int or value not in (0, 1) for value in values):
        raise ValueError(f"{rule} requires Boolean Parts: {values!r}")
    if rule in ARITY and len(values) != ARITY[rule]:
        raise ValueError(f"{rule} expects {ARITY[rule]} inputs")
    if rule == "wire":
        return values[0]
    if rule == "not":
        return 1 - values[0]
    if rule == "and":
        return values[0] & values[1]
    if rule == "or":
        return values[0] | values[1]
    if rule == "xor":
        return values[0] ^ values[1]
    if rule == "mux":
        select, a, b = values
        return (a, b)[select]
    if rule == "all":
        return int(all(values))
    if rule == "any":
        return int(any(values))
    raise ValueError(f"unknown primitive rule: {rule}")


def dependencies(calc, tick):
    if calc.rule == "delay":
        return () if tick == 0 else ((calc.inputs[0], tick - 1),)
    return tuple((address, tick) for address in calc.inputs)


class Circuit:
    """A declaration builder. Building the graph executes no Calculation."""

    def __init__(self):
        self.parts = {}
        self.producers = {}
        self.values = set()

    def _add(self, part):
        if part.address in self.parts:
            raise ValueError(f"duplicate declaration: {part.address}")
        self.parts[part.address] = part

    def input(self, address):
        self._add(Part(address))
        self.values.add(address)
        return address

    def derive(self, output, rule, inputs, initial=None):
        inputs = tuple(inputs)
        if rule in ARITY and len(inputs) != ARITY[rule]:
            raise ValueError(f"{rule} expects {ARITY[rule]} inputs")
        if rule == "delay" and (type(initial) is not int or initial not in (0, 1)):
            raise ValueError("a delay needs an initial bit")
        calc = Calculation(output + "/calc", (), rule, inputs, output, initial)
        if output in self.parts or calc.address in self.parts:
            raise ValueError(f"multiple producers for {output}")
        self._add(calc)
        self._add(Part(output, (calc.address,)))
        self.values.add(output)
        self.producers[output] = calc
        return output

    def fg(self, address, left, right, rule):
        verdict = self.derive(address + "/verdict", "check:" + rule, (left, right))
        validator = self.producers[verdict].address
        self._add(FunctionalGuarantee(address, (validator,), left, right, (validator,)))
        return verdict


class BaseModel:
    """Observation storage/protocol, not a scheduling algorithm."""

    def __init__(self, circuit, stimuli):
        self.circuit = circuit
        self.stimuli = dict(stimuli)
        self.cache = {}
        self.evaluations = []
        self._recorded = set()

    def remember(self, address, tick, value, calc=None):
        key = (address, tick)
        if key in self.cache and self.cache[key] != value:
            return Observation("conflict", reason=f"changed cached Part {key}")
        self.cache[key] = value
        if calc is not None:
            record = (calc.address, tick)
            if record not in self._recorded:
                self.evaluations.append(record)
                self._recorded.add(record)
        return Observation("ready", value)

    def leaf(self, address, tick):
        if type(tick) is not int or tick < 0:
            return Observation("conflict", reason="tick must be a nonnegative integer")
        if address not in self.circuit.values:
            return Observation("conflict", reason=f"unknown value Part: {address}")
        key = (address, tick)
        if key in self.cache:
            return Observation("ready", self.cache[key])
        if address in self.circuit.producers:
            return None
        if self.circuit.parts[address].depends:
            return Observation("conflict", reason=f"missing producer for {address}")
        if key not in self.stimuli:
            return Observation("pending", reason=f"missing input {address}@{tick}")
        value = self.stimuli[key]
        if type(value) is not int or value not in (0, 1):
            return Observation("conflict", reason=f"not a bit: {address}@{tick}={value!r}")
        return self.remember(address, tick, value)

    def seek_prefix(self, prefix, tick=0):
        root = prefix.rstrip("/")
        addresses = (address for address in self.circuit.values
                     if not root or address == root or address.startswith(root + "/"))
        return {address: self.seek(address, tick) for address in sorted(addresses)}

    def seek(self, address, tick=0):
        raise NotImplementedError
