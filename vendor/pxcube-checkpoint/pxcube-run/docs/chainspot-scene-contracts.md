# ChainSpot matching experiment scene contracts

Status: contract only. This file adds no detector, geometry algorithm, default, or result. The exact S6 target anchor remains unresolved.

## Shared PxC handler surface

The experiment is a named scene assembled over a producer-owned PxC store. Each Calculation declares exact input/output Part addresses, Run Args, View Args, and runtime identity. Ticks record the actual Calculation invocations and Part traffic. Shared Parts are consumed by address; scenes do not infer coordinates or clone another Part registry.

## S4 · tee candidates

- Canonical output: one downstream Tee semantic Part shape whether the supporting evidence came from a visible tee or a recovered tee
- Preserve support kind, exact source cells, source/canonical frame, confidence, known/unknown facts, and recovery provenance as separate fields
- Retain the complete candidate graph, runner-ups, support evidence, and rejection reasons; do not collapse to winners or an `N=18` summary
- Known observations are evaluation references only: recovered centers H3/H5/H12 were about 3.04/7.83/4.34 px from hand points; S2 missed H6 while the separate S4 recovered basket was about 4.20 px from its label
- These center errors do not establish pad-corner geometry or pixel ownership; three S3 footer proposals remain false positives and should remain visible/unselected in the comparison

## S5 · axis-to-badge measurements

- Inputs: normalized post-S4 Tee centroid and measured major-axis geometry, plus S1 Badge centroid and identity, all in a typed source-pixel frame
- Outputs: both `+axis` and `-axis` measurements for every candidate pair, including perpendicular distance, axial distance, angle, target ID, selected-pair status, and explicit unknown/rejection reason
- Keep every row and support/provenance field; selection does not delete runner-ups
- The Dash truth packet reports 18 selected points within 10 px of independent same-hole tee labels (mean 4.05 px, max 7.83 px), but no pad-corner gold. H3/H16 axis misses are 22.99/12.46 px; H3 is badge-conditioned, so its apparent agreement is circular and cannot be counted as independent confidence

## S6 · target semantics

- Part and Calculation addresses remain reserved so the stage is inspectable and composable
- Input must carry an explicit typed semantic anchor plus evidence/provenance. Without that human-selected anchor, output remains `UNKNOWN` / `BLOCKED` and unscorable
- Do not hardcode top or tip, substitute ground/basket center, or promote a historical top/tip experiment as truth
- Preserve any historical target variants only as named historical comparators, with their original source, not as accepted baseline or candidate output

{DescriptiveLabel: Which physical semantic anchor should S6 target?}

Current safe contract assumption: no anchor is selected; no S6 target point is scored or asserted.

## Invocation and identity

- Geometry, fit/target choices, gates, and algorithm variants are Run Args and participate in each Calculation fingerprint
- View-only focus, zoom, and label density are View Args and must not invalidate geometry Parts
- A same-source comparison uses two named worlds and independently inspectable baseline/candidate inputs. The same source image bytes, source-frame declaration, and crop transform are bound in both worlds
- Receipts bind source SHA/content ID, Calculation and Tick IDs, exact input/output Part addresses, Run Args, View Args, variant/default state, and output hashes. Actual renderer/test receipt is distinct from declaration-only/binding testimony
- Rendered evidence includes a source-pixel overlay, CLI-readable summary, and machine receipt, preserving candidate/reject/unknown reasons per hole

## Evidence boundary

The scene contract does not imply algorithm correctness, pad-corner gold, ownership/segmentation, user acceptance, or S6 physical semantics. Existing saved evaluations are not reruns of this PxCube scene. No CV implementation or default change is authorized by this contract file.
