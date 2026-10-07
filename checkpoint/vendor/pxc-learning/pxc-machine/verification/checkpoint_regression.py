"""Replay an immutable predecessor request and compare its actual hardware history."""
import hashlib
import json
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
from pipeline import build_run
from smokelog import canonical, unpack_trace


def verify():
    checkpoint = BASE.parent / 'pxc-checkpoints/001'
    manifest = json.loads((checkpoint / 'manifest.json').read_text())
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    altered = [name for name, wanted in manifest['files'].items()
               if digest(checkpoint / name) != wanted]
    sources = ['core.py', 'circuits.py', 'pipeline.py', 'synthesis.py', 'smokelog.py',
               'oracle.py', 'verification/checkpoint_regression.py', '../lyceum/common.py']
    before = {name: digest(BASE / name) for name in sources}
    request = json.loads((checkpoint / 'pxc-machine/baseline-request.json').read_text())
    expected = unpack_trace(json.loads((checkpoint / 'pxc-machine/baseline-smokelog.json').read_text()))
    actual = build_run(request)
    # The input-bound audit deliberately has a stronger declared closure now.
    # Hardware identity/history and the original requested FG roots must persist.
    fields = ['addresses', 'calculations', 'constants', 'inputs', 'buses', 'busAddresses',
              'fgs', 'groups', 'composites', 'bom', 'plan', 'states']
    comparisons = {field: canonical(expected[field]) == canonical(actual[field]) for field in fields}
    comparisons['requestedFGs'] = expected['pipeline']['requested'] == actual['pipeline']['requested']
    after = {name: digest(BASE / name) for name in sources}
    changed = [name for name in sources if before[name] != after[name]]
    status = 'PASS' if (not altered and not changed and all(comparisons.values()) and
                        actual['oracle']['loss'] == 0 and actual['audit']['loss'] == 0) else 'FAIL'
    return {'schema': 'pxc-checkpoint-regression/v1', 'status': status,
            'predecessor': '001', 'checkpointManifestSha256': digest(checkpoint / 'manifest.json'),
            'modifiedCheckpointFiles': altered, 'comparedStates': len(actual['states']),
            'comparisons': comparisons, 'currentOracle': actual['oracle'], 'currentAudit': actual['audit'],
            'sourceSha256': after, 'changedSourcesDuringRun': changed,
            'intentionalExtension': 'The higher execution-evidence FG explicitly consumes supplied stimuli; hardware and recorded history are compared exactly.'}


if __name__ == '__main__':
    result = verify()
    (BASE / 'checkpoint-regression.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    raise SystemExit(result['status'] != 'PASS')
