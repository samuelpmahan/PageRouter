"""Replay the bounded capability experiments and retain their current evidence."""
import hashlib
import io
import json
from pathlib import Path
import unittest

import composition
import cpu
import storage
import test_runtime


HERE = Path(__file__).resolve().parent


def main():
    stream = io.StringIO()
    suite = unittest.defaultTestLoader.loadTestsFromModule(test_runtime)
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise AssertionError(stream.getvalue())
    reports = {'storage': storage.probe(), 'cpu': cpu.probe(), 'composition': composition.probe()}
    if reports['cpu']['failures']:
        raise AssertionError(reports['cpu']['failures'])
    for name, value in reports.items():
        (HERE / f'{name}-report.json').write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')
    files = [p for p in HERE.rglob('*') if p.suffix in ('.py', '.html', '.mjs')]
    summary = dict(
        status='PASS', scope='Finite experimental declarations and explicit cases; no universal program synthesis claim.',
        runtime={'cases': result.testsRun, 'output': stream.getvalue()},
        storage=reports['storage']['checks'], cpu=reports['cpu']['checks'],
        integration=reports['composition']['checks'],
        sourceHashes={str(p.relative_to(HERE)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)},
        browserEvidence='ui/browser-results.json (generated separately by a real browser; not rerun by this command)')
    (HERE / 'verification.json').write_text(json.dumps(summary, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'status': summary['status'], 'runtimeCases': result.testsRun,
                      'memoryCases': reports['storage']['checks']['exhaustive_cases'],
                      'cpuCases': reports['cpu']['observations']['casesCompared'],
                      'compositionChecks': reports['composition']['checks']}, indent=2))


if __name__ == '__main__':
    main()
