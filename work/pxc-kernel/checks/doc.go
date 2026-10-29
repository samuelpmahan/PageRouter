// Package ringgate runs two checks on PxC's ring gate, the concentric-rim gate in thro/crop/silhouette
// (PageRouter, claude/thro-iterations-v2, checkpoint/sources/pxcube/experiences/thro/thro-silhouette.mjs):
//
//	outsideConcentric = ringBg(e, rho = 1.04, quantile q = 0.25);  gate: outsideConcentric >= T = 13
//
// Check 1, decomposability: the gate compiled to a Boolean circuit (a selection network over the ring samples, each sample
// switched by a shared leaf for the rim fit), every AND node checked for children that share an uncertain leaf, every OR node
// checked for children that can be true together, then the circuit compiled by Shannon expansion into a decision diagram, and
// the Boolean, tropical (max, +) and probability (+, x) readings checked against brute-force enumeration before and after.
//
// Check 2, symmetries: a loss over the photos the gate was set on, perturbed along each pair of constants (rho, q), (rho, T),
// (q, T), with the Hessian's eigen-directions at (1.04, 0.25, 13) telling which moves leave the loss flat.
//
// testdata/rings.json is produced by harness/extract.mjs from Argon's rim fit and the silhouette Calculation, copied unchanged.
// The harness is not in main: it runs copies of rimfit.mjs and thro-silhouette.mjs from claude/thro-iterations-v2, and a second
// copy of those files in main would drift from the originals. testdata holds what it produced, so every check here runs from main.
package ringgate
