# Gemini Assist

A Firefox extension that adds **Google-Docs-style margin comment threads** to
[gemini.google.com](https://gemini.google.com).

When Gemini gives a long answer and you want to drill into one phrase, you no
longer have to ask in the main chat (and bury the original answer). Instead:

1. **Highlight** the phrase (e.g. _"8 KB page"_).
2. **Right-click → "Ask Gemini about …"**, or press **Ctrl + Shift + H**.
3. A comment box opens **in the right margin, level with your highlight**.
4. Ask your follow-up. The reply streams **into the box** — your main chat is untouched.
5. Keep the conversation going; the box re-sends the full thread each turn.

Threads are multi-turn, height-capped (scroll inside, or **expand to a modal**),
**persist per conversation**, and re-anchor to their highlight on reload.

## How it talks to Gemini

It reuses your **already-logged-in session** — no API key. Because the code runs
on gemini.google.com, your session cookies attach automatically; the extension
only reads the page's anti-CSRF token and replays Gemini's internal
`StreamGenerate` endpoint from the background script.

> ⚠️ **That endpoint is undocumented.** Google can change its request/response
> shape without notice, which would break replies until updated. All the fragile
> bits are isolated in two small, unit-tested modules:
> [`src/gemini/payload.js`](src/gemini/payload.js) (the `f.req` request) and
> [`src/gemini/parser.js`](src/gemini/parser.js) (the response). If replies stop:
> open DevTools → Network on gemini.google.com, send a normal message, inspect the
> `StreamGenerate` request's `f.req` field + the response, and adjust
> `buildBody()` / `parseLatest()` to match. Built for personal use.

## Build & install

### 0. Prerequisites (once)

```bash
npm install        # installs web-ext locally; Node 24 comes from mise
```

### A. Run it for development (temporary, auto-reload)

Easiest while hacking. The add-on disappears when Firefox closes.

```bash
npm start          # = web-ext run … : launches Firefox with the extension loaded
```

Or load it by hand into your normal Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → pick this folder's `manifest.json`.
3. Open gemini.google.com (logged in) and try it.

`npm run lint` validates the manifest/code before you ship.

### B. Build a distributable package

```bash
npm run build      # = web-ext build … : writes web-ext-artifacts/gemini_assist-<version>.zip
```

That `.zip` is the packaged extension (rename to `.xpi` to install it as a file).

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
manifest.json              MV3 (Firefox)
src/
  shared/                  one source of truth, shared across contexts
    protocol.js              message + port name constants (content <-> background)
    settings-schema.js       settings keys + defaults (content, background, options)
    config.js                named timing/size constants (no magic numbers)
  core/                    PURE, no DOM/IO — unit-tested directly
    session.js               getSessionId(pathname)
    tokens.js                scrape session tokens from inline-script text
    prompt.js                compose the prompt (+ context-scope Strategy)
    anchor-match.js          TextQuoteSelector best-match scoring
    markdown-ast.js          markdown -> AST (Interpreter; the grammar)
    layout-engine.js         margin layout math: placement, height-share, orphan cluster
  gemini/
    parser.js                PURE: StreamGenerate (batchexecute) response -> answer
    payload.js               PURE: build the f.req body + request URL
    client.js                WebRpcClient strategy: transport + streaming only
  content/                 imperative shell (DOM/IO; GA-global)
    util.js                  namespace, settings load, DOM builder, toast
    store.js                 storage.local, keyed strictly by /app/<id> session
    markdown.js              render the markdown AST -> DOM (XSS-safe)
    anchor.js                Range <-> offset mapping + TreeWalker (uses anchor-match)
    selection.js             capture selection, wrap/unwrap highlight spans
    thread-turn.js           presenter for one Q&A turn (testable with fakes)
    thread-ui.js             one comment box (view)
    modal.js                 full-screen thread view
    gutter.js                margin VIEW: reads the page, applies layout-engine output
    token-provider.js        get session tokens (scrape + MAIN-world fallback + cache)
    gemini-service.js        Facade over the background ask port
    triggers.js              context-menu + keyboard shortcut
    navigation.js            SPA route-change detection
    reanchorer.js            re-anchor orphans on mutation/scroll
    thread-controller.js     thread lifecycle + ask round-trip
    content.js               entry point — wires the collaborators together
  background.js            context menu + ask router; network call; MAIN-world token read
  options/                 settings page
  styles/content.css       all namespaced ga-* styles
icons/icon.svg
tests/                     Vitest specs (pure: node; DOM: jsdom via tests/helpers/loadGA.js)
```

## Tests

```bash
npm test            # vitest run (pure cores in node, DOM modules in jsdom)
npm run test:watch  # watch mode
npm run test:cov    # coverage (core/* and gemini/parser|payload are ~100%)
```

## Known limitations

- Selectors for Gemini's answer container (`GEMINI_RESPONSE_SELECTORS` in
  `selection.js`) are heuristic; extend them if anchoring misses.
- On narrow windows with no empty right margin, boxes overlap the chat (a
  marker-collapse fallback is planned).
- A thread whose highlight isn't in the DOM (page still loading, or the answer
  was edited/regenerated) becomes **orphaned** rather than being deleted. Orphans
  re-anchor automatically as their text scrolls into view; while orphaned, a lone
  one parks at the bottom of the margin and **2+ collapse into a single counted
  badge** (bottom-right) that opens a scrollable drawer.
