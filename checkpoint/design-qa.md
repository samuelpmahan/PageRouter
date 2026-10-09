# HH independent final design QA

Result: **PASS for captured public parity and declared local improvements. No actionable P0/P1/P2 findings remain.** Native delivery binding is a separate pending gate at this review's capture; this document does not assert main publication or production-service equivalence.

The final rendered artifact is the diagnostic HH digest `09ed79cfaa9c700340fba180ba0bcc8f0ae142afc5a26101496ad38d704d5ff4`, from `draft-refresh-2026-10-09T024847125Z.json`. Source and built bytes stayed unchanged during the final captures. The browser lease has ended. Root independently inspected final Home, Terms and forum-detail pairs and accepted their visible result.

## Reviewed evidence

The complete 13-route inventory at desktop 1440×1000 and mobile 390×844 is recorded in `public-20261009T022258570Z/capture.json`; its 26 same-viewport source/local pairs were reviewed. After the final shared-style and Home repairs, the affected Home, Register, Contact, Partners, captured Sarah profile, forum list and forum detail were recaptured at both viewports in `public-20261009T025104881Z/`. Final expanded Menu and Terms pairs are in `focus-20261009T025211690Z/`. Source is left and local is right. Images retain density/scale 1; shorter full-page images are padded, never resized to simulate parity.

| Surface | Final observation |
| --- | --- |
| Fonts | Local Inter is applied to public headings/forms and forum titles; Fraunces is confined to source accents. Actual hamburger is 30/36px, primary buttons weight 700, consent 14/20px, forum-detail title 36/40px. |
| Spacing and layout | Responsive public card/grid hierarchy, About team, partner stacks, profile, auth, registration and directory initial state were reviewed. Teacher inner padding is 24px, portrait 150×150, mobile details width 246px with no extra padding, Sarah name one 32px line. Terms outer dimensions, scroll body and 68/104px desktop/mobile banner match the measured source structure. |
| Tokens and colors | Navy canvas, green header/primary actions, white form/legal cards, yellow wishlist and blue share/Terms actions are correctly applied. Teacher portrait has the actual 2px green circular border. Reply text on white cards is readable; final contrast measurements and earlier failed screenshots are retained. |
| Genuine assets | Reference/source/built SHA-256 checks pass for genuine logo, fonts, hero/tile images, portraits, regional background, partner logos and Contact icons. Correct Home tile role association and actual displayed crop were checked separately from byte identity. |
| Copy and semantics | Public headings, legal copy, school/location values, form labels/placeholders, navigation and partner groups align with captured source. The initial directory result card is blank; guidance appears after an empty search. Metrics are explicitly captured copy, not live claims. Local fixture discussion content and unsent-service disclosures are deliberate differences. |

`effective-20261009T025016964Z.json` verifies the final computed styles, source-derived literal measurements, ordinary Terms pointer hit/click, wheel scrolling, Tab containment, Escape and opener-focus restoration. It passes and reports stable built hashes. The final four overlay images visibly confirm the white/green/navy Terms hierarchy and visible Close control.

## Actual behavior, separately verified

`flows-20261009T023509201Z/receipt.json` passes all 16 ordinary DOM interaction groups: editable registration and password confirmation, consent/Terms, pending-login denial, explicit local approval then typed login, sequential multiword profile create/edit/public view, wishlist/share handoffs, cascaded school reset/match/empty/remember, Contact counter and unsent validation, forgot form, About/Partners links, Home primary actions and readonly Sarah, forum create/reply/vote/search/sort/report/moderation/persistence, real Fail→Retry→Logout→Reset controls, original DevTools node persistence, keyboard/mobile/reduced-motion and embedded controls. No authentication state was injected. The final changes after this receipt are only the two CSS files; application/controller/renderer/module hashes are unchanged, recorded in `final-review-binding.json`. The affected Terms controls were repeated on the final CSS.

Independent API tests in `core-20261009T022003288861Z/receipt.json` challenge async races, dependent reset, failure/retry, unsafe URL inputs, no saved secrets, readonly captured-profile authority, hidden forum targets, malformed storage and bounded data. Asset proof is `asset-integrity-20261009T022005962104Z.json`. Browser evidence reports zero console **errors** and no external runtime calls. An existing embedded-frame console warning is retained rather than described as zero messages.

## Intentional differences and observation limits

- Collapsed advanced directory filters, submitted-empty guidance, local author/moderator controls, keyboard focus, provenance notes and one collapsed Preview tools disclosure are improvements. Original DevTools stays mounted through navigation; there is one visible copyright per route.
- Sarah is a readonly captured public reference snapshot, reached through the actual Home CTA and labeled with provenance. It is separate from editable local sample profiles and cannot authorize teacher-service writes.
- Public anonymous forum list/detail were observed. Production create-post returned 403; authenticated production create/edit/moderation permissions were unavailable. Local teacher/moderator roles and discussion bodies are explicit authored simulations, not claims about those permissions.
- Local registration, approval, login, reset, contact, wishlist, share and donation are isolated/unsent. No production account, email, message, payment, CAPTCHA or external service action is performed. Passwords are ephemeral and absent from inspected state, traces and storage.
- Small remaining spacing/underline/active-route differences, variable captured metrics, synthetic post length and local disclosures are accepted minor differences. This is captured visual parity with stated boundaries, **not exact pixel identity** or live data accuracy.

## Preserved review history

`design-qa-iteration1.md` through `design-qa-iteration4.md`, prior browser receipts and source/copy manifests remain unchanged. Genuine product failures and harness-assumption corrections are retained separately. Examples include import404, invisible mobile menu, typed-space loss, fragment scroll, pale reply text, readonly-profile edits, missing Logout, duplicate diagnostics and Terms pointer interception. Obsolete assertions about reset navigating to Register, nested summaries, guessed About classes and parent-vs-child font weight were corrected without weakening ordinary-click or state checks.

Final native build, existing whole-project regressions, artifact/import binding and main publication remain publisher/root responsibilities. After native starts, this checkpoint document and independent test inputs remain frozen; subsequent verification evidence is written outside `checkpoint/`.

---

## Earlier checkpoint review (preserved)

# HH independent design QA

Historical result before the final repaired candidate: blocked on the measured residual visual batch.

The latest4196 interaction gate passes through ordinary controls. Current combined-image review still finds actionable P2 visual differences; see `outputs/homeroom-parity/implementation/verification/design-qa-iteration3.md`. Earlier P0/P1 failures below are preserved history, not the current implementation. No parity verdict is inferred from source files or unit test totals.

Reference truth: `outputs/homeroom-parity/reference/screenshots/`, supported by `outputs/homeroom-parity/implementation/reference/asset-provenance.json` and public page snapshots. Reference desktop viewport1440×1000, mobile390×844, density1. Full-page image height varies by content; comparisons retain scale1 and explicitly pad shorter captures. Source is left and local implementation is right in combined images.

## Preserved baseline comparison

Opened `outputs/homeroom-parity/implementation/verification/baseline-register-desktop-pair.png`, combining the captured public registration with the **prior** local registration. Metadata: `baseline-register-desktop-pair.json`; source1440×1568, implementation1440×1089; same-coordinate top1000 crop, combined2888×1000. This baseline does not represent the actively changing public-site implementation.

The baseline visibly fails the five required surfaces:

- Fonts: the reference uses a sans heading and larger form labels; the earlier local form uses a large serif heading, smaller labels and extra uppercase headings.
- Layout: the reference centers one narrow, tall white form card. The old local layout adds a journey sidebar and diagnostics above the public header, changes fields to columns and removes password fields.
- Colors: the reference navy canvas becomes a pale canvas in the earlier local view; the demo banner adds a full-width yellow strip.
- Assets: the genuine reference logo is visible, but its local scale and header placement differ. The upcoming gate will check local asset hashes and browser-loaded fonts rather than infer byte identity from filenames.
- Copy: the old local “Create your account” and “Submit demo registration” replace “User Registration” and “Submit”; locked synthetic identity replaces the editable blank initial form.

These are P1 baseline mismatches in UI-02/UI-07/UI-12. Builders own the public-site repair. The post-fix comparison will use current assembled bytes at the same viewport and initial state; a small local simulation indicator is permitted, and a large diagnostic panel changing public geometry is not.

## Required post-fix evidence

Capture each public route at desktop/mobile; compare full views and focused header/form/Terms/menu regions in combined images. Inspect fonts, spacing, colors, assets and copy individually. Record actual navigation, keyboard focus/close, cascades, forms and local handoffs independently of screenshots. Keep unavailable authenticated production outcomes distinct from authored local forum behavior. Preserve each failed iteration and exact source hashes.

## Iteration 1: current assembled diagnostic

Captured all ten public routes at both viewports in `outputs/homeroom-parity/implementation/verification/public-20261009T004539133Z/`. All20 rendered with zero console errors, external runtime requests, broken images or horizontal overflow. Capture spans00:45:39.840Z–00:46:04.373Z; publisher refreshed at00:45:53. The receipt therefore explicitly fails source/build stability. This iteration is diagnostic, and final proof must use frozen native bytes. `capture-build-change-diagnostic.json` records the qualification and captured pre/current built hash difference; no unexplained writer is asserted.

Opened combined images `pairs/home-desktop-pair.png`, `home-mobile-pair.png`, `register-desktop-pair.png`, `directory-desktop-pair.png`, `contact-desktop-pair.png` and `forum-desktop-pair.png`. Every pair retains viewport width/density1, scale1, and pads below the shorter full-page capture. Home desktop source1440×1900 / local1440×2073; Home mobile source390×3082 / local390×2633. Individual metadata records all other exact raster sizes. Focused header/form/Terms comparisons remain part of the post-fix loop; these full views already expose major region, type and contrast failures.

- [P0] Mobile Menu is invisible. Actual click cannot reach `#hh-public-nav-toggle` at390px, also inside the embedded354px frame. Screenshot `flows-20261009T004706936Z/mobile-menu-navigation-and-width-failed.png` and its receipt preserve the actual failed action. Fix the responsive display rule, then navigate through the menu using an ordinary click.
- [P1] A diagnostics toolbar appears above the public header. This adds approximately77px to every desktop route. Move diagnostics outside the comparison surface and preserve access elsewhere. Header logo is undersized; navigation is right aligned and smaller than source, rather than sitting beside the genuine logo.
- [P1] Home composition diverges. Hero heading wraps into two desktop lines instead of one, and four mobile lines instead of two. Desktop impact cards are stacked instead of a three-column row. Scope type/layout rules to match source; restore exact card/grid proportions before judging smaller spacing.
- [P1] Fonts and foreground tokens diverge. Home tile and forum titles become serif; captured source uses bold sans here. Several dark-gray paragraphs on navy/image backgrounds are difficult to read. Keep Fraunces limited to the actual source metric/section accents; use loaded Inter for reference sans text and restore light foreground colors.
- [P1] Registration title/instructions sit outside the white card and are nearly unreadable. Source places both inside it. Labels are smaller/bolder; Terms button is small/neutral instead of full-width blue; consent checkbox is stretched. Restore card hierarchy and contextual input/checkbox rules. An extra Grade/CAPTCHA state must not distort the captured initial form geometry without explicit classification as an improvement.
- [P1] Contact adds an outside heading and a full-panel-width form. Source has centered green headings and a centered approximately512px form within the wider white panel; Submit fills that form width. Restore its nested layout, label sizing and button width.
- [P1] Directory default shows two fixture cards, while captured source Search Results is blank. Keep the initial state matching source; put query/remember improvements into an explicit advanced state or classify that authored difference before acceptance. The useful submitted match/empty/error states remain required.
- [P2] Footer navigation and split copyright change public page composition; source shows centered copyright only. Community is closer, but serif titles and extra paragraph gaps enlarge its cards. Preserve the small Local preview controls disclosure; it is an allowed local simulation affordance.

Asset/source/assembled hashes passed in `asset-integrity-20261009T004706764450Z.json`; this proves local bytes, not the visible crop/font application. The featured local fixture photo/copy differs from the observed teacher; representative data variation is explicitly allowed, so its acceptability remains a stated content assumption rather than hidden pixel parity. Other tiles still need source crop/image treatment and contrast correction.

Actual DOM receipt `flows-20261009T004706936Z/receipt.json` proves Terms focus trap/Escape/close/input preservation, editable register/confirmation/pending, directory reset/empty/remember, Contact230 counter/local unsent validation, reset shell, AboutTerms/portraits/partner contact, and password absence from inspected state/runtime/storage. It also preserves failures. Approval wording and collapsed preview-role control were harness assumptions and are being corrected through actual read-only state and actual disclosure clicks; no forced clicks or authentication injection will be used. The mobile Menu failure is a product failure. Profile/public/share and local forum writes must still be observed after those prerequisites.

Owners have exact pair paths and failures. Passing requires no remaining actionable P0/P1/P2 visual findings and a current stable-source browser receipt. Current blocker: responsive Menu and reference layout/type/contrast repairs are pending.
