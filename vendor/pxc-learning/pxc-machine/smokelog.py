"""Lossless trace transport: MSB-first packed integers in canonical Base64.

SHA-256 here checks byte-content integrity, not semantic equality or provenance.
Version 1 admits fulfilled integer bits only; None and Boolean are rejected.
Original array order and duplicate entries are retained, including bad evidence.
"""
import base64
import binascii
from copy import deepcopy
import hashlib
import json
import re

FORMAT = 'pxc-smokelog'
ENUMS = {'seek': {'0': 'evaluated', '1': 'reused'}}
FIELDS = ('values', 'evaluated', 'reused', 'pxcLog', 'seekLog')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, limit):
    require(type(value) is int and 0 <= value < limit, f'expected integer in [0,{limit}), got {value!r}')
    return value


def encode(values, width):
    out, pending, count = bytearray(), 0, 0
    for value in values:
        integer(value, 1 << width)
        pending = (pending << width) | value; count += width
        while count >= 8:
            count -= 8; out.append((pending >> count) & 255)
            pending &= (1 << count)-1
    if count:
        out.append(pending << (8-count))
    return {'width': width, 'count': len(values), 'data': base64.b64encode(out).decode('ascii')}


def decode(block, width):
    require(type(block) is dict and set(block) == {'width', 'count', 'data'}, 'unknown packed block fields')
    require(type(block['width']) is int and block['width'] == width, 'wrong packed width')
    count = block['count']
    require(type(count) is int and count >= 0, 'invalid packed count')
    require(type(block['data']) is str, 'Base64 must be a string')
    try:
        raw = base64.b64decode(block['data'], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError('invalid Base64') from exc
    require(base64.b64encode(raw).decode('ascii') == block['data'], 'noncanonical Base64 padding')
    require(len(raw) == (count*width+7)//8, 'truncated or extra packed bytes')
    padding = (-count*width) % 8
    require(not padding or raw[-1] & ((1 << padding)-1) == 0, 'nonzero packed padding bits')
    result, pending, available = [], 0, 0
    for byte in raw:
        pending = (pending << 8) | byte; available += 8
        while available >= width and len(result) < count:
            available -= width; result.append((pending >> available) & ((1 << width)-1))
            pending &= (1 << available)-1
    return result


def shape(trace):
    require(type(trace) is dict and trace.get('schema') == 'pxc-machine/v1', 'unknown trace schema')
    require(all(type(trace.get(field)) is list for field in ('addresses', 'calculations', 'states')), 'missing trace arrays')
    return len(trace['addresses']), len(trace['calculations'])


def transform(trace, packing):
    addresses, calculations = shape(trace)
    width = max(1, (max(1, calculations)-1).bit_length())
    for state in trace['states']:
        require(type(state) is dict and all(field in state for field in FIELDS), 'missing state fields')
        for field in FIELDS:
            pair = field in ('pxcLog', 'seekLog')
            bits = 1 if field == 'values' else width + int(pair)
            rows = state[field]
            if packing:
                require(type(rows) is list, 'state field must be a list')
                if field == 'values':
                    require(len(rows) == addresses, 'value/address count mismatch')
                    values = [integer(value, 2) for value in rows]
                elif pair:
                    require(all(type(row) is list and len(row) == 2 for row in rows), 'invalid log row')
                    values = [(integer(row[0], calculations) << 1) | integer(row[1], 2) for row in rows]
                else:
                    values = [integer(value, calculations) for value in rows]
                state[field] = encode(values, bits)
            else:
                values = decode(rows, bits)
                if field == 'values':
                    require(len(values) == addresses, 'value/address count mismatch')
                    state[field] = values
                elif pair:
                    state[field] = [[integer(value >> 1, calculations), value & 1] for value in values]
                else:
                    state[field] = [integer(value, calculations) for value in values]
    return trace


def pack_trace(trace):
    """Return an independent packed copy. This codec never repairs execution logs."""
    # Validate before canonicalization so invalid booleans/None cannot masquerade as bits.
    packed = transform(deepcopy(trace), True)
    return {'format': FORMAT, 'version': 1, 'bitOrder': 'msb-first', 'enums': deepcopy(ENUMS),
            'traceSha256': hashlib.sha256(canonical(trace)).hexdigest(), 'trace': packed}


def unpack_trace(packed):
    require(type(packed) is dict and set(packed) == {'format', 'version', 'bitOrder', 'enums', 'traceSha256', 'trace'}, 'unknown packed envelope')
    require(packed['format'] == FORMAT and type(packed['version']) is int and packed['version'] == 1, 'unknown packed schema')
    require(packed['bitOrder'] == 'msb-first' and packed['enums'] == ENUMS, 'unknown bit order or enum')
    digest = packed['traceSha256']
    require(type(digest) is str and re.fullmatch('[0-9a-f]{64}', digest) is not None, 'invalid integrity digest')
    trace = transform(deepcopy(packed['trace']), False)
    require(hashlib.sha256(canonical(trace)).hexdigest() == digest, 'trace integrity mismatch')
    return trace
