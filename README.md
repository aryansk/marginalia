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
> bits are isolated in [`src/gemini/client.js`](src/gemini/client.js). If replies
> stop: open DevTools → Network on gemini.google.com, send a normal message,
> inspect the `StreamGenerate` request's `f.req` field + the response, and adjust
> `buildBody()` / `extractText()` to match. Built for personal use.

## Install (temporary, for development)

1. `npm install` (provides `web-ext`; Node comes from `mise`).
2. Either:
   - `npm start` — launches Firefox with the extension loaded, or
   - manually: open `about:debugging` → **This Firefox** → **Load Temporary
     Add-on…** → pick `manifest.json`.
3. Open gemini.google.com (logged in) and try it.

`npm run lint` validates the manifest/code; `npm run build` produces a zip.

## Settings

Toolbar icon (or `about:addons` → Gemini Assist → Preferences):

- **Keyboard shortcut** — rebind the trigger (default Ctrl+Shift+H).
- **Context scope** — highlight only / highlight + section (default) / whole conversation.
- **Delete all saved threads.**
- **Debug logging.**

## Layout / file map

```
manifest.json              MV3 (Firefox)
src/
  background.js            context menu + ask router; network call; MAIN-world token read
  gemini/client.js         StreamGenerate request build + response parse (the fragile part)
  content/
    util.js                namespace, settings, DOM helpers, toast
    store.js               storage.local, keyed strictly by /app/<id> session
    markdown.js            safe markdown → DOM
    anchor.js              TextQuoteSelector create + locate
    selection.js           capture selection, find answer section, wrap/unwrap highlights
    thread-ui.js           one comment box (spinner, messages, delete-confirm, streaming)
    modal.js               full-screen thread view
    gutter.js              margin layout: level-anchoring, collision, height-share, focus-dim
    content.js             controller: triggers, lifecycle, ask round-trip, SPA nav, re-anchor
  options/                 settings page
  styles/content.css       all namespaced ga-* styles
icons/icon.svg
```

## Known limitations

- Selectors for Gemini's answer container (`GEMINI_RESPONSE_SELECTORS` in
  `selection.js`) are heuristic; extend them if anchoring misses.
- On narrow windows with no empty right margin, boxes overlap the chat (a
  marker-collapse fallback is planned).
- If Gemini regenerates/edits an answer, a thread whose text disappears is shown
  as **orphaned** (parked at the bottom, "anchor lost") rather than deleted.
