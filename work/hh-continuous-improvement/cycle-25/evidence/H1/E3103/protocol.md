# E3103/H1 focused protocol

## Observed gap

H2/E3102's actual volatile-fixture probe confirms that reported topics appear in the moderator index, but a reported reply only appears after opening its parent topic. There is no index-level way to narrow the list to reports.

## Bounded behavior

Add a `Reported items` toggle to the existing forum index, visible and effective only for the moderator role. In that mode, retain a topic iff `topic.reported` or any reply has `reported === true`; moderator-visible hidden replies/topics count. Apply the filter before existing sort/pagination. Existing query/category filters remain conjunctive; ordinary index rendering remains unchanged. Exiting moderator role clears the toggle, and the controller rejects filter events from all non-moderator roles. Renderer authorization is independently role-gated so crafted state cannot expose a reported-only projection to teachers/visitors.

No new route, service, backend, storage format, moderation decision, or authorization rule.

## Focused regressions, written before implementation

1. Community renderer: with one newest unreported item and three older reported items (topic-level, hidden reply, hidden topic), moderator mode returns only the reported IDs before a two-item page slice and retains a load-more affordance. A teacher rendering the same crafted `reportedOnly` state sees the normal list and no toggle.
2. Public controller: a teacher reports a reply, the moderator enables the filter and sees the parent, hides the reply without losing it from results, then restores it and sees the parent leave when no remaining report exists. Leaving moderator mode clears state; a non-moderator filter event is rejected.

## Validation boundary

Capture one focused red for these named tests, then implement the smallest change in `community.mjs` and `public-controller.mjs`. Stop after implementation before green/build/Git operations; root owns the next validation checkpoint.
