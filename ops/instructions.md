# Ops — build, package & publish

How to build the extension and submit it to the **Chrome Web Store** and **Firefox
Add-ons (AMO)**. For what the extension *is*, see the top-level [README](../README.md).

---

## 1. Build & package

One source tree (`src/` + `icons/`) builds both browsers. [`build.js`](../build.js)
copies it into `dist/<target>/` with the right manifest, then `web-ext` zips each.

| Target  | Manifest               | Background                 | Icons        | Package |
|---------|------------------------|----------------------------|--------------|---------|
| Firefox | `manifest.json`        | `background.scripts`       | `icon.svg`   | `web-ext-artifacts/firefox/gemini_assist-<version>.zip` |
| Chrome  | `manifest.chrome.json` | `src/sw.js` service worker | `icon-*.png` | `web-ext-artifacts/chrome/gemini_assist-<version>.zip` |

```bash
npm install            # once: web-ext + test tooling (Node 24 via mise)
npm test               # must be green
npm run lint           # web-ext lint of the assembled Firefox package — must be clean
npm run build          # -> web-ext-artifacts/{firefox,chrome}/gemini_assist-<version>.zip
```

`npm run build:firefox` / `npm run build:chrome` build a single target. The `dist/<target>/`
folder is the unpacked extension (use it for **Load unpacked** in Chrome dev).

### Regenerate the Chrome PNG icons (only if `icons/icon.svg` changes)
Chrome doesn't render SVG toolbar icons, so PNGs are committed under `icons/`. Re-rasterize with:
```bash
for s in 16 32 48 128; do rsvg-convert -w $s -h $s icons/icon.svg -o icons/icon-$s.png; done
# (ImageMagick alternative: magick -background none icons/icon.svg -resize ${s}x${s} icons/icon-$s.png)
```

---

## 2. Before every submission

1. **Bump the version** in **all three**: `manifest.json`, `manifest.chrome.json`, and
   `package.json` (stores reject re-uploading an existing version). Keep them identical.
2. Set a **stable extension id** for real listings. Firefox uses
   `browser_specific_settings.gecko.id` (currently `gemini-assist@local`) — pick a permanent,
   unique id (email-like or a domain you own). Chrome assigns its own id on first upload.
3. `npm test` green, `npm run lint` clean, `npm run build`.
4. Have listing assets + text ready (see below): 128px icon (already in the package),
   1–5 screenshots, a short summary, a full description, a **privacy policy URL**, and a
   permission justification.

### Permission / data-use justification (reused by both stores)
- `contextMenus` — the right-click **"Ask about …"** menu item.
- `storage` — saves comment threads, settings, and any API keys **locally** (`storage.local`).
- `scripting` — reads the Gemini page's session token from the MAIN world (web-session mode only).
- host permissions — the three chat sites (inject the margin UI + read answers) and the three
  API hosts (`api.openai.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`), used
  only when the matching API key is set.
- **Data**: highlighted text + conversation context is sent to the AI backend the user chose
  (their logged-in web session, or the official API via their own key). API keys are stored
  locally and sent only to that provider. Nothing is sent to any first-party server of ours.

---

## 3. Publish to the Chrome Web Store

1. **Developer account**: sign in at the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and
   pay the **one-time US$5** registration fee (first time only).
2. `npm run build:chrome` → upload `web-ext-artifacts/chrome/gemini_assist-<version>.zip` via
   **Add new item**.
3. **Store listing**: name, summary (≤132 chars), detailed description, **Productivity**
   category, language, and at least one **screenshot** (1280×800 or 640×400). The 128px icon
   ships in the package; promo tiles are optional.
4. **Privacy practices**: declare a **single purpose**, justify each permission (paste from
   §2), complete the **data-usage** disclosures, and provide a **privacy policy URL** (required
   given the broad host access).
5. **Distribution**: choose **Public** or **Unlisted**, then **Submit for review** (typically
   hours to a few days).
6. **Updates**: bump the version (§2), rebuild, upload the new zip, resubmit.

---

## 4. Publish to Firefox Add-ons (AMO)

Two routes — a public AMO listing, or a self-hosted signed `.xpi`. Both require a Firefox
account and AMO API credentials.

**API credentials**: [addons.mozilla.org](https://addons.mozilla.org/developers/) →
**Manage API Keys** → copy the **JWT issuer** and **secret**. Export them:
```bash
export AMO_JWT_ISSUER=user:xxxxx:xxx
export AMO_JWT_SECRET=xxxxxxxx
node build.js firefox          # assemble dist/firefox with manifest.json
```

### Option A — Listed on AMO (public, reviewed)
```bash
npx web-ext sign --source-dir dist/firefox --channel=listed \
  --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET"
```
Or upload the zip manually via **Developer Hub → Submit a New Add-on → "On this site"**. AMO
reviews listed add-ons before they go public; fill in the listing (summary, description,
screenshots, categories) and note the declared data collection (the manifest already declares
`data_collection_permissions: websiteContent`).

### Option B — Unlisted / self-distribution (you host the signed `.xpi`)
```bash
npx web-ext sign --source-dir dist/firefox --channel=unlisted \
  --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET" \
  --artifacts-dir web-ext-artifacts/firefox
```
This returns a Mozilla-**signed** `.xpi` you can distribute yourself; users install it via
`about:addons` → ⚙ → **Install Add-on From File…**. (An *unsigned* build only installs
permanently on Developer Edition / Nightly / ESR with
`about:config → xpinstall.signatures.required = false`.)

**Updates**: bump the version (§2), rebuild `dist/firefox`, re-sign/-submit.

---

## 5. Caveats for review

- **Web-session backends are reverse-engineered.** The default (no-key) Gemini/Claude paths
  replay each site's private endpoints, which may conflict with those sites' Terms of Service —
  store reviewers can flag this. The **API-key path** (OpenAI / Google AI / Anthropic, using the
  user's own key) is the cleaner story for a public listing; consider shipping API-key-only if a
  reviewer objects.
- **ChatGPT is API-key-only** (its web session is Cloudflare-Turnstile-gated); there is no web
  fallback.
- **Icons**: Chrome needs the PNGs (`icon-16/32/48/128.png`); Firefox uses `icon.svg`. Both are
  committed.
- **`web-ext lint` must pass** for AMO; run `npm run lint` first.
- Keep `manifest.json` and `manifest.chrome.json` in sync (name, version, permissions, content
  scripts) — only the background entry, the icon format, and the Firefox-only
  `browser_specific_settings` should differ. The Firefox `background.scripts` list and Chrome's
  `src/sw.js` `importScripts()` must name the same modules in the same order (load order matters);
  `tests/build/wiring.test.js` enforces this, so `npm test` fails if they drift.
