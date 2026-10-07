"""Base CPU assembly plus interrupt instructions and explicit ROM origins."""
import re

from circuits import assemble


INTERRUPT_OPCODES = {'EI': 0x01, 'DI': 0x02, 'IRET': 0x03}


def assemble_interrupts(source):
    """Assemble 16 bytes; .ORG sets the next address without emitting a byte."""
    if not isinstance(source, str):
        raise ValueError('Assembly source must be text')
    labels, statements, occupied = {}, [], set()
    address = 0
    for line_no, raw in enumerate(source.splitlines(), 1):
        line = re.split(r'[;#]', raw, maxsplit=1)[0].strip().upper()
        if ':' in line:
            label, line = (part.strip() for part in line.split(':', 1))
            if not re.fullmatch(r'[A-Z_][A-Z_0-9]*', label) or label in labels:
                raise ValueError(f'Invalid or duplicate label on line {line_no}')
            if address >= 16:
                raise ValueError(f'Label is outside program memory on line {line_no}')
            labels[label] = address
        if not line:
            continue
        tokens = line.split()
        if tokens[0] == '.ORG':
            if len(tokens) != 2:
                raise ValueError(f'.ORG needs one literal operand, line {line_no}')
            try:
                origin = int(tokens[1], 0)
            except ValueError as exc:
                raise ValueError(f'.ORG needs a literal address, line {line_no}') from exc
            if not 0 <= origin < 16:
                raise ValueError(f'.ORG address must fit four bits, line {line_no}')
            address = origin
            continue
        if address >= 16:
            raise ValueError(f'Program exceeds 16 instruction words, line {line_no}')
        if address in occupied:
            raise ValueError(f'Overlapping instruction at address {address}, line {line_no}')
        occupied.add(address)
        statements.append((address, line_no, tokens))
        address += 1

    result = [0] * 16
    for address, line_no, tokens in statements:
        mnemonic = tokens[0]
        if mnemonic in INTERRUPT_OPCODES:
            if len(tokens) != 1:
                raise ValueError(f'{mnemonic} needs 0 operand(s), line {line_no}')
            result[address] = INTERRUPT_OPCODES[mnemonic]
        else:
            if len(tokens) == 2 and tokens[1] in labels:
                tokens[1] = str(labels[tokens[1]])
            try:
                result[address] = assemble(' '.join(tokens))[0]
            except ValueError as exc:
                raise ValueError(f'Source line {line_no}: {exc}') from exc
    return result
