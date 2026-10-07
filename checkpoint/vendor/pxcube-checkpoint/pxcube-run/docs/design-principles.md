# Product design principles

## OTOV2: One Task, One Viewport, Verifiable

A required task keeps its action, immediate feedback, completion control, and the evidence of its result in one viewport. The user should be able to tell what will be kept, changed, or completed without leaving that task or mentally reconstructing state from another screen. Scrolling breaks mental context and is not part of the default interaction.

Any exception must be written down beside the design and explain why the task cannot be decomposed. Optional advanced controls may open as a separate step, but they must not displace the primary completion action or hide the completion evidence. Verification cues should be direct and visually legible: for example, a crop boundary leaves the kept area clear while visibly shading the area that will be trimmed.

## #PROcision: assisted, exact, reversible finishing

A professional tool combines an automatic first pass with direct manipulation,
exact deterministic increments for finishing, same-viewport visual verification,
reversible transient changes, and an explicit commit. Its controls and tooling
stay out of the user's way: the tool helps first, the user can take over
directly, every finishing step has a predictable result, and nothing durable is
changed until the user commits it.

The first executable example is the crop correction strip:
`(-10, -5, -3, -1, +1, +3, +5, +10)` percentage points of selection diameter.
Each control applies exactly its named signed increment to the transient
ellipse, keeps the result visible in the same viewport, and leaves the prior
state reversible until explicit commit.
