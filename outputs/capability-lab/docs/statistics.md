# Statistics capabilities

All public functions accept one object and return a new result object. The modules use browser-safe ES modules and have no runtime dependencies. Inputs are finite JavaScript numbers; arrays must be nonempty where the operation needs observations, paired arrays must have equal lengths, and no function mutates its input.

## Moments and spread

`statistics.mean({values})` uses compensated summation and divides before summing to reduce overflow. It has a scaled fallback for subnormal averages such as `Number.MIN_VALUE`. Variance uses Welford's online update, which tracks a running mean and the sum of squared deviations (`M₂`) instead of subtracting two large raw moments. Results outside the finite double range fail with a range error.

`statistics.variance` and `statistics.standardDeviation` accept `denominator: 'population' | 'sample'`; both default to `population`. Population variance is `M₂/n` and accepts a singleton (variance 0). Sample variance is `M₂/(n-1)` and requires at least two observations. Standard deviation is the square root of the selected variance.

`statistics.onlineUpdate({state, value, denominator})` adds one value to `{count, mean, m2}` and returns those fields plus variance. Start with `{count: 0, mean: 0, m2: 0}` and pass the full returned result directly as the next call's state. The state schema allows an optional `variance` field for this loop; when present it must be finite and nonnegative, but it is derived metadata that is ignored and recomputed from count, mean, and M₂. Even a stale but valid variance does not affect the update. The default population variance is 0 for the first value; sample variance requires a second value. `statistics.onlineMoments({values, denominator})` applies the same Welford update to a batch and returns count, mean, M₂, and variance.

Weighted operations require equal-length `values` and `weights`, nonnegative weights, and at least one positive weight. `statistics.weightedMean` computes `Σ(wᵢxᵢ)/Σwᵢ`. `statistics.weightedVariance` computes `Σ(wᵢ(xᵢ-μw)²)/Σwᵢ`; it is a population-weighted variance. It does not apply a reliability-weight or unbiased sample correction. Zero-weight observations do not affect the mean or spread.

## Association, standardization, and comparisons

`statistics.covariance({x,y,denominator})` computes a running co-moment for matched arrays. It defaults to population normalization; sample covariance requires two pairs. `statistics.correlation({x,y})` is Pearson correlation, computed from the declared covariance and variance capabilities. It rejects either constant input because correlation is undefined when a standard deviation is zero.

`statistics.zScores({values, denominator})` returns each `(x - mean)/standardDeviation`, plus the mean and standard deviation used. Its default denominator is population. A constant sample is rejected because its z scores would divide by zero. `statistics.standardizedSummary` packages the same values with the mean and spread. Its descriptor has three actual dependency layers from variance → standard deviation → z scores → standardized summary.

`statistics.pairedDifferences({x,y})` returns `x[i] - y[i]`; the arrays must have the same length. `statistics.bootstrapPairedDifferenceCI` uses those matched differences. For independent groups, `statistics.welchMeanDifference({a,b})` returns each sample mean, the `mean(a)-mean(b)` estimate, Welch standard error, Welch-Satterthwaite degrees of freedom, and the resulting test statistic. It requires at least two values per group and rejects a zero standard error. It does not report a p-value because this package does not include a t-distribution CDF.

## Order and robust summaries

`statistics.count({values})` counts finite observations, and `statistics.sum({values})` uses Neumaier compensated summation. Both accept an empty array and return 0. For example, the sum of `[1e16, 1, -1e16]` is 1 rather than losing the small middle term. `statistics.extrema({values})` returns minimum and maximum; `statistics.range({values})` composes extrema and returns `max - min`. Extrema and range require at least one observation, and range rejects a result outside the finite double range.

`statistics.quantile` uses Hyndman-Fan type 7: for probability `p`, it interpolates at position `(n-1)p` in the sorted sample. `p` ranges from 0 through 1. `statistics.median` is the 0.5 quantile. `statistics.rank` uses one-based ranks and supports average, minimum, maximum, dense, or stable input-order ordinal ties. `statistics.empiricalCdf` returns the fraction of observations less than or equal to each query point. The standalone `histogram({values,bins})` function accepts an equal-width bin count or an array of explicit increasing edges. Its descriptor accepts an equal-width `bins` count or explicit `edges` in `{values,edges}`; passing both is rejected. Values outside explicit edges are omitted and the rightmost edge is inclusive.

`statistics.describe` returns count, mean, variance, standard deviation, minimum, quartiles, median, and maximum; its denominator defaults to sample. `statistics.robustSummary` returns median, unscaled median absolute deviation, quartiles, and IQR.

## Seeded inference

`statistics.resampleWithReplacement({values,sampleSize,seed})` uses Xorshift32 and returns the seed with the sampled values. Seeds are unsigned 32-bit integers. Seed zero maps to the fixed nonzero internal state `0x6d2b79f5` so the generator cannot remain at zero. The bootstrap operation draws all replicate observations from one continuous seeded stream, then partitions them into samples; replay with the same data and seed returns the same interval.

`statistics.bootstrapMeanCI({values,replicates,seed,confidence})` reports the observed mean and the two percentile bounds at `(1-confidence)/2` and `1-(1-confidence)/2`. `statistics.bootstrapPairedDifferenceCI` applies the same operation to matched differences. Both require at least two observations and `0 < confidence < 1`. These are approximate percentile intervals; a small replicate count gives coarse bounds, and an interval can exclude the point estimate. The descriptors cap replicates at 1,000 and total sampled values (`replicates × sample size`) at 100,000 to bound execution traces. The resampling atom caps sample size at 100,000.

The bootstrap composition declares and calls its resampling, mean, and quantile dependencies. The paired bootstrap calls paired-difference and bootstrap-interval capabilities. Runtime traces therefore show the operations used to produce each interval.

## Validation and tolerances

Operations that require observations reject empty inputs; `count` and `sum` accept an empty array and return 0. Non-finite values, shape mismatches, negative weights, invalid denominator names, invalid seeds, and unsupported sample denominators fail explicitly. Constant z-score or correlation inputs and zero-standard-error Welch comparisons also fail rather than returning `NaN` or infinity. Inputs remain unchanged.

Tests compare exact values where arithmetic is exact and use absolute tolerances up to `1e-12` for ordinary floating fixtures; the large-offset mean fixture allows `1e-6` because values near `10^12` are spaced by roughly `1.2e-4` in IEEE-754 doubles. A test tolerance is an acceptance bound for that fixture, not a promise of uniform relative accuracy for all magnitudes.
