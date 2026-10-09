# Public site source notes for the UI implementation

The actual downloaded HTML, CSS, images and font files are reference material under this folder and `work/PageRouter/checkpoint/vendor/hh/src/assets/reference/`. See [asset-provenance.json](asset-provenance.json) for exact URL, SHA-256, byte size, content type and license/origin caveat for every saved file. The live screenshots remain under `../reference/screenshots/` and are the rendered visual authority.

## Shared shell and styles

The official stylesheet is [`checkpoint/vendor/hh/src/assets/reference/static/style.css`](../../../../checkpoint/vendor/hh/src/assets/reference/static/style.css). It sets `body` to Inter, background `#1f2937`, text `#f9fafb`; the teacher-of-day photo has a 2px `#34d399` border, and metric numbers use Fraunces at 28px/weight 500. Stylesheet also defines modal overlay/content, teacher profile alignment and the hamburger item hover styles. Most page layout and responsive utilities are Tailwind classes in each HTML page.

The page HTML requests Google Fonts CSS for Inter 400/600/700, Fraunces 400/500, and DM Sans 400/500. The archived Google font CSS and Latin WOFF2 files are included under `checkpoint/vendor/hh/src/assets/reference/fonts/`. Browser-observed Inter/Fraunces WOFF2 URL responses are also saved separately. The site page source loads the Tailwind CDN and Font Awesome CDN (the latter appears on routes that use icons). These capture assets are local references; the manifest records font vendor terms and unknown redistribution rights.

The shared header in the public source is a left-to-right Tailwind green-700 → green-900 gradient, white text, with the logo at `h-16 md:h-20`. Desktop navigation is visible horizontally in this order: Home, Donate, Sign Up, About, Contact, Partners. The hamburger dropdown on mobile repeats those six in that order, followed by a divider and a Login control. The captured anonymous layout hides Logout, My Page, Forum and Validation. Footer source is a dark gray rounded-top panel with centered “© 2024 Homeroom Heroes. All rights reserved.”

## Terms text

The registration modal embeds `/pages/terms_conditions.html` in an iframe titled “Terms and Conditions”; the exact public page is saved at `source-pages/terms_conditions.html`. Its sections include Introduction; Charitable Mission & Board Discretion; Eligibility; Registration & Verification; Ownership of Donated Items; Compliance with Gift Regulations; User Content; User Conduct; Termination; Copyright Complaints (DMCA); Privacy Policy; AI Considerations; Governing Law & General Provisions; Limitation of Liability & Indemnification; Disclaimer; Third-Party Links; and Last Updated (September 26, 2026 PST). Refer to that HTML for complete wording; the screenshot `../../reference/screenshots/register-terms.png` shows the modal state.

## Forum discovery: static shape versus runtime

Unauthenticated browser navigation to `/pages/forum.html` returned 200 and rendered the public list at desktop and mobile. A public GET to `/forum/get_posts` returned 200 and rendered three cards: “Forum Styling Guide,” “The Teachers’ Lounge is Open,” and “Official Bug Forum.” The search field is `#post-search-input` (placeholder “Search posts by keyword…”); other controls are Clear, `#sort-date-newest` (Date (Newest), initially active), `#sort-date-oldest`, `#sort-upvotes`, `#create-post-btn` (+ New Post), and Load 10 More Discussions. No `<form>` exists on the list. Browser sort interactions reordered the cards newest→oldest and by upvotes; see `public-forum/FORUM-SORT-INTERACTIONS-20261009-002926204.json`. These sorts only changed the in-page list.

The anonymous `/api/profile/` GET returned 404 and the expanded menu showed Login. Direct browser navigation to `/pages/create_post.html` ended at `/pages/403.html` (rendered 403 “You do not have permission to access this page”), even though its saved static source contains a title field (max 255), body textarea and Submit New Post. Direct `/pages/post.html` without an `id` rendered an explicit missing-post-ID message. Static `source-pages/post.html` has comment, edit, vote and delete templates/controls, but authenticated behaviors were not tested. Exact public browser DOM/screenshots are in `public-forum/FORUM-PUBLIC-CAPTURE.json` and `public-forum/screenshots/`; original captures are under `../../reference/public-forum/` and `../../reference/screenshots/`.

The initial browser run let page scripts load and recorded passive third-party Google/DoubleClick analytics POSTs on navigation. No POST to the site, login, form, post, vote, comment, or delete action was made. The later sort-only run blocked non-GET and analytics traffic. Dynamic server-backed contents and role permissions remain unknown beyond the captured anonymous page.

## Local asset names

- `checkpoint/vendor/hh/src/assets/reference/static/images/logo_transparent.png`
- `.../static/images/homepage/hero_border.jpg` and `tile_border_1.jpg` through `tile_border_4.jpg`
- `.../static/images/partners/Coastal.png`, `Microsoft-logo.png`, `1007TheWolf.png`, `965CountryColor.png`, `BaseCamp.png`
- `.../static/images/about/Tory.jpg`, `grape.jpg`, `jillian.jpg`, `majid.jpg`, `peanut.jpg`, `william.jpg`
- `.../static/images/apple.jpg`, `.../static/images/regions/PNW.jpg`, favicon
- `.../fonts/site-fonts.css`, local Latin WOFF2 files, and browser-observed Inter/Fraunces WOFF2 files

The large originals are preserved byte-for-byte with individual hashes in the manifest. The worker may reference these files locally; this investigation does not grant permission for unrelated redistribution or imply that screenshots/assets are pixel-matched merely because filenames correspond.
