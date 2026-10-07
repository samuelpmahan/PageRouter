# Critical journeys

An Experience may declare `experience.criticalJourney` in its typed tidy
manifest. neat records the human outcome as a `critical-journey` requirement;
tidy registers its scenario, viewport, and `OTOV2/#PROcision` interaction
contract; crisp executes the contract against the final artifact and retains
the evidence. That declaration is release policy, not a screenshot checklist:
`local/test/critical-journeys-browser.mjs` opens a fresh assembled artifact at
desktop (1440×1000) and mobile (390×844), clicks every declared step, confirms
the control is native/ARIA and not covered by an overlay, then records the
effective iframe viewport.

The current CreateGraphics declaration protects the mobile Choose → Verify →
Finish → Choose loop. Add a declaration whenever an Experience has a primary
human path; Pages runs this gate after the same local package program that
produces the deployment artifact. A control that only looks interactive fails
the gate because the test clicks it and requires its declared state change.
