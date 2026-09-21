# Octagon website

Static, dependency-free landing page for Octagon: pure HTML, CSS and a little vanilla JavaScript. No build step, no frameworks, no external CDNs. DM Sans is self-hosted in `assets/fonts/` (SIL OFL, see `assets/fonts/OFL.txt`), so no font CDN is used.

The site follows the repository brand (`BRAND.md` at the repo root): Ivory page background, Obsidian type, Forest buttons, Bronze as the single accent.

## Deploy

The `website/` directory is served as-is by GitHub Pages at:

https://yanniskiefer.github.io/octagon/

All asset and link paths are relative, so the site works under the `/octagon/` subpath and from `file://` for local review.

## Preview locally

```sh
cd website
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Structure

```
website/
  index.html              single page, anchored sections
  og-source.html          1200x630 social card source; render to assets/og.png
  assets/
    css/style.css         all styling, light Ivory theme, responsive
    js/main.js            copy buttons + screenshot fallback (vanilla JS)
    favicon.svg           Forest rounded square with the reversed mark
    fonts/                DM Sans 400/500/700 (woff2) + OFL.txt license
    og.png                1200x630 social card (rendered from og-source.html)
    screenshots/
      dashboard-main.png  hero + demo screenshot, 1440x900
      dashboard-chat.png  demo detail below the main shot, 1440x900
  sitemap.xml
  robots.txt
```

## Screenshots

`assets/screenshots/dashboard-main.png` and `assets/screenshots/dashboard-chat.png` are placeholders. Drop real captures at exactly these paths and they appear immediately; if a file is missing, the page shows a labeled frame instead of a broken image. Screenshots must show the real dashboard running synthetic demo data (`node scripts/seed-demo.js`), and captions must keep saying so. The demo section shows one large main screenshot with the single-conversation view below it.

## Truth checklist for edits

Everything on the page must match what Octagon actually does today: local-first, Voice Control cues from a Mac hub, swipe pacing sessions, one SQLite file (`infra/db/farm.db`), five MCP tools (`list_phones`, `get_phone`, `run_session`, `get_events`, `get_phone_screen`), dry-run mode with zero phones. Posting is on the roadmap, not implemented. No auto engagement, no proxies, no cloud. Keep the risk note. No hype, no fake metrics.
