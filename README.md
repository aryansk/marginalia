# Gemini Assist

A browser extension (**Firefox + Chrome**) that adds **Google-Docs-style margin
comment threads** to the major AI chat sites — [Gemini](https://gemini.google.com),
[ChatGPT](https://chatgpt.com), and [Claude](https://claude.ai).

When the AI gives a long answer and you want to drill into one phrase, you no
longer have to ask in the main chat (and bury the original answer). Instead:

1. **Highlight** the phrase (e.g. _"8 KB page"_).
2. **Right-click → "Ask about …"**, or press **Ctrl + Shift + H**.
3. A comment box opens **in the right margin, level with your highlight**.
4. Ask your follow-up. The reply streams **into the box** — your main chat is untouched.
5. Keep the conversation going; the box re-sends the full thread each turn.

The follow-up is answered by **the same AI you're on** (ask Claude on claude.ai,
GPT on chatgpt.com, Gemini on gemini.google.com).

Threads are multi-turn, height-capped, **persist per conversation (and per site)**,
and re-anchor to their highlight on reload. Each box has three states:
**minimize** to collapse it to just its header, normal docked, or **maximize** to
a full-screen modal.

## How it talks to each AI

It reuses your **already-logged-in session on each site** — no API keys. Your
session cookies attach automatically; the extension reads the page's auth token
and replays that site's own internal streaming endpoint from the background
script. Which backend answers is chosen by the current host (see
[`src/core/sites.js`](src/core/sites.js)); the per-site clients live in
`src/gemini/`, `src/chatgpt/`, and `src/claude/`.

> ⚠️ **Those endpoints are undocumented and reverse-engineered.** Each vendor can
> change its request/response shape without notice, which would break replies
> until updated. All the fragile bits per site are isolated in two small,
> unit-tested modules — `payload.js` (request) and `parser.js` (response) — plus a
> thin `client.js` (transport/auth). If replies stop on a site: open DevTools →
> Network there, send a normal message, inspect the streaming request + response,
> and adjust that provider's `payload.js` / `parser.js` to match. Built for
> personal use.

## Build & install

### 0. Prerequisites (once)

```bash
npm install        # installs web-ext locally; Node 24 comes from mise
```

One source tree builds both browsers. The only differences are the manifest
(`manifest.json` for Firefox, `manifest.chrome.json` for Chrome) and the
background entry (Firefox `background.scripts`, Chrome `src/sw.js` service
worker); a tiny [`src/shared/browser-polyfill.js`](src/shared/browser-polyfill.js)
aliases `browser` → `chrome`. [`build.js`](build.js) assembles `dist/firefox` and
`dist/chrome` from `src/` + `icons/`.

### A. Run it for development (temporary, auto-reload)

Easiest while hacking; the add-on disappears when the browser closes.

```bash
npm start          # Firefox  (= web-ext run, loads this folder)
npm run start:chrome  # Chrome/Chromium (assembles dist/chrome, then web-ext run)
```

Or load it by hand:

- **Firefox** — `about:debugging#/runtime/this-firefox` → **Load Temporary
  Add-on…** → pick this folder's `manifest.json`.
- **Chrome** — run `npm run build:chrome`, then `chrome://extensions` → enable
  **Developer mode** → **Load unpacked** → pick `dist/chrome`.

Then open a logged-in Gemini / ChatGPT / Claude tab and try it.
`npm run lint` validates the (Firefox) manifest/code before you ship.

### B. Build distributable packages

```bash
npm run build          # both -> web-ext-artifacts/{firefox,chrome}/gemini_assist-<version>.zip
npm run build:firefox  # just Firefox
npm run build:chrome   # just Chrome
```

The Firefox `.zip` can be renamed to `.xpi` to install as a file; the Chrome
`.zip` (or the `dist/chrome` folder) loads via **Load unpacked**.

### C. Install the package permanently

> ⚠️ **Firefox Release and Beta only install extensions signed by Mozilla.** An
> unsigned local build can't be permanently installed there — use option 1 or 2.

**Option 1 — Developer Edition / Nightly / ESR (no signing).** These builds let
you turn off the signature requirement:

1. Open `about:config` and set `xpinstall.signatures.required` to **false**.
2. Rename the built file from `.zip` to `.xpi`.
3. Open `about:addons` → gear icon ⚙ → **Install Add-on From File…** → pick the `.xpi`.

(This pref is ignored on Release/Beta — it only works on Dev Edition, Nightly, and ESR.)

**Option 2 — Sign it via Mozilla (works on any Firefox, including Release).**
Get an API key + secret from [addons.mozilla.org](https://addons.mozilla.org/developers/addon/api/key/),
then self-distribute (unlisted) — this returns a signed `.xpi`:

```bash
npx web-ext sign --channel=unlisted \
  --api-key=YOUR_JWT_ISSUER --api-secret=YOUR_JWT_SECRET
```

Install the resulting signed `.xpi` via `about:addons` → ⚙ → **Install Add-on From File…**.

**Option 3 — Just use temporary mode (section A).** Simplest for personal use;
re-load it after each Firefox restart.

## Settings

Toolbar icon (or `about:addons` → Gemini Assist → Preferences):

- **Keyboard shortcut** — rebind the trigger (default Ctrl+Shift+H).
- **Context scope** — highlight only / highlight + section (default) / whole conversation.
- **Delete all saved threads.**
- **Debug logging.**

## Architecture

The code is organized as a **functional core, imperative shell**. The pure
"core" modules hold the tricky logic with no DOM/network/`browser.*` dependency,
so they're exhaustively unit-tested; the DOM/IO "shell" modules are thin adapters
that delegate to the core. A tiny UMD footer on each core module lets Node/Vitest
import it while the browser still loads it as a `GA`-global content script.

```
manifest.json              MV3, Firefox (background.scripts)
manifest.chrome.json       MV3, Chrome  (background.service_worker)
build.js                   assemble dist/{firefox,chrome} from src/ + icons/
src/
  sw.js                    Chrome service-worker entry (importScripts the bg modules)
  shared/                  one source of truth, shared across contexts
    browser-polyfill.js      alias browser -> chrome (loaded first everywhere)
    protocol.js              message + port name constants (content <-> background)
    settings-schema.js       settings keys + defaults (content, background, options)
    config.js                named timing/size constants (no magic numbers)
  core/                    PURE, no DOM/IO — unit-tested directly
    sites.js                 site registry: host -> provider, session id, answer selectors
    tokens.js                scrape session tokens from inline-script text (Gemini)
    prompt.js                compose the prompt (+ context-scope Strategy)
    anchor-match.js          TextQuoteSelector best-match scoring
    markdown-ast.js          markdown -> AST (Interpreter; the grammar)
    layout-engine.js         margin layout math: placement, height-share, orphan cluster
  gemini/ chatgpt/ claude/  one backend client per site, same `ask()` interface
    parser.js                PURE: that site's streaming response -> answer
    payload.js               PURE: build that site's request body + URLs
    client.js                strategy: transport + auth + streaming only
  background/clients.js    provider -> client registry (the ask router looks up here)
  content/                 imperative shell (DOM/IO; GA-global)
    util.js                  namespace, settings load, GA.provider, DOM builder, toast
    store.js                 storage.local, keyed by "<provider>:<id>" conversation
    markdown.js              render the markdown AST -> DOM (XSS-safe)
    anchor.js                Range <-> offset mapping + TreeWalker (uses anchor-match)
    selection.js             capture selection, wrap/unwrap highlight spans
    thread-turn.js           presenter for one Q&A turn (testable with fakes)
    thread-ui.js             one comment box (view): minimize / normal / maximize
    modal.js                 full-screen thread view
    gutter.js                margin VIEW: reads the page, applies layout-engine output
    token-provider.js        get session tokens (scrape + MAIN-world fallback + cache)
    ask-service.js           Facade over the background ask port (tags each ask w/ provider)
    triggers.js              context-menu + keyboard shortcut
    navigation.js            SPA route-change detection
    reanchorer.js            re-anchor orphans on mutation/scroll
    thread-controller.js     thread lifecycle + ask round-trip
    content.js               entry point — wires the collaborators together
  background.js            context menu + ask router; network call; MAIN-world token read
  options/                 settings page
  styles/content.css       all namespaced ga-* styles
icons/icon.svg + icon-{16,32,48,128}.png   (PNGs for Chrome; SVG for Firefox)
tests/                     Vitest specs (pure: node; DOM: jsdom via tests/helpers/loadGA.js)
```

## Tests

```bash
npm test            # vitest run (pure cores in node, DOM modules in jsdom)
npm run test:watch  # watch mode
npm run test:cov    # coverage (core/* and each provider's parser|payload are ~100%)
```

## Known limitations

- Selectors for each site's answer container (`responseSelectors` in
  `core/sites.js`) are heuristic; extend them if anchoring misses. The ChatGPT and
  Claude backends are reverse-engineered and may need re-tuning when those sites
  change their internals (see "How it talks to each AI").
- On narrow windows with no empty right margin, boxes overlap the chat (a
  marker-collapse fallback is planned).
- A thread whose highlight isn't in the DOM (page still loading, or the answer
  was edited/regenerated) becomes **orphaned** rather than being deleted. Orphans
  re-anchor automatically as their text scrolls into view; while orphaned, a lone
  one parks at the bottom of the margin and **2+ collapse into a single counted
  badge** (bottom-right) that opens a scrollable drawer.
