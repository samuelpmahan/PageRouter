# HH browser-local workbench adapter

## FG Part association

`fg-association.mjs` derives a selected output's declared Part closure from an existing `AnnotationFG.compose` graph. It reads the FG's typed ports, bindings, guarantees, and child function/source roles; it does not run a Calculation or create another type registry.

```js
import {deriveFGAssociations} from './fg-association.mjs';

const plan = deriveFGAssociations({
  fg,                         // existing AnnotationFG.compose result
  output: 'decision',         // an exposed FG emit port
  addresses: {fit: '/calc/fit', predict: '/calc/predict'},
  inputAddresses: {training: '/parts/training'},
  pxc,                        // optional actual PxC store for preflight
});
console.log(plan.closure.partAddresses, plan.edges);
```

The result contains the selected output, reachable child FGs with their guarantees and Part addresses, typed edges, exposed input associations, and a topologically ordered closure. The same source/model Part can be associated with different FG graphs to obtain different declared closures. A missing binding, cycle, missing Part, or non-function Calculation Part is rejected before execution. `AnnotationFG.compose` itself rejects incompatible type or tag edges when the graph is declared. This projection currently treats a nested composed child as one Calculation Part, matching the existing annotation runtime's nested wrapper receipt.

`hh-workbench.mjs` adapts the vendored HH fixture services into the composed runner. It imports the copied services from `../../vendor/hh/services/` and always constructs the explicit synthetic fixture provider. No HTTP provider, server, or live account is selected.

## Entry point

```js
import {createHHWorkbench} from './exp/cooperative/hh-workbench.mjs';

const workbench = createHHWorkbench({storage: window.sessionStorage});
const capabilities = workbench.listCapabilities();
const call = await workbench.invoke('school.states', {});
```

`storage` is optional and can be any Storage-like object. When omitted, the existing fixture provider uses `window.sessionStorage` when available and volatile memory otherwise.

## API and return values

- `listCapabilities()` returns the 14 real HH service adapters. Each item has JSON-Schema-shaped `inputs` plus `outputs` ports (result-relative paths with declared-contract provenance). The example input is ready for an invocation form.
- `listOperations()` combines those base services with active Calculation aliases and pinned-version entries, so an editor can wire and reuse a calculation or deliberately select a historical version.
- `listWorkflows()` returns the available named presets and their input examples.
- `invoke(operation, inputs)` returns `{ok, capabilityId, port, result, value, part, receipt}`. The `part` and `receipt` are actual objects from the same vendored PxC store. A calculation operation returns its nested stage outputs and its real calculation invocation Part/receipt. Credential-shaped inputs are rejected before a request Part is created.
- `compose({name, stages, inputs, inputSchema, stopOnFailure})` runs one to 32 ordered stages. Each stage is `{id, operation, inputs}` and can use a base service or a defined Calculation. Inputs may use `{$input:'parameter.path'}` for runtime inputs or `{$ref:'earlierStageId.path'}` to bind actual earlier outputs. By default, the first rejected service/calculation result ends the run; `stopOnFailure:false` continues independent stages.
- `defineCalculation({id, plan, inputSchema?, outputs?, replace?})` stores source-plan metadata and registers an actual function-valued Calculation Part in the existing PxC. It returns `{ok,definition}`. Input schemas accept JSON Schema's `type`, `properties`, `required`, and optional `example` (the supported property types are string, number, boolean, object, array, and any). If outputs are omitted, declared output ports are inferred from the last stage and exposed as `outcomes.<lastIndex>.result.<portPath>`; unknown outputs remain marked unknown. Existing aliases require `replace:true` to define another version.
- Nested Calculation references are pinned to `calculation.<id>@<version>` when a definition is saved. Replacing an alias creates a new address and preserves old Parts, receipts, and nested dependencies.
- `listDefinedCalculations()` returns active descriptors; `listCalculationVersions(id?)` returns all versions. Descriptors include `plan`, `inputSchema`, output ports, the actual Part address, and a structured `sourceGraph` containing nodes, bindings, parameters, and interface ports.
- `exportSession()` returns data-only `{format:'hh-workbench-session',version:1,definitions:[...]}` source suitable for saving, sharing locally, or refining. It contains no functions, evaluated code, or credentials. `importSession(data)` validates every ID, stage, parameter, dependency, cycle, version, and address before installing any Calculation Parts; import does not execute the saved plans.
- `listParts()` and `inspectPart(address)` safely inspect actual kernel Parts, values, producer/input addresses, and receipt status without calling a Calculation or getter. Function-valued Parts are identified as executable rather than serialized. These inspection methods are read-only.
- `compose({workflow:'schoolSearch', state, county, district, chooseFirst})` performs hierarchical lookup calls. `chooseFirst:true` selects the first fixture result for each unspecified level.
- `compose({workflow:'teacherOnboarding', teacher, school, profile?, openPublicProfile?})` registers, simulates approval, performs demo login, and optionally creates and publicly reads the new profile.
- Other presets are `approvalLogin` (explicit `teacherId` and email), `profilePublish` (requires a current demo session), and `publicDirectory` (reads listed profile IDs).
- `reset()` invokes the real `Demo.reset` service. `snapshot()` exposes the provider's current safe journey snapshot. `inspect()` returns serializable capabilities, defined-calculation descriptors, snapshot, and kernel part/receipt projections; inspecting adds no Part or receipt.

Each accepted direct HH invocation is still executed by the recovered service runtime, which adds one actual request/result Part pair and a kernel receipt. Rejected unsafe inputs are stopped before request Parts. Composition additionally adds its request, Calculation, and outer result Parts/receipt. There is no duplicate registry or fabricated service-call log. Since PxC is append-only, the adapter serializes calls to keep each returned Part paired with its receipt.

All outcomes are fixture-only and user-editable per-tab state. Email, password authentication, durable profile sharing, real approval, external wishlist navigation, and payments are outside this adapter.

## Example: compose a teacher journey

```js
const run = await workbench.compose({
  workflow: 'teacherOnboarding',
  teacher: {name: 'Demo Compose Teacher', email: 'compose.teacher@fixture.test', phoneNumber: 'DEMO'},
  school: {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'},
  profile: {
    displayName: 'Demo Compose Teacher', bio: 'A synthetic classroom.', subjects: ['Science'],
    wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW',
  },
  openPublicProfile: true,
});

console.log(run.outcomes.map(({id, ok, result}) => ({id, ok, outcome: result.outcome})));
```

`hh-workbench.test.mjs` is the focused Node test suite for direct invocation, ordered school search, end-to-end teacher onboarding, failure guards, and secondary presets.

## Example: define a reusable Calculation

```js
const definition = await workbench.defineCalculation({
  id: 'schoolDirectory',
  inputSchema: {
    type: 'object', required: ['state'],
    properties: {state: {type: 'string', description: 'Fixture state to search'}},
    example: {state: 'Demo Washington'},
  },
  plan: {name: 'Schools for a state', stages: [
    {id: 'counties', operation: 'school.counties', inputs: {state: {$input: 'state'}}},
    {id: 'districts', operation: 'school.districts', inputs: {state: {$input: 'state'}, county: {$ref: 'counties.data.values.0'}}},
    {id: 'schools', operation: 'school.schools', inputs: {state: {$input: 'state'}, county: {$ref: 'counties.data.values.0'}, district: {$ref: 'districts.data.values.0'}}},
  ]},
});
const result = await workbench.invoke(definition.definition.operation, {state: 'Demo Washington'});
```
