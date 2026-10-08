# Linear algebra foundations

`src/linalg/basics.mjs` exports pure functions and `basicCapabilities`, the descriptors used by the workbench. A vector is an ordered list of numbers; a matrix is a table of rows and columns. The norm is a vector's length. A projection is the part of one vector that points along a chosen direction. Vectors and matrices are ordinary arrays of finite JavaScript numbers. A vector must contain at least one value; a matrix must contain at least one non-empty, equal-width row. Inputs are read only, and operations that create arrays return fresh arrays.

## Operations

The basic set includes vector addition, subtraction, scaling and division; dot and 3D cross products; Euclidean, L1 (sum of absolute values) and infinity (largest absolute component) norms; distance, normalization and projection. It also includes matrix addition and scaling, transpose (swap rows and columns), matrix multiplication, matrix-vector multiplication, and identity matrices. Rotation helpers use radians. `rotate3D` uses an axis and angle; `transform3D` accepts XYZ Euler angles and composes its rotation as Rz·Ry·Rx, after applying scale. Homogeneous transforms use a final coordinate of 1 and `applyTransform` divides output coordinates by w.

Named basic functions take positional arguments, such as `dot(a, b)`. Every descriptor's `run` method accepts one input object, such as `{a, b}`. Named functions in `numerics.mjs` also accept input objects. Descriptors declare those object shapes and their dependencies. A composed descriptor calls its declared lower-level capabilities through `ctx.call`, so the workbench can show the actual path. For example, projection calls normalization, dot product and vector scaling; normalization calls norm and vector division.

## Numerical limits

Inputs must be finite IEEE-754 JavaScript doubles. Shape mismatches, zero-vector normalization/projection directions, division by zero, and non-finite calculated results throw errors. The Euclidean norm uses repeated `Math.hypot`, which avoids squaring large values first; a mathematical result larger than the largest finite double still fails. Dot products use ordinary left-to-right floating-point accumulation, so cancellation and rounding can occur. There is no universal tolerance in the operations; compare computed results with a scale-aware tolerance appropriate to the caller. Tiny magnitudes can underflow to zero in intermediate arithmetic, as with any IEEE-754 double implementation.

`identity(size)` accepts safe integer sizes 1 through 1000. `cross` is defined only for 3D vectors. The transform application helper accepts 3×3/2D and 4×4/3D matrices and matching points; it rejects a transformed w of zero. This helper accepts general homogeneous matrices even though `transform2D` and `transform3D` produce affine matrices.

## Numerical methods

The higher-order functions use the default relative tolerance `1e-12`; callers can pass a finite `tolerance` in `[0, 1)`. Pivot and singularity checks compare a candidate value with `tolerance × the largest absolute matrix entry`. The scale is not forced up to 1, so uniformly multiplying a matrix does not change this cutoff rule while the values and threshold remain representable. Tolerance controls which small pivots count as zero; it does not promise that an accepted solution is accurate. With tolerance zero, LU and determinant use exact-zero pivot checks.

`rowEchelon` and `rank` use partial row pivoting: at each column they choose the largest available pivot to reduce division by a tiny value. `luDecompose` returns a row permutation and triangular factors with `P A = L U`; `solve` then uses forward and back substitution. `inverse` solves once for each coordinate vector. `determinant` multiplies the diagonal values from LU; an intermediate overflow throws even if a later factor could make the final mathematical product finite.

`householderFactor` reflects matrix columns into an economy factorization `A = Q R`; economy means `Q` has only as many columns as the input matrix, while still having orthonormal columns. `R` is upper triangular. `qr` combines that factorization with the separate `rank` capability, so a zero first column does not hide independent later columns. No column pivoting is used. `leastSquares` minimizes squared residuals for an overdetermined, full-column-rank system and returns the fitted coefficients, residuals (`b − A x`), and residual length. It does not return a minimum-length solution for a rank-deficient system.

`cholesky` factors a symmetric positive-definite matrix as `L Lᵀ`. Positive definite means `xᵀ A x > 0` for every nonzero vector `x`; nonsymmetric or non-positive pivots fail. `symmetricEigen` requires a symmetric matrix and repeatedly rotates its largest off-diagonal entry toward zero. It sorts eigenvalues from largest to smallest; each matching eigenvector is a column. Its default iteration limit is `min(100000, max(1, 50n²))`; inspect the returned `converged` flag before using eigen results. `quadraticFormOfInverse` computes `vᵀ A⁻¹ v`, which is not a distance measure for indefinite or nonsymmetric matrices.

The detailed numerical rationale, including known limits, algorithm choices, and retained red/green evidence, is in [numerics-rationale.md](../evidence/linalg/numerics-rationale.md).

## Verification rationale

The basic tests use hand-calculated fixtures (such as the 3-4-5 norm, a right-handed basis cross product, a 2×2 product, and translation of a point). Independent invariants check that rotations preserve length. Failure cases cover non-finite inputs, arithmetic overflow, dimension mismatch, ragged matrices, zero denominators, and sparse arrays. Frozen inputs and before/after snapshots check that calls do not mutate their arguments. Descriptor examples run through a small trace-aware dispatcher that enforces declared direct dependencies and compares their results to literal expected values.
