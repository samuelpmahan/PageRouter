# thro-go frame lab: Builder notes (round 1)

Run: `node build.mjs` (writes data/), `node --test`, `python3 -m http.server 8731` then open index.html, `node verify-page.mjs 8731 round1` (Playwright).

## Frames (frames.mjs)
15 input frames (Creator, Channel, Manufacturer, Mold, Release, SponsorDeal, Disc, Shelf, Bag, Video, RetentionCurve, CardPlacement, Appearance, Link, Click) and 8 alternate frames selected by mismatches
(ProvisionalMold, PreReleaseAppearance, OtherBrandAppearance, ShownOnlyAppearance, CardlessAppearance, AwaitingViewsVideo, ClicksOnlyChannel, UnattributedClick): 23 frames, 89 terminals, 33 reference terminals linking them.
Each terminal: type, default, expect[] ({id, text, test, mismatch}). mismatch=null is a hard expectation (never violated by generated data); otherwise it names the alternate frame / transformation the enrichment selects.
15 soft expectations; the tests require every one to be exercised by some Case.

## How Cases are generated (generate.mjs, departures.mjs)
Baseline = every terminal at its default (scene.mjs). `DEPARTURES` is keyed by `Frame.terminal`; generate walks FRAMES x terminals x DEPARTURES, so each Case is a named departure from a terminal.
Then 10 seeded pairs of compatible departures (compatibility = disjoint `touches`/`reads`). Seeded: same seed, same bytes (data/toy-world.json); other seeds give different worlds and every Case still passes (tested on 4 seeds, swept 41 seeds by hand).
Each departure has an executable `expect(x)`: checks on the enriched links and on the display view model. Expected numbers come from oracle.mjs (plain per-second loops on raw instances) or from values the departure set, not from the code under test.
Meaning sentences come from meaning.mjs: facts derived from linked data, templates over facts; the Case's focus picks the sentence.

## Calculations (all through witness-pattern.mjs runWitnessedCalculation)
thro.go.generate, thro.go.enrich, thro.go.attention, thro.go.retentionDip, thro.go.releaseSupport, thro.go.clicks, thro.go.sponsorExposure, thro.go.verifyCase; each with guarantees (see Pipeline tab).
Numbers via registry (31 capabilities): new thro.attentionSeconds (-> thro.ratio -> statistics.sum) and thro.retentionDip (-> statistics.mean) in thro-capabilities/go.mjs; receipts (ids + hashes) shown in the page.

## Case count by kind (47)
baseline 1, release-timing 5, bags 3, shelf 1, catalog 2, sponsors 4, thrown/shown/talked 3, placement geometry 5, clicks 6, videos 4, retention 2, cross-creator 1, seeded combinations 10.

## Results
node --test: 58/58. Page: 47/47 PASS at 1440x900 and 390x844, no console errors, no sideways scroll; changing the seed in the page regenerates and re-verifies.
Mutation check: removing the clamp in enrich.mjs fails the pastVideoEnd Case and a guarantee.

## Expectations I could not make pass / known gaps
None failing. Gaps worth a Critic's eye:
- Deal boundary days (deal ends on publish day, inclusive) are not a Case: an off-by-one in activeDeals was NOT caught by my mutation test.
- Retention curves are synthetic (linear decay / flat / one dip shape); no Shorts-style looping or rewatch spikes.
- Appearances use whole seconds; clicks are not weighted by anything; "release window" is fixed at 30 days and pre-release horizon is unbounded.
- A click on a zero-length-card disc is "unattributed" (reason disc-not-in-video) though the raw placement exists; wording says "no usable appearance".
- Throw evidence is a given Appearance frame (creator-marked); there is no throw-log source frame beyond that.
- Fragments are independent (own manufacturers/molds per Case); only the cross-creator Case shares a mold across creators.
