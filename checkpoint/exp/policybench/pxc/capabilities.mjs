// Generated from D:/t-t-1/packages/pxc/src/capabilities.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
/**
 * Capabilities: what a thing IMPLEMENTS and what implementations it SUPPORTS.
 *
 *  - A Contract names a capability and its ports (what it consumes, what it emits), plus conformance checks that
 *    actually run (FunctionalGuarantees with receipts, not just declarations).
 *  - An Implementation implements one contract and may expose Slots: named holes, each typed by a contract, that any
 *    conforming implementation can fill. Configuration is choosing fillers; extension is registering a new filler.
 *  - "Proven" means: this implementation passed its contract's checks, and there is a receipt saying so.
 *
 * As PxC: a contract is a typed-port annotation, an implementation's `calculate` is a Calculation Part, filling a slot is
 * a compose input binding, and a conformance run is a composition whose receipt is the proof.
 */
import { Part, PxC } from '../../../sources/pxcube/vendor/studio/part-first-kernel/src/pxc.mjs';
export class CapabilityGraph {
    contracts = new Map();
    impls = new Map();
    proofs = [];
    contract(c) {
        if (this.contracts.has(c.id))
            throw new Error(`contract ${c.id} already registered`);
        this.contracts.set(c.id, c);
        return c;
    }
    implement(impl) {
        if (!this.contracts.has(impl.implements))
            throw new Error(`${impl.id} implements unknown contract ${impl.implements}`);
        if (this.impls.has(impl.id))
            throw new Error(`implementation ${impl.id} already registered`);
        for (const [slot, s] of Object.entries(impl.supports ?? {})) {
            if (!this.contracts.has(s.contract))
                throw new Error(`${impl.id} slot ${slot} uses unknown contract ${s.contract}`);
        }
        this.impls.set(impl.id, impl);
        return impl;
    }
    get(id) {
        const i = this.impls.get(id);
        if (!i)
            throw new Error(`unknown implementation ${id}`);
        return i;
    }
    /** Implementations that can fill a contract-typed slot. */
    implementationsOf(contractId) { return [...this.impls.values()].filter((i) => i.implements === contractId); }
    /**
     * Fill an implementation's slots. Every filler must implement the slot's contract; unknown slots are rejected, so a
     * typo can never silently fall back to a default.
     */
    fill(implId, fills = {}) {
        const impl = this.get(implId);
        const slots = impl.supports ?? {};
        for (const k of Object.keys(fills))
            if (!slots[k])
                throw new Error(`${implId} has no slot "${k}" (slots: ${Object.keys(slots).join(', ') || 'none'})`);
        const out = {};
        for (const [slot, s] of Object.entries(slots)) {
            const filler = this.get(fills[slot] ?? s.default);
            if (filler.implements !== s.contract)
                throw new Error(`${filler.id} implements ${filler.implements}, but slot ${implId}.${slot} needs ${s.contract}`);
            out[slot] = filler;
        }
        return out;
    }
    /** Run every check of an implementation's contract through PxC, so each result is a composition with a receipt. */
    async prove(implId, at = new Date().toISOString()) {
        const impl = this.get(implId);
        const contract = this.contracts.get(impl.implements);
        const pxc = new PxC();
        pxc.set('impl', new Part(impl.value));
        const out = [];
        for (const check of contract.checks) {
            pxc.set(`check/${check.id}`, new Part(async ({ impl: v }) => check.run(v)));
            let result;
            try {
                result = (await pxc.compose({ into: `proof/${check.id}`, calculation: `check/${check.id}`, inputs: { impl: 'impl' } })).value;
            }
            catch (e) {
                result = { ok: false, detail: e instanceof Error ? e.message : String(e) };
            }
            out.push({ impl: implId, contract: contract.id, check: check.id, ok: result.ok, ...(result.detail ? { detail: result.detail } : {}), at });
        }
        this.proofs.push(...out);
        return out;
    }
    /** The ledger: every contract with its implementations, slots and proof status. */
    ledger() {
        return [...this.contracts.values()].map((c) => ({
            contract: c.id, description: c.description, consumes: Object.keys(c.consumes), emits: Object.keys(c.emits),
            implementations: this.implementationsOf(c.id).map((i) => {
                const proofs = this.proofs.filter((p) => p.impl === i.id);
                return {
                    id: i.id, description: i.description, origin: i.origin ?? null,
                    supports: Object.fromEntries(Object.entries(i.supports ?? {}).map(([k, s]) => [k, s.contract])),
                    status: proofs.length === 0 ? 'unproven' : proofs.every((p) => p.ok) ? 'proven' : 'failing',
                    failed: proofs.filter((p) => !p.ok).map((p) => `${p.check}: ${p.detail ?? ''}`),
                };
            }),
        }));
    }
}
