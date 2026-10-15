# Controls

The tests that decided the kernel extraction (`exp/kernel/`) come from
trusted libraries, not from PageRouter. For each job a kernel does, the
library that defines that job runs its own test suite first. That is the
control: if the trusted library does not pass its own tests, the harness is
wrong and nothing else in that family counts. Then every PageRouter
implementation runs the same suite, and implementations with identical
results on every input form one behavior class.

```sh
bash ci/controls/fetch-trusted.sh /tmp/trusted     # pinned commits and tarball hashes
node ci/controls/harness.mjs /tmp/trusted ci/controls/results.json     # from checkpoint/
```

The harness needs `actions/called-shot`'s dependencies installed (it uses
tree-sitter to lift private functions out of their files) and network for the
fetch, so it runs outside the Bazel build.

| family | trusted library (its own tests) | control | PageRouter subjects |
|---|---|---|---|
| canonical JSON | canonicalize 5.1.0 suite, RFC 8785 reference vectors | 86/86, 6/6 | kernel `canonicalLax` 50/86, `canonicalJson` 46/86, kept Atlas 46/86, kept grid-engine 50/86, kept compression 43/86; all 6/6 on the vectors; 4 behavior classes |
| HTML escaping | escape-html 1.0.3 | 30/30 | kernel `esc` and frozen `escape` 28/30, one class |
| deep equality | fast-deep-equal 3.1.3 table, both argument orders | 110/110 | kernel `equalJson` 96/110 |
| deep freeze | deep-freeze 0.0.1 | 2/2 | kernel `freezeTree`, `freeze`, `freezeTreeParentFirst` 0/2 (they do not freeze functions) |
| SHA-256 | node:crypto on the NIST FIPS 180-2 examples | 4/4 | `scripts/import-closure.mjs` `sha256Hex` 4/4 |

`results.json` is the harness output for this tree. What each difference
from a trusted library means, and why it is kept, is in
`exp/kernel/README.md`.

The rule earned its place on its own harness: the first full run reported
escape-html and deep-freeze failing their own suites, because the wrapper
expected an ES module default export and both packages export the function
itself. The control caught it before any subject's result was read.

Each extraction lane also ran differentials too large to keep here: old
copies against the kernel on generated inputs, with outputs and thrown errors
compared (canonicalLax 5,022 values; canonicalJson 10,026; esc 22,035;
equalJson 600,236 pairs in both orders; the freeze functions a 57-case
battery; flagReader 2,000,000 argv arrays; the identity scripts 23 tree
mutations), with no differences.
