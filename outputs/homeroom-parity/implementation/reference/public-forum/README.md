# Public Forum browser evidence

This folder mirrors new public, anonymous Forum route screenshots and browser evidence. Original captures are under `outputs/homeroom-parity/reference/public-forum/` and `outputs/homeroom-parity/reference/screenshots/`.

Forum list returned HTTP 200 and rendered three public discussion cards after anonymous GET `/forum/get_posts` returned 200. The anonymous GET `/api/profile/` returned 404. Public menu shows Login when expanded. Sorting changes card order in-page only; the sort-state JSON records exact order and active button classes.

Direct `/pages/create_post.html` navigation ended at `/pages/403.html` with a rendered 403 message. Its public static source still contains a title (maxlength 255), body textarea, and Submit New Post button. Direct `/pages/post.html` without `?id=` renders an explicit missing-post-ID message. These public source templates do not prove authenticated behavior or permission rules.

The initial public navigation ran the site’s Google/DoubleClick scripts and recorded passive third-party telemetry POST requests. No Forum/API mutation request or user-triggered write was sent. The later sort-only capture blocked non-GET and ad/analytics traffic. No sign-in, form submit, vote, comment, delete or post action was performed.


Clicking the first list card opened the normal detail route `/pages/post.html?id=11` as an anonymous visitor; public GETs for post/comments returned 200. Rendered detail shows the post title/body, vote-count controls, comment textarea, Post Comment button, 0 Comments and an ad placeholder. Form details: `#comment-form`; textarea `#comment-content`, name `content`, required; button Post Comment. Vote controls `#upvote-btn`/`#downvote-btn` were not activated. See `FORUM-POST-DETAIL-20261009-003159459.json` and the matching desktop/mobile screenshots. Forum icons are inline SVG/emoji; no Font Awesome font/CSS is needed for these routes.
