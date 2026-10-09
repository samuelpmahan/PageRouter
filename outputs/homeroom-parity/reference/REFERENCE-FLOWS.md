# Homeroom Heroes reference flows

Captured 2026-10-08 using read-only Chromium at 1440×1000 desktop and 390×844 mobile. The authoritative public reference is [helpteachers.net](https://www.helpteachers.net), identified from `work/PageRouter/checkpoint/vendor/justin/index.html:116` and the Homeroom Heroes company listing. The public root redirects to `/pages/homepage.html`.

## What was observed

The parity target is the full discoverable public frontend, excluding backend and live-service outcomes. The current C6 local implementation is intentionally narrower and provides a synthetic teacher journey. The live authenticated Forum, Validation, My Page, and Logout screens remain unobserved because they require an account; they are recorded as unknown rather than inferred.

The live site has a green gradient header and logo, dark navy content background, chalkboard homepage hero, impact cards, teacher-of-the-day feature, and photo-backed action cards. A captured render showed “150+ verified teachers,” “$9.3k total donations,” “135+ schools,” and Sarah Endsley as Teacher of the Day. Other reloads showed different counts. These are screenshot-visible values only; accuracy and data source are unverified.

The shared public links lead to Home, Donate (the teacher directory at `/pages/index.html`), Sign Up, About, Contact, and Partners. At desktop, the hamburger menu exposes Login. At mobile, the expanded menu exposes all six public routes plus Login. Anonymous DOM also contains hidden Logout, My Page, Forum, and Validation controls; their authenticated screens/routes were not opened. No Privacy link was found in the inspected public surfaces, so its global existence is unknown.

The directory page shows State → County → School District → School selectors, a Find Teachers action, and a Search Results region. The captured default results region was blank. Earlier text retrieval reported “No teachers found,” but that text did not appear in the accepted browser screenshot; use the screenshot as the state evidence.

Registration includes name, email, phone, password and confirmation, four school selectors, a Terms and Conditions button, consent checkbox, Submit, and Login. The state selector showed 59 entries including its prompt and US states/territories; the other selectors initially showed only their prompt. Terms opens a scrollable modal with Introduction and Charitable Mission content. No live field was submitted.

Contact includes name, email, subject and message, a 250-character counter, Submit, and a reCAPTCHA area. Typing a local-only 20-character draft changed the counter from 250 to 230. The form was not submitted. About contains mission/how-it-works copy, six team portraits/biographies and a terms section. Partners shows Coastal, Microsoft, 100.7 The Wolf, 96.5 Country, and Base Camp logos/sections.

The public login shell has email/password fields, Submit, Forgot Password, and Register. Forgot Password opens `/pages/forgot.html`; its shell was captured, without submitting reset data. Clicking the homepage’s View Teacher of the Day opened the public Sarah Endsley profile, with school/location, biography, View Wishlist outbound Amazon link, and Share Page control. Neither wishlist nor share was activated. Directory teacher-detail routes beyond this featured public profile were not tested.

## Numbered screenshot/state guide

All paths are relative to this report’s folder, `outputs/homeroom-parity/reference/`.

1. `screenshots/home-desktop.png` — live homepage, desktop, populated rendered state.
2. `screenshots/home-mobile.png` — same homepage at mobile width; cards stack vertically.
3. `screenshots/home-desktop-nav.png` — desktop hamburger expanded; Login visible.
4. `screenshots/home-mobile-menu-expanded.png` — mobile hamburger expanded; public routes and Login visible.
5. `screenshots/directory-desktop.png` and `directory-mobile.png` — live teacher search form and blank default results region.
6. `screenshots/register-desktop.png` and `register-mobile.png` — live registration form, untouched.
7. `screenshots/register-terms.png` — live Terms and Conditions modal opened; no consent change.
8. `screenshots/about-desktop.png` and `about-mobile.png` — live About/mission/team surfaces.
9. `screenshots/contact-desktop.png` and `contact-mobile.png` — live contact form, untouched.
10. `screenshots/contact-counter.png` — live contact message field with the local-only draft and counter at 230.
11. `screenshots/partners-desktop.png` and `partners-mobile.png` — live partners page and logos.
12. `screenshots/live-login-shell.png` — public login shell; no authentication attempt.
13. `screenshots/live-forgot-password.png` — public password-reset shell reached from Forgot Password; no submission.
14. `screenshots/teacher-of-day-public-route.png` and `teacher-of-day-public-route-mobile.png` — public Sarah Endsley profile opened from homepage CTA.
15. `screenshots/local-register-desktop.png` and `local-register-mobile.png` — valid assembled local leaf at `http://127.0.0.1:4188/compiled/hh/index.html#/register`.
16. `screenshots/local-login-desktop.png` and `local-login-mobile.png`; `local-teachers-desktop.png` and `local-teachers-mobile.png` — local assembled passwordless demo login and seeded directory.
17. `screenshots/local-flow-01-register.png` through `local-flow-11-reset.png` — local synthetic teacher journey: registration, synthetic geography, pending request, simulated approval, demo-login form, profile creation, own profile, directory, public profile, and reset. The demo-login click was NOT exercised: after capturing the passwordless demo-login form, the browser injected an authenticated synthetic fixture state to inspect the post-login/profile UI. Those later states are valid fixture-state observations, but the login interaction itself is unverified. All state is browser-session fixture data; no external request was made.
18. `screenshots/integrated-hh-run-desktop.png` and `integrated-hh-run-mobile.png` — PageRouter `http://127.0.0.1:4188/#/hh/run` shell framing the compiled local leaf. HTTP 200; frame source `/compiled/hh/index.html`; frame size 1124×720 desktop and 354×680 mobile. PageRouter chrome remains visible around a smaller HH viewport.
19. `screenshots/home-brand-assets.png` — captured branding/assets reference if used by the visual evidence set.

Machine-readable details and exact URLs/actions are in `ROUTE-STATE-INVENTORY.json`, `BROWSER-EVIDENCE.json`, `INTERACTION-EVIDENCE.json`, `PUBLIC-JOURNEY-EVIDENCE.json`, `DISCOVERABILITY-EVIDENCE.json`, `LOCAL-BROWSER-EVIDENCE.json`, `LOCAL-FIXTURE-FLOW.json`, and `INTEGRATED-ROUTE-EVIDENCE.json`.

## Local comparison and evidence boundaries

The assembled preview is served from the checkpoint `dist` tree, not the source directory. An initial source-only attempt at `/src` failed because its service-module import was unavailable at that document root; that startup failure is preserved in `BROWSER-EVIDENCE-source-preview-404.json` and is not a product parity difference. The corrected local URLs are the assembled leaf above and integrated PageRouter `/#/hh/run`.

Local registration is explicitly synthetic: demo identity values, demo geography, a demo-only warning, preview controls, a five-step journey rail, and browser-session state. The local form flow reached pending and simulated-approval states, created a local profile, displayed seeded directory profiles, and reset the session. Browser network evidence records zero external requests for this flow. This proves the local frontend can demonstrate its fixture journey; it does not prove any production account, email, database, payment, donation, CAPTCHA, or moderation behavior.

The live site requested `static/style.css`, Tailwind CDN, Google Fonts CSS, Inter and Fraunces font files, logo and homepage/partner images. Observed assets and dimensions are listed in the JSON inventory. Some homepage images are inline data images; their payload is intentionally not copied into the report. Third-party analytics/ad requests and some API requests/errors appear in captured network records; their backend meaning is not inferred here.

No live registration, login, contact, donation, password-reset, wishlist, or share action was submitted/activated. Backend outcomes, email delivery, donor/payment handoffs after activation, authenticated Forum/Validation/My Page/Logout screens, other dynamic teacher profiles, and any undiscovered privacy route remain unknown or out of scope. Loading/error messages from text-only retrieval are not treated as authoritative when the browser capture disagrees.

## Public Forum routes captured after the initial inventory

The anonymous Forum list is publicly readable even though its menu control is hidden in the anonymous shared header. Browser navigation to `/pages/forum.html` loaded three discussion cards through a read-only `/forum/get_posts` GET. At capture time the cards were “Forum Styling Guide,” “The Teachers’ Lounge is Open,” and “Official Bug Forum.” The search field is `#post-search-input`; controls include Clear, Date (Newest) (initially active), Date (Oldest), Upvotes, + New Post, and Load 10 More Discussions. Sort interactions reordered the cards locally. Evidence and DOM are in `public-forum/FORUM-PUBLIC-CAPTURE.json` and `public-forum/FORUM-SORT-INTERACTIONS-20261009-002926204.json`; screenshots are `screenshots/forum-forum-list-{desktop,mobile}.png`, `forum-menu-open-{desktop,mobile}.png`, and the timestamped sort images.

Clicking the first public post link opened `post.html?id=11`; anonymous GETs for post and comments returned 200. The detail page visibly contains vote controls and a required comment textarea, but neither was activated. `create_post.html` ends at a rendered 403 for an anonymous visitor. Its public source still supplies the form shape, but authenticated behavior is unknown. Opening `post.html` without an id separately produces a missing-id message. Details and responsive screenshots are recorded in `public-forum/FORUM-POST-DETAIL-20261009-003159459.json`. These observations establish public display states only; no post/comment/vote/edit/delete action or production write was made.
