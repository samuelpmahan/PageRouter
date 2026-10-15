# Contest A · statistics and linear algebra: claims and visual verdicts

Renders: `verify/out/a1-zscores.png`, `a2-leastsquares.png`, `a3-leastsquares-cached.png`, `a4-zscores-welford.png` (from `node verify/render-a.mjs verify/out`).

| # | Claim | Where to look | Verdict |
|---|---|---|---|
| A-1 | `stat.zScores([2,4,6])` returns values `[-1.22474, 0, 1.22474]`, mean 4, standard deviation 1.63299 | a1, box #1 output rows | PASS |
| A-2 | The composition calls mean, standard deviation, then standardize, in that order | a1, boxes #2, #3, #5 top to bottom | PASS |
| A-3 | `denominator` reaches standard deviation as a literal | a1, box #3 row `denominator = "population" literal` | PASS |
| A-4 | `center` comes from `#2 value` and `scale` from `#3 value` | a1, blue brackets: dot on #2 `value` → arrow on #5 `center`; dot on #3 `value` → arrow on #5 `scale` | PASS (second render; first render ambiguous, see ledger seq 8) |
| A-5 | Standard deviation is implemented by calling variance (an imperative implementation that uses another contract) | a1, box #4 `stat.variance` nested under #3 | PASS |
| A-6 | Least squares on `[[1,0],[1,1],[1,2],[1,3]]`, `[1,3,5,7]` gives coefficients `[1, 2]` | a2, box #1 and box #14 output | PASS |
| A-7 | `lin.matmul` transposes its `b`, which here is the same matrix #2 already transposed, so #4 is a cache hit | a2, box #4 hatched header "cached", input equals #2's input | PASS. Flow finding: least squares transposes X twice; the cache hides the cost |
| A-8 | Matrix-vector rows are passed as path projections, not recomputed values | a2, dashed edges into #6/#7 `a` and dashed blue into #5/#8 `vector` | PASS |
| A-9 | An identical second run is one cached call | a3, single hatched box | PASS |
| A-10 | Swapping `stat.variance` to Welford changes only call #4's implementation | a4 vs a1: identical except #4 reads `stat.variance/welford` | PASS |
