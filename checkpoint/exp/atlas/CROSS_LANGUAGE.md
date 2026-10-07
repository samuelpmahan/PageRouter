# Atlas cross-language motion composition

Run from the `source` directory:

```sh
node scripts/atlas-cross-language.mjs capture case.json
python exp/atlas/cross_language.py case.json python.json
node scripts/atlas-cross-language.mjs compare case.json python.json
```

For another model or decision threshold, write an options file such as
`{"gain":3,"bias":-2,"min_mean":0.95}` and pass it as the third argument
to `capture`.

The captured case is the existing Atlas six-node recipe with its literal
training rows, ten queries, observed values, prior, policy, specification,
and optional implementation identity. Its SHA-256 `case_id` pins those
inputs and bindings. It is an Atlas recipe envelope, not the historical
ReplayString implementation. JavaScript executes the recipe through
`AtlasRuntime` and HH `PxC.compose`; Python independently computes the
same declared observables. The comparator composes a real PxC FG
Calculation Part over the two observation Parts. It reports the first
different path and values, including a rejected imported observation.

The numerical comparator uses absolute tolerance `1e-9`. The fixture
is a finite ten-query motion check and a Beta posterior based on the
declared independent-Bernoulli assumption; agreement does not prove
arbitrary-input equivalence.

Unit checks:

```sh
node exp/atlas/cross-language.test.mjs
python -m unittest exp/atlas/test_cross_language.py -v
```
