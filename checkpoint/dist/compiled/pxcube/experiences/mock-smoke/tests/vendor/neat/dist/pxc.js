export function calculationId(value) {
    if (!/^fn\.[A-Za-z0-9._-]+$/.test(value)) {
        throw new Error(`Calculation identity must use the fn.* form: ${value}`);
    }
    return value;
}
export class MissingPartError extends Error {
    pxc;
    constructor(pxc, address){
        super(`Part not found: ${address}`);
        this.name = "MissingPartError";
        this.pxc = pxc;
    }
}
const emptyTelemetry = ()=>({
        reads: [],
        writes: [],
        invocations: [],
        events: []
    });
export function createPxC(parts = {}) {
    const map = new Map();
    if (parts instanceof Map) {
        parts.forEach((value, address)=>map.set(address, value));
    } else if (Array.isArray(parts)) {
        parts.forEach(({ address, value })=>map.set(address, value));
    } else {
        const record = parts;
        Object.keys(record).forEach((address)=>map.set(address, record[address]));
    }
    return {
        parts: map,
        calculations: new Map(),
        telemetry: emptyTelemetry()
    };
}
export function registerPart(pxc, address, value) {
    const parts = new Map(pxc.parts);
    parts.set(address, value);
    return {
        ...pxc,
        parts
    };
}
export function registerCalculation(pxc, calculation) {
    const id = calculationId(calculation.id);
    if (pxc.calculations.has(id)) {
        throw new Error(`Calculation already registered: ${id}`);
    }
    const calculations = new Map(pxc.calculations);
    calculations.set(id, calculation);
    return {
        ...pxc,
        calculations
    };
}
function appendEvent(pxc, event) {
    const events = [
        ...pxc.telemetry.events,
        event
    ];
    const reads = event.kind === "read" ? [
        ...pxc.telemetry.reads,
        event.receipt
    ] : pxc.telemetry.reads;
    const writes = event.kind === "write" ? [
        ...pxc.telemetry.writes,
        event.receipt
    ] : pxc.telemetry.writes;
    const invocations = event.kind === "invocation" ? [
        ...pxc.telemetry.invocations,
        event.receipt
    ] : pxc.telemetry.invocations;
    const telemetry = {
        reads,
        writes,
        invocations,
        events
    };
    return {
        ...pxc,
        telemetry
    };
}
function readPartInternal(pxc, address) {
    const sequence = pxc.telemetry.events.length;
    const found = pxc.parts.has(address);
    const receipt = {
        address,
        sequence,
        found
    };
    const next = appendEvent(pxc, {
        kind: "read",
        receipt
    });
    if (!found) throw new MissingPartError(next, address);
    return {
        pxc: next,
        value: pxc.parts.get(address)
    };
}
export function readPart(pxc, address) {
    return readPartInternal(pxc, address);
}
export function readPartValue(pxc, address) {
    return readPartInternal(pxc, address).value;
}
export const getPart = readPart;
export function writePart(pxc, address, value) {
    const sequence = pxc.telemetry.events.length;
    const receipt = {
        address,
        sequence,
        value,
        replaced: pxc.parts.has(address)
    };
    const parts = new Map(pxc.parts);
    parts.set(address, value);
    return appendEvent({
        ...pxc,
        parts
    }, {
        kind: "write",
        receipt
    });
}
export const setPart = writePart;
class NestedCalculationError extends Error {
    pxc;
    cause;
    constructor(pxc, cause){
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = "NestedCalculationError";
        this.pxc = pxc;
        this.cause = cause;
    }
}
function executeCalculation(pxc, id, args) {
    const calculation = pxc.calculations.get(id);
    if (!calculation) throw new Error(`Calculation not registered: ${id}`);
    const sequence = pxc.telemetry.events.length;
    const started = appendEvent(pxc, {
        kind: "invocation",
        receipt: {
            id,
            sequence,
            status: "completed",
            args
        }
    });
    let current = started;
    const context = {
        read (address) {
            try {
                const result = readPartInternal(current, address);
                current = result.pxc;
                return result.value;
            } catch (error) {
                if (error instanceof MissingPartError) current = error.pxc;
                throw new NestedCalculationError(current, error);
            }
        },
        write (address, value) {
            current = writePart(current, address, value);
        },
        invoke (nestedId, nestedArgs) {
            const childId = calculationId(String(nestedId));
            const child = executeCalculation(current, childId, nestedArgs);
            current = child.pxc;
            if (child.error) throw new NestedCalculationError(current, child.error);
            return child.value;
        }
    };
    try {
        const value = calculation.run(args, context);
        const invocation = {
            id,
            sequence,
            status: "completed",
            args,
            result: value
        };
        const invocations = current.telemetry.invocations.map((item)=>item.sequence === sequence ? invocation : item);
        const events = current.telemetry.events.map((event)=>event.kind === "invocation" && event.receipt.sequence === sequence ? {
                kind: "invocation",
                receipt: invocation
            } : event);
        return {
            pxc: {
                ...current,
                telemetry: {
                    ...current.telemetry,
                    invocations,
                    events
                }
            },
            value,
            invocation
        };
    } catch (error) {
        const cause = error instanceof NestedCalculationError ? error.cause : error;
        current = error instanceof NestedCalculationError ? error.pxc : current;
        const invocation = {
            id,
            sequence,
            status: "failed",
            args,
            error: cause
        };
        const invocations = current.telemetry.invocations.map((item)=>item.sequence === sequence ? invocation : item);
        const events = current.telemetry.events.map((event)=>event.kind === "invocation" && event.receipt.sequence === sequence ? {
                kind: "invocation",
                receipt: invocation
            } : event);
        return {
            pxc: {
                ...current,
                telemetry: {
                    ...current.telemetry,
                    invocations,
                    events
                }
            },
            invocation,
            error: cause
        };
    }
}
export function invokeCalculation(pxc, id, args) {
    return executeCalculation(pxc, calculationId(String(id)), args);
}
