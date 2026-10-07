"""Codec preserves evidence, including bad order/duplicates; it does not repair it."""
import base64
from copy import deepcopy
import json
import unittest
from core import Net, run_net
from smokelog import pack_trace, unpack_trace


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def specimen(delta=False):
    net = Net('codec'); q = net.nand('q', net.const(0), net.const(1)); net.bus('Q', [q])
    return run_net(net, 3, delta=delta)


class SmokelogTests(unittest.TestCase):
    def test_actual_full_and_delta_roundtrip_is_byte_canonical(self):
        for delta in (False, True):
            trace = specimen(delta)
            packed = pack_trace(trace)
            self.assertEqual(canonical(unpack_trace(packed)), canonical(trace))
            self.assertEqual(canonical(unpack_trace(json.loads(canonical(packed)))), canonical(trace))
            self.assertEqual(canonical(pack_trace(trace)), canonical(packed))
            packed['trace']['name'] = 'changed'
            self.assertEqual(trace['name'], 'codec')

    def test_preserves_bad_order_and_duplicate_rows(self):
        trace = specimen(delta=True)
        for state in trace['states']:
            for field in ('evaluated', 'reused', 'pxcLog', 'seekLog'):
                state[field] = list(reversed(state[field])) + state[field][:1]
        self.assertEqual(unpack_trace(pack_trace(trace)), trace)

    def test_rejects_unknown_schema_enum_and_non_bits(self):
        for field, value in [('values', [True]), ('values', [None]), ('values', [2]),
                             ('evaluated', [True]), ('evaluated', [2]), ('pxcLog', [[0, True]]), ('seekLog', [[0, 2]])]:
            trace = specimen()
            trace['states'][0][field] = value + trace['states'][0]['values'][1:] if field == 'values' else value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                pack_trace(trace)
        trace = specimen(); trace['schema'] = 'pxc-machine/future'
        with self.assertRaises(ValueError): pack_trace(trace)
        for key, value in [('version', 2), ('version', True), ('format', 'unknown'),
                           ('enums', {'seek': {'0': 'evaluated', '2': 'reused'}})]:
            packed = pack_trace(specimen()); packed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): unpack_trace(packed)

    def test_corruption_truncation_padding_and_metadata_fail(self):
        good = pack_trace(specimen())
        for mutation in ('flip', 'truncate', 'pad-bit', 'base64-garbage', 'base64-padding', 'wrong-width', 'negative-count', 'bool-count', 'extra-field'):
            packed = deepcopy(good); block = packed['trace']['states'][0]['values']
            raw = bytearray(base64.b64decode(block['data']))
            if mutation == 'flip':
                raw[0] ^= 0x80; block['data'] = base64.b64encode(raw).decode()
            elif mutation == 'truncate': block['data'] = base64.b64encode(raw[:-1]).decode()
            elif mutation == 'pad-bit':
                self.assertNotEqual(block['count'] % 8, 0)
                raw[-1] |= 1; block['data'] = base64.b64encode(raw).decode()
            elif mutation == 'base64-garbage': block['data'] += '\n'
            elif mutation == 'base64-padding': block['data'] = block['data'].rstrip('=')
            elif mutation == 'wrong-width': block['width'] += 1
            elif mutation == 'negative-count': block['count'] = -1
            elif mutation == 'bool-count': block['count'] = True
            else: block['unknown'] = 1
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): unpack_trace(packed)

    def test_dictionary_and_remaining_state_fields_are_integrity_bound(self):
        for mutate in (lambda p: p['trace']['addresses'].reverse(),
                       lambda p: p['trace']['states'][0]['fg'].update(passed=123)):
            packed = pack_trace(specimen()); mutate(packed)
            with self.assertRaisesRegex(ValueError, 'integrity'): unpack_trace(packed)


if __name__ == '__main__':
    unittest.main()
