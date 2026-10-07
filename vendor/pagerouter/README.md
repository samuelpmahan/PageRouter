# PageRouter

Tiny GitHub Pages frontend comparison harness.

Configure a handful of static frontend URLs in `pagerouter.json`, deploy this repo with GitHub Pages, and switch between them in a single browser tab or compare two side by side.

## PoC usage

1. Edit `pagerouter.json` and replace the example entries with URLs for the frontend builds you want to compare.
2. In this repo, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
3. Push to `main` (or run the `Deploy PageRouter` workflow manually).
4. Open the Pages URL GitHub shows for this repo.

For Disc Studio, the fastest path is to point `pagerouter.json` at two already-deployed frontend builds. PageRouter itself does not need access to the source repos and does not receive their credentials.

```json
{
  "title": "Disc Studio FE Compare",
  "sites": [
    { "label": "Concept A", "url": "https://example.com/a/" },
    { "label": "Concept B", "url": "https://example.com/b/" }
  ]
}
```

## What this PoC does

- Single-view switcher
- A/B keyboard-friendly buttons
- Side-by-side comparison
- Swappable left/right targets
- No framework, build step, backend, database, or credentials

## Important iframe note

The compared site must allow being embedded in an iframe. GitHub Pages sites normally work fine. A site sending restrictive `X-Frame-Options` or CSP `frame-ancestors` headers will refuse to render inside PageRouter.

## Why URLs first instead of commit hashes?

This PoC deliberately separates **comparison** from **building**. That keeps PageRouter dumb and safe: it only displays already-built sites. A later v2 can add a GitHub Action that checks out arbitrary refs, builds them, and publishes them under `/builds/<sha>/`.
