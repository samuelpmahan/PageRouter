"""WitnessFG prototype: immutable evidence and scoped verdicts."""
from dataclasses import dataclass
from hashlib import sha256
import json

def digest(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

@dataclass(frozen=True)
class Evidence:
    id: str
    claim: str
    kind: str
    method: str
    inputs: tuple[str, ...]
    result: str
    scope: str

    @staticmethod
    def create(claim, kind, method, inputs, result, scope):
        if kind not in ('supporting', 'counterexample'):
            raise ValueError('invalid evidence kind')
        inputs = tuple(inputs)
        payload = dict(claim=claim, kind=kind, method=method, inputs=inputs, result=result, scope=scope)
        return Evidence(digest(payload), **payload)

@dataclass(frozen=True)
class WitnessFG:
    claim: str
    scope: str
    obligations: tuple[str, ...]
    evidence: tuple[Evidence, ...] = ()

    def append(self, item):
        if item.claim != self.claim or item.scope != self.scope:
            raise ValueError('evidence does not belong to this claim/scope')
        if any(old.id == item.id for old in self.evidence):
            return self
        return WitnessFG(self.claim, self.scope, self.obligations, self.evidence + (item,))

    @property
    def verdict(self):
        if any(e.kind == 'counterexample' for e in self.evidence):
            return 'challenged'
        if self.evidence:
            return 'supported'
        return 'unverified'

    @property
    def provenance(self):
        return tuple(e.id for e in self.evidence)
