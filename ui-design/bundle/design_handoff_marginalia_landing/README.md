# Handoff: Marginalia Landing Page (direction "1b — Highlighter")

## Overview
Single-page marketing site for the Marginalia Chrome extension (Docs-style margin comment threads for ChatGPT / Claude / Gemini). Goal: drive installs from the Chrome Web Store listing. Sections: sticky nav → hero with mocked margin-thread demo → install steps → how to use (screenshots) → configure (screenshots) → privacy/CTA footer.

## About the design files
These files are **design references created in HTML**. Two ways to use them:

1. **Deploy as-is (fastest)** — `index.html` is a self-contained static page. Drop it into the repo (e.g. `docs/index.html` for GitHub Pages, or a `site/` folder for Netlify/Vercel) and it works with no build step. Before shipping, change the six screenshot `<img src>` values from the absolute GitHub URLs to repo-relative paths (see Assets below).
2. **Recreate in a framework** — if you'd rather have a maintained site (Astro, Next, plain HTML+CSS files), use this README + `source/` as the spec and rebuild with proper stylesheets instead of inline styles.

`source/Marginalia Full 1b.dc.html` + `source/support.js` are the design-tool source; they render the same page but depend on each other — prefer `index.html` for deployment.

## Fidelity
**High-fidelity.** Colors, type, spacing, copy and layout are final. Recreate pixel-perfectly if reimplementing.

## Page structure (top to bottom)
1. **Sticky nav** — white 94% opacity + blur, 2px black bottom border. Left: logo (32px violet rounded square, radius `10px 10px 10px 2px`, yellow bar inside) + lowercase wordmark "marginalia" (20px/700). Right: links Install · How to use · Configure · GitHub ↗ (14px/600, `#4c4661`, hover violet) + pill CTA "＋ Add to Chrome" (violet bg, white text, `border-radius:999px`, `box-shadow:3px 3px 0 #17141f`). Nav links anchor to section ids `#install`, `#use`, `#configure`; `scroll-behavior:smooth`, sections have `scroll-margin-top:80px`.
2. **Hero** — max-width 1080px, 2-col grid (1.05fr/1fr, 40px gap). H1 54px/700, letter-spacing -0.03em, key phrase highlighted with yellow `<mark>`-style span (`#ffd803`, 6px radius, box-decoration-break clone). Sub 17px `#4c4661`. Primary CTA: black bg, white text, 14px radius, `box-shadow:4px 4px 0 #6c3df4`. Beside it: "Free forever / Open source 🔓". Platform chips: ChatGPT / Claude / Gemini, 2px black border pills. Right column: mocked chat answer card (`#f4f2fb`, 2px black border, 16px radius) with highlighted phrase, overlapped by margin-thread card (white, 2px black border, `box-shadow:5px 5px 0 #ffd803`, offset `margin:-18px 0 0 60px`).
3. **Install** (`#install`) — full-bleed violet `#6c3df4` band, white text. H2 32px "Install in ten seconds ⚡". 3 cards (rgba white .08 bg, 2px rgba-white .25 border, 14px radius) each with 32×32 yellow number chip (10px radius), bold title, `#d9d0fb` body. Steps: open Web Store listing → click "Add to Chrome"/"Add extension" → open chatgpt.com / claude.ai / gemini.google.com and highlight text.
4. **How to use** (`#use`) — white, max-width 1080px. 2-col grid of figures, third image spans both columns. Images: 2px black border, 14px radius, `box-shadow:5px 5px 0 #e2ddf2`. Captions 13.5px with bold black lead-in. Content: ask about a selection / reply streams in place / a second question minimizes other threads.
5. **Configure** (`#configure`) — `#f4f2fb` band, 2px black top border. Left: settings-page screenshot (API keys; without keys it uses the signed-in chat app — Claude and Gemini). Right column: two stacked screenshots — "Manage Conversation" menu at bottom-right of every conversation → Settings. Screenshot shadows here are yellow (`5px 5px 0 #ffd803`).
6. **Footer CTA** — `#17141f`, centered. Headline 30px "Your next \"wait, what?\" deserves a margin." Privacy line (`#a89fc4`) with yellow GitHub link. Yellow CTA button (2px white border, `box-shadow:4px 4px 0 #6c3df4`). Footer links: © 2026 Marginalia · GitHub · Chrome Web Store.

## Design tokens
- Colors: ink `#17141f`; violet `#6c3df4`; yellow `#ffd803`; body text `#4c4661`; lavender surfaces `#f4f2fb` / `#e2ddf2`; muted-on-violet `#d9d0fb`; muted-on-dark `#a89fc4` / `#8d86a8`.
- Font: **Space Grotesk** (Google Fonts, 400–700). H1 54px, H2 32px (32px/-0.02em), body 17px/15px, captions 13.5px, nav 14px/600.
- Signature style: 2px solid `#17141f` borders + hard offset shadows (`3–5px` x/y, 0 blur) in violet/yellow/black; radii 14–16px, pills 999px.
- Links: default `a { color:#6c3df4 }`, hover `#17141f` (inverted on dark/violet bands: yellow).

## Interactions & behavior
- Nav anchors smooth-scroll to sections; no JS required anywhere (pure static page).
- Hover: nav links shift to violet. No other animation.
- Responsive: designed desktop-first at 1080px content width. For production add breakpoints: hero grid → single column below ~880px; 3-card and 2-col grids → 1 column; nav links collapse into a burger menu below ~720px (this is the one JS behavior to add).

## Links (all CTAs)
- Web Store: `https://chromewebstore.google.com/detail/marginalia/lkondngonkokanegbiaphkjehphhjdha`
- GitHub: `https://github.com/midhunkrishna/marginalia`

## Assets
Six screenshots currently hotlink `https://github.com/midhunkrishna/marginalia/raw/master/images/`: `selection.png`, `response.png`, `another.png`, `settings.png`, `manage_conversations.png`, `go_to_settings.png`. In the repo, point them at the local `images/` folder instead (e.g. `src="../images/selection.png"`). Logo is pure CSS (no image asset).

## Files
- `index.html` — deployable self-contained page (screenshots load from GitHub until you relink them)
- `source/Marginalia Full 1b.dc.html` — original design source
- `source/support.js` — design-tool runtime required by the source file
