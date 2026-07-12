### Ticket T-001: Composer undo — Ctrl+Z restores deleted or cleared text

> **Status: ✅ DONE** — shipped in commit `f5fdfc6`, merged to `master`. Verified 2026-07-10: `src/content/undo-stack.js` (`GA.UndoStack` + `GA.attachComposerUndo`) wired into both composers and both manifests; tests in `tests/content/undo-stack.test.js`, `tests/dom/composer.dom.test.js`, `tests/dom/thread-ui.dom.test.js`; full suite 356 pass, both builds OK.

**Goal** — When the user types into a comment composer, then loses that text (selects-all-and-deletes it, or it is cleared programmatically on send), pressing Ctrl+Z (Cmd+Z on macOS) while the composer is focused brings the text back. Today `textarea.value = ""` on submit destroys the browser's native undo stack, and host pages (chatgpt.com, gemini.google.com, claude.ai) may intercept Ctrl+Z, so undo is unreliable or impossible.

**Scope**
- In: a shared undo/redo helper for composer textareas; wiring it into BOTH composers — the shared `GA.Composer` (`src/content/composer.js`, used by the maximize modal) and the inline composer textarea built in `src/content/thread-ui.js` (~line 150); tests.
- Out: persisting drafts across page reloads (not requested); undo for anything other than composer text; panel/search UI (T-003).

**Spec**
- Create a small helper (suggested: `src/content/undo-stack.js` exposing `GA.UndoStack` or `GA.attachComposerUndo(textarea, {onRestore})`) that maintains a bounded per-textarea snapshot stack (value + caret position; cap ~50 entries).
  - Snapshot policy: checkpoint on meaningful transitions — before a deletion that removes a "significant" amount (e.g. the value shrinks and the previous value is non-empty), on idle pauses while typing (debounce), and ALWAYS immediately before any programmatic clear (submit paths).
  - `keydown` on the textarea: `(e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z"` → undo (with `e.shiftKey` → redo); also support Ctrl+Y as redo. When the helper acts, call `e.preventDefault()` and `e.stopPropagation()` so the host page cannot hijack the event. When the stack has nothing to do, let the event fall through to native behavior.
  - Undo must work for the "sent" case too: after `submit()` clears the textarea, focus + Ctrl+Z restores the just-sent text.
- Wire into both composers. In each, the existing `submit()` (`composer.js` ~line 44 and `thread-ui.js` ~line 492) must push a snapshot before `textarea.value = ""`. After any restore, re-run that composer's `autosize()` so the box re-fits (the `GA.fitTextarea` pattern), and restore the caret.
- If a new file is created it must: use the `GA` global pattern, be added to the content-script lists in BOTH `manifest.json` and `manifest.chrome.json`, and end with the `module.exports` shim for vitest.
- Keep the existing Enter / Shift+Enter / Cmd+Enter handling in both composers untouched.

**Acceptance criteria**
- Unit test (`tests/content/`): the undo-stack helper — push/undo/redo ordering, bound on stack size, no-op undo on empty stack falls through.
- DOM test (`tests/dom/`, jsdom + `loadGA`): in `GA.Composer` — type text, simulate submit (value cleared), dispatch Ctrl+Z keydown → `textarea.value` is restored and autosize re-ran; Ctrl+Shift+Z re-clears.
- DOM test: same restore-after-clear behavior for the inline composer inside `GA.ThreadBox`.
- Ctrl+Z with an empty stack does not `preventDefault` (native behavior preserved).
- `npm test` passes; `node build.js` succeeds; if a file was added, both manifests list it.

**Depends on** — none.

### Ticket T-002: Focus mode — clicking one thread collapses all other open threads

> **Status: ✅ DONE** — shipped in commit `7ac3246`, merged to `master`. Verified 2026-07-10: implemented as `GA.gutter.focusThread(id)` (kept out of `setActive` so programmatic activations don't collapse others), wired into all user-click paths; tests in `tests/dom/gutter-focus.dom.test.js` (7 cases); full suite 356 pass, both builds OK.

**Goal** — When multiple thread boxes are open in the margin, clicking one (its box, its chip, or its page highlight) should minimize every other expanded thread to its compact chip, so the user focuses on one conversation at a time without manually tucking the rest away.

**Scope**
- In: collapse-others behavior on thread activation, reusing the existing per-thread collapse machinery; tests.
- Out: changes to Alt+Shift+C bulk toggle semantics (`GA.gutter.toggleAllCollapsed`); auto-RE-expanding the others afterwards; any settings/opt-out UI; composer undo (T-001); panel search (T-003).

**Spec**
- Behavior: when the user activates a thread — clicking its box (`root` mousedown → `handlers.onFocus` → `GA.gutter.setActive`, see `src/content/thread-controller.js` ~line 26), clicking its collapsed chip (which restores it, `src/content/thread-ui.js` ~line 126), or clicking its page highlight (`setupFocusListeners()` in `src/content/content.js`) — every OTHER registered, currently-expanded box collapses via `box.setCollapsed(true)`.
- Hook point: centralize in `GA.gutter` (e.g. inside or alongside `setActive(id)`, `src/content/gutter.js` ~line 159, which already iterates `registry`). Watch the early-return in `setActive` when the active id is unchanged — collapsing others must still happen on a fresh click even if that thread was already active (e.g. others were re-expanded meanwhile), OR document/test that re-clicking the already-active thread is a no-op; pick one and test it.
- The activated thread itself: if collapsed, it restores (existing chip-click behavior); if expanded, it stays expanded. Resolved threads keep their existing resolved-chip rendering — do not force-expand them; skip resolved boxes when collapsing others only if `setCollapsed` would fight the resolved state (check `thread-ui.js` `setResolved`).
- Collapsed state persists exactly as it does today (via `setCollapsed`'s existing persist path — `thread.collapsed` + store upsert). Unread-dot semantics unchanged: threads auto-collapsed by this feature can still receive the unread dot when a reply lands (`thread-ui.js` ~line 482).
- Programmatic activations that are NOT user clicks (e.g. restore-on-load, re-anchoring, Alt+↓/↑ cycling in `keyboard-nav.js`) must NOT trigger collapse-others unless they already funnel through the same user-click path — gate the behavior on the click-driven entry points. Alt+↓/↑ cycling: leave current behavior (no collapse-others) unless it already calls the same hook, in which case exclude it explicitly.
- Trigger `handlers.onResize({animate:true})` / layout reflow once for the batch, not once per box, if the existing API allows (avoid N animated reflows).

**Acceptance criteria**
- DOM test (jsdom + `loadGA`) with 3+ boxes registered in `GA.gutter`: simulating a user click/activation on box A asserts `A.isCompact() === false` and `isCompact() === true` for all others.
- Clicking a collapsed chip restores that thread AND collapses the other expanded ones.
- A resolved thread is not force-expanded and does not lose its resolved state.
- Alt+Shift+C (`toggleAllCollapsed`) behavior is unchanged by the feature (existing tests still pass or a test covers it).
- `npm test` passes; `node build.js` succeeds.

**Depends on** — none.

### Ticket T-003: Keyword search across all threads in the panel

> **Status: ✅ DONE** — shipped in commit `8a26b4b`, merged to `master`. Verified 2026-07-10: pure matcher `src/core/thread-search.js` (`GA.core.threadSearch.matches`) + panel search input/clear/count/empty-state in `src/content/panel.js`, Escape-to-clear composed with close; tests in `tests/core/thread-search.test.js` (6 cases) + `tests/dom/panel.dom.test.js` (7 cases, incl. no-innerHTML guard); full suite 356 pass, both builds OK.

**Goal** — The all-threads panel (Alt+Shift+A) lists every thread in the current conversation but offers only open/resolved/all status tabs. Add a keyword search input so the user can find, within this conversation, every thread whose highlight snippet or any message (their questions AND the AI's replies) contains the query.

**Scope**
- In: a search input in the panel header; a pure, unit-testable match predicate over thread records; live filtering of the panel list composed with the existing status filter; match count / empty state; styles.
- Out: cross-conversation or cross-site search; fuzzy matching or ranking; search outside the panel (no inline page find); highlight-in-margin-box behavior.

**Spec**
- Pure matcher first: a function (suggested home: `src/core/` since it is pure and `src/core` is the heavily unit-tested layer, e.g. `src/core/thread-search.js` → `GA.threadSearch.matches(thread, query)`), case-insensitive substring match against `thread.selector.exact` and every `thread.messages[].text`. Empty/whitespace query matches everything. New file → `GA` global pattern + both manifests + `module.exports` shim.
- Panel UI (`src/content/panel.js`): add a search `<input>` (with placeholder and a clear "×" affordance) in the panel header near the `.ga-panel-tabs` row. `input` event → store query in panel state → `renderList()`. Extend the existing predicate in `renderList()` (~lines 58–64) so a row must pass BOTH the status filter and the keyword match.
- While a query is active: show a result count (e.g. "3 of 12"), and a friendly empty-state row when nothing matches (there may already be an empty-state pattern in `renderList` — reuse it). Optionally highlight the matched substring in the rendered snippet/first-question text via a `<mark>`-style span — if done, escape text safely (the panel currently sets text content; do not introduce innerHTML injection from thread/message text).
- Keyboard: Escape while the search input is focused and non-empty clears the query (and keeps the panel open); the panel's existing close-on-Escape (if any) applies only when the input is empty or unfocused. Opening the panel focuses… leave existing focus behavior; do not steal focus into the search box unless trivial.
- Query state resets when the panel is closed and reopened (no persistence).
- Styles: new `.ga-panel-search*` classes in `src/styles/content.css`, consistent with existing panel styling in both light and dark themes.

**Acceptance criteria**
- Unit test (`tests/core/` or `tests/content/`): the matcher — case-insensitive hit on `selector.exact`, on a user message, on a model reply; miss returns false; empty query matches all; handles threads with no messages.
- DOM test (jsdom + `loadGA`): panel with several threads — typing a query reduces `.ga-panel-row` count to only matching threads; combines with the "resolved" tab (a matching-but-open thread is hidden under the resolved tab); clearing the query restores the full list; no-match state renders.
- No `innerHTML` built from thread/message text (verified by review; matched-text highlighting, if implemented, uses DOM nodes / escaped text).
- `npm test` passes; `node build.js` succeeds; any new file is listed in both manifests.

**Depends on** — none.

### Ticket T-004: [B] Draft retention — never auto-delete non-empty draft buckets

> **Status: ✅ DONE** — shipped in commit `74636df` on `master`. Verified 2026-07-11: `sweepDrafts` adopts every non-empty current-provider draft bucket (any tabToken/age, union by id, verify-then-remove concurrency guards) and removes only empty ones; `isStaleDraft` keeps undatable buckets; `saveAllRaw` is the single `createdAt` stamp site; `GA.tabToken` falls back to the stable `tab_shared` sentinel. Tests rewritten/added in `tests/content/store.test.js` + new `tests/content/tab-token.test.js`; suite 371 pass, both builds OK.

**Goal** — Stop the extension from silently, permanently deleting user threads. Threads created before a chat has a stable conversation id live in a per-tab "draft" bucket (`ga:threads:__draft__:<provider>:<tabToken>`) and are promoted to the real conversation bucket once the id appears. Today the failure mode of non-promotion is DELETION: `sweepDrafts` reaps any draft bucket older than a 7-day TTL, and `tabToken` instability multiplies stranding. Convert the draft path from "promote-or-perish" to "promote-or-retain."

**Scope**
- In: `src/content/store.js` (`sweepDrafts`, `isStaleDraft`) and `src/content/util.js` (`tabToken`), plus defensive `createdAt` stamping.
- Out: backup export/import (T-007/T-008); transcript capture (T-009/T-010); the per-thread restore try/catch (T-005).

**Spec**
- `sweepDrafts` must NEVER delete a draft bucket that still contains threads. Change the removal criterion from "stale by TTL" to "empty bucket only." A non-empty draft bucket is either adopted (below) or left intact — never removed by age.
- Adoption: on init, adopt ALL non-empty `ga:threads:__draft__:<provider>:*` buckets for the current provider — regardless of `tabToken` and regardless of age — into the current tab's draft bucket (union by thread `id`, de-duped). Remove a source draft bucket only AFTER its threads are safely written to the target (mirror the existing migrateDraft copy-then-remove ordering: save target first, then remove source).
- `isStaleDraft` must treat a bucket whose threads lack `createdAt` as NOT stale (keep it); today `newest=0` makes it look expired. "Not datable → keep."
- `src/content/util.js` `tabToken`: when `sessionStorage` is unavailable (private/partitioned), do NOT mint a fresh random token per page load (that orphans drafts every reload). Use a stable fallback — persist the token in `browser.storage.local`, or drop the per-tab qualifier so all this-provider drafts share one bucket. Either way a reload must resolve to the SAME draft bucket.
- Defensively stamp `createdAt = Date.now()` on any thread persisted/restored that lacks it.

**Acceptance criteria**
- Unit (`tests/content/`): `sweepDrafts` keeps a non-empty draft bucket that is >7 days old; removes only empty buckets; adopts non-empty buckets from a different `tabToken` (same provider); a bucket whose threads lack `createdAt` is kept, not swept.
- Unit: `isStaleDraft` returns false for threads-without-`createdAt`.
- The stable-`tabToken` fallback resolves to the same draft key across two simulated loads when `sessionStorage` throws.
- No code path deletes a draft bucket that still holds threads (asserted by test).
- `npm test` passes; `node build.js` succeeds.

**Depends on** — none.

### Ticket T-005: [B] Restore isolation — one bad thread can't abort the restore loop

> **Status: ✅ DONE** — shipped in commit `8bc34ea` on `master`. Verified 2026-07-11: per-thread try/catch in `restoreForSession` (warn + continue, failing record left in storage); no createdAt stamp added (T-004's `saveAllRaw` owns it). New `tests/content/thread-controller-restore.test.js`; suite 375 pass, both builds OK.

**Goal** — On load, `restoreForSession` iterates stored threads with `.forEach(restoreThread)` (`src/content/thread-controller.js:109`). If any single thread throws (a malformed or legacy record), the loop dies and NONE of the remaining threads restore — one bad record hides an entire conversation's annotations. Isolate each thread's restore so a failure skips only that record.

**Scope**
- In: `src/content/thread-controller.js` (`restoreForSession` / `restoreThread` call site).
- Out: draft retention (T-004); anything else.

**Spec**
- Wrap the per-thread restore in try/catch so a throw restores the rest. On catch, log via `GA.warn` with the thread id, and continue. Do NOT persist or delete the failing thread — leave its stored record intact for a future load / migration.
- Keep behavior identical for well-formed threads.

**Acceptance criteria**
- DOM/unit test: a stored set where one record makes `restoreThread` throw still restores all the OTHER threads (asserts the good ones are present in `threadController.threads()` / the gutter).
- The failing record is not deleted from storage.
- `npm test` passes; `node build.js` succeeds.

**Depends on** — none.

### Ticket T-006: [A0] Gear icon in the "Comment threads" panel → open the options page

> **Status: ✅ DONE** — shipped in commit `e92703f` on `master`. Verified 2026-07-11: `MSG_OPEN_OPTIONS` in `src/shared/protocol.js`, gear glyph in `icons.js`, gear `.ga-iconbtn` in the panel header before closeBtn, separate ungated background listener → `openOptionsPage()` (deviation from "extend the existing router", which is gemini-gated). New `tests/dom/panel-gear.dom.test.js` + `tests/background/open-options.test.js`; suite 385 pass, both builds OK.

**Goal** — The browser's options page (settings, API keys, and the new backup Export/Import) is hard to find. Add a gear icon to the "Comment threads" panel header that opens it in one click.

**Scope**
- In: a gear `.ga-iconbtn` in the panel header (`src/content/panel.js`), a new "gear" icon (`src/content/icons.js`), a new protocol message constant, and a background handler.
- Out: the NotebookLM export button (T-012); any options-page content (T-008).

**Spec**
- Add a "gear" icon to `GA.icons` (the registry used via `GA.icons.make(name)`) — an inline SVG consistent with the existing icon set.
- In `src/content/panel.js`, add a gear `.ga-iconbtn` to the panel header (the `.ga-modal-header` row assembled ~line 97, next to the existing `closeBtn`), `title`/`aria-label` "Settings".
- Content scripts CANNOT call `openOptionsPage` directly. On click: `browser.runtime.sendMessage({ type: GA.protocol.MSG_OPEN_OPTIONS })`. Add `MSG_OPEN_OPTIONS` to the protocol constants module (where `MSG_READ_TOKENS` / `MSG_OPEN_FROM_CONTEXT` are defined). Extend the existing `browser.runtime.onMessage` router in `src/background.js` (~line 64) to handle it → `browser.runtime.openOptionsPage()`.
- No new manifest permission — `options_ui` is already declared in both manifests.

**Acceptance criteria**
- DOM test: the panel header renders a gear button; clicking it calls `browser.runtime.sendMessage` with `{type: MSG_OPEN_OPTIONS}` (stub `sendMessage`).
- Background: the `onMessage` handler routes `MSG_OPEN_OPTIONS` → `openOptionsPage` (unit-testable with a stubbed `browser.runtime`).
- No new permission added to either manifest.
- `npm test` passes; `node build.js` succeeds.

**Depends on** — none.

### Ticket T-007: [A] Backup core — pure export / merge-import over storage buckets

> **Status: ✅ DONE** — shipped in commit `bcc14e0` on `master`. Verified 2026-07-11: pure `GA.core.backup` with `buildExport` (allowlist, secrets excluded), `mergeTurnLists` (the ONE LCS order-preserving multiset turn interleave; fuzzed over 200k pairs), and `mergeImport` (additive merge — archive-win collisions take only `messages`, ALL local fields survive; guarded replace; prefix-enforced archive buckets; null-proto id index). Registered in both manifests + `options.html`. 40 specs in `tests/core/backup.test.js`; suite 426 pass, both builds OK.

**Goal** — The durability foundation: a pure, unit-tested module that serializes all saved threads (and, when present, compressed conversation transcripts) into a portable JSON archive, and merges an archive back into current storage WITHOUT ever losing data. No UI here (T-008 wires it).

**Scope**
- In: new pure `src/core/backup.js` exposing `GA.core.backup.buildExport(all, exportedAt)` and `GA.core.backup.mergeImport(existing, imported, {mode})`.
- Out: the options-page UI + file I/O (T-008); transcript capture/compression (T-009).

**Spec**
- New file `src/core/backup.js` following the `src/core/*` `GA`-global pattern; add to the content-script lists in BOTH `manifest.json` and `manifest.chrome.json` AND to `options.html` (the options page uses it); end with the `module.exports` shim. T-007 OWNS all three registrations.
- `buildExport(all, exportedAt)` — given the object from `browser.storage.local.get()`, produce the envelope `{ format:"marginalia-threads", version:1, exportedAt, threads:{<ga:threads:* key>:<array>}, convos:{<ga:convo:* key>:<record-object>} }`. Include every `THREADS_PREFIX` (`ga:threads:`) and `CONVO_PREFIX` (`ga:convo:`) key by ALLOWLIST. Convo values are RECORD OBJECTS `{provider,id,title,url,capturedAt,turns:[{role,fp,order}],blobs:{"<hash>:<len>":<gzip+base64>}}` carried VERBATIM (buildExport never decompresses the inner blobs). EXCLUDE the settings key and any `*ApiKey` — never export secrets. `exportedAt` is passed in (pure — no `Date.now()` inside).
- `mergeTurnLists(existing, snapshot)` — NEW pure public export, the ONE turn-index merge implementation in the system (store.js's `mergeTurns` and `mergeImport` both use it). An order-preserving MULTISET interleave: both inputs are subsequences of the true conversation; align by LCS over alignment keys `role + ":" + fp.hash + ":" + fp.len` (each entry matches at most once, so repeated identical messages survive); between anchors emit existing-only entries then snapshot-only entries; renumber `order` 0..n-1. Handles prepend (scroll-up reveal), append, and middle-insert; idempotent.
- `mergeImport(existing, imported, {mode})` — returns the new storage object to write. Validate the envelope (`format`, `version`; reject a `version` newer than this build supports; tolerate a missing `convos` or `threads` section). Modes:
  - `merge` (default) — ADDITIVE, never deletes: for each thread bucket, union by `thread.id`; on id collision keep the record with MORE `messages` (content-max); on a TIE keep the existing record verbatim; when the ARCHIVE record wins, copy the local record's status flags (`resolved`, `resolvedAt`, `collapsed`, `unread`) onto it so a restore never un-resolves a locally-resolved thread. Threads present only in `existing` are untouched. For each convo bucket, merge the plaintext `turns` index via `mergeTurnLists` and union the `"<hash>:<len>"`-keyed `blobs` maps (identical keys dedupe); blobs stay compressed (no decompress on import). Buckets present only in `existing` are untouched.
  - `replace` — for buckets present in the archive only, replace them wholesale; buckets not named by the archive are left intact. (The one destructive mode; the UI guards it in T-008.)
- Idempotent: re-running `mergeImport` with the same archive yields the same result (keys on `id` / alignment — no duplication, no growth).

**Acceptance criteria**
- Unit (`tests/core/backup.test.js`): `buildExport` includes threads + convo record objects (inner blobs byte-identical), excludes settings/`*ApiKey`; round-trip (export → `mergeImport` into empty) reproduces threads AND convos; merge is additive (a thread only in `existing` survives; a colliding id keeps the more-message record, a TIE keeps existing, and local `resolved`/`collapsed`/`unread` flags survive an archive win; a local thread absent from the archive is never removed); importing the SAME archive twice == once (idempotent); a newer-`version` envelope is rejected; a missing `convos` section is tolerated.
- `mergeTurnLists` unit tests: PREPEND (scroll-up: snapshot has older turns before the first shared anchor → they land first), append, middle-insert, MULTISET (two identical "continue" turns both survive), renumbered `order`, merge-twice == merge-once.
- New file listed in both manifests + `options.html`; ends with the `module.exports` shim; `mergeImport`/`mergeTurnLists` never call any (de)compression API and never mutate their arguments.
- `npm test` passes; `node build.js` succeeds.

**Depends on** — none. (Implements the agreed convo record shape from `impl_plan.md`; works even before any convo bucket exists.)

### Ticket T-008: [A] Options page Export / Import UI

> **Status: ✅ DONE** — shipped in commit `07331d2` on `master`. Verified 2026-07-11: options Data card Export/Import UI wired to `GA.core.backup`; confirm-gated replace (gates before any storage access); every failure path visible in `#backup-status` via textContent incl. named quota rejection (F9). New `tests/dom/options-backup.dom.test.js`; suite 446 pass, both builds OK.

**Goal** — Surface the backup on the options page: buttons to download an archive of all saved threads/transcripts and to import one back, beside the existing "Delete all saved threads" control. The user-facing durability answer to "uninstall wipes my data."

**Scope**
- In: `src/options/options.js` + `src/options/options.html` — Export button, Import (file picker), a "Replace instead of merge" checkbox, status text. Uses `GA.core.backup` (T-007).
- Out: the backup logic itself (T-007); the panel gear (T-006); the NotebookLM export (T-012).

**Spec**
- In `options.html`, add an Export button, an Import button (backed by a hidden `<input type="file" accept="application/json">`), a "Replace instead of merge (discards current threads for conversations in the backup)" checkbox, and a status line — in the same section as the existing `#clear-btn` "Delete all saved threads" control.
- Export: `browser.storage.local.get()` → `GA.core.backup.buildExport(all, Date.now())` → download a `Blob` as `marginalia-threads-YYYYMMDD.json` (temporary `<a download>`; revoke the object URL). Status: "Exported N threads from M conversations."
- Import: read the chosen file via `file.text()`, `JSON.parse` in try/catch (surface a friendly error, never throw to console); then `existing = await browser.storage.local.get()`, `next = GA.core.backup.mergeImport(existing, parsed, {mode: replaceChecked ? "replace" : "merge"})`, `await browser.storage.local.set(next)`. Status: "Imported N threads into M conversations (K new)." Replace mode shows a `confirm()` first (BEFORE any storage write).
- ERROR HANDLING: wrap BOTH handlers' storage/Blob work in try/catch and surface a friendly failure status (via textContent) — name the storage quota when detectable (`storage.local.set` on a too-large archive rejects atomically: nothing is written, but the user must SEE that the import didn't happen). Never leave a failure visible only in the console.
- Never export or touch the settings / API-key keys.

**Acceptance criteria**
- Round-trip: Export produces a JSON file; Import of it restores threads (merge) without duplicating on re-import; Replace only affects conversations present in the archive.
- Import of a malformed file shows an error and changes nothing; a REJECTING `storage.local.set` (e.g. quota) shows a failure status and storage is untouched.
- If DOM-testable in the options context, a test drives `buildExport`/`mergeImport` through the button handlers with a stubbed `browser.storage.local`.
- `npm test` passes; `node build.js` succeeds.

**Depends on** — T-007. (T-006 makes this page reachable from the panel.)

### Ticket T-009: [C1] Transcript storage layer + gzip compression

> **Status: ✅ DONE** — shipped in commit `b721cf7` on `master`. Verified 2026-07-11: `CONVO_PREFIX` in schema; `src/core/compress.js` per-message `gzipToB64`/`b64ToText` (chunked base64, >100 KB unicode round-trip, clean rejection on garbage); store `convoKey`/`loadConvo` (raw, never decompresses)/`saveConvo` (plain JSON via serialize queue)/`mergeTurns` = delegate to `GA.core.backup.mergeTurnLists`; blobs keyed `hash:len`. New `tests/core/compress.test.js` + store specs; suite 468 pass, both builds OK.

**Goal** — Persist conversation transcripts so they survive reloads/virtualization and can be exported to NotebookLM (T-012) and backed up (T-007). Introduce the compressed `ga:convo:*` storage layer and a native-gzip IO helper plus the pure fingerprint-union merge. Capture WIRING is T-010.

**Scope**
- In: `CONVO_PREFIX` in `src/shared/settings-schema.js`; a new `GA.core.compress` (or `src/content/compress.js`) IO helper (native `CompressionStream`); convo read/write + a pure `mergeTurns` in `src/content/store.js` (or a small sibling module).
- Out: capture triggers (T-010); the markdown builder (T-011); export UI (T-012).

**Spec**
- Add `CONVO_PREFIX: "ga:convo:"` to `GA.schema` in `settings-schema.js`. Convo bucket key = `ga:convo:<provider>:<id>` (same `<provider>:<id>` session id as threads). Record shape (PER-MESSAGE BLOBS — final): `{ provider, id, title, url, capturedAt, turns:[{role, fp:{hash,len}, order}], blobs:{ "<hash>:<len>": "<gzip+base64 of that message's text>" } }` — the `turns` index and metadata are stored as PLAIN JSON (never compressed); each message BODY is its own gzip+base64 blob keyed by BOTH fingerprint parts `fp.hash + ":" + fp.len` (hash alone would let a 32-bit collision render the wrong text under a turn). Every message is a blob — no size threshold, no inline plaintext.
- New `src/core/compress.js` exposing async PER-MESSAGE `gzipToB64(str)` and `b64ToText(b64)` using the built-in `CompressionStream`/`DecompressionStream` ("gzip") + base64. Chunk the bytes↔binary-string conversion (a single `String.fromCharCode` spread over a large typed array overflows the argument limit) — must round-trip multi-hundred-KB non-ASCII text. New file → GA-global pattern, both manifests, `module.exports` shim.
- Convo store API in `store.js`: `loadConvo(session)` returns the RAW record or null (blobs stay compressed — loadConvo NEVER decompresses; the sole decompress site is T-012's export); `saveConvo(session, record)` writes the record as plain JSON through the existing `serialize()` write queue (blobs are already-compressed strings); `mergeTurns(existingTurns, newTurns)` is a thin DELEGATE to `GA.core.backup.mergeTurnLists` (T-007's order-preserving multiset interleave — the ONE index-merge implementation; do not reimplement).
- Only annotated conversations get a convo bucket (the caller in T-010 enforces this; this ticket provides the mechanism).

**Acceptance criteria**
- Unit: `mergeTurns` delegates to `GA.core.backup.mergeTurnLists` (spy/identity test) and the delegate handles prepend/append/multiset per T-007's contract; no second interleave implementation exists.
- Round-trip: `gzipToB64` → `b64ToText` returns the original message text (ASCII, empty, unicode, >100 KB — run only where `CompressionStream` is available).
- `loadConvo`/`saveConvo` round-trip via a fake `browser`: a saved `{turns, blobs}` record loads deep-equal with blobs as the SAME compressed strings (the store layer never (de)compresses); unknown session → null.
- `CONVO_PREFIX` present; `src/core/compress.js` in both manifests + `module.exports` shim.
- `npm test` passes; `node build.js` succeeds.

**Depends on** — T-007 (`GA.core.backup.mergeTurnLists`).

### Ticket T-010: [C1] Capture wiring — snapshot transcripts on annotate / visit / stream

> **Status: ✅ DONE** — shipped in commit `5aed60a` on `master`. Verified 2026-07-11: `src/content/convo-capture.js` (`GA.convoCapture`) captures annotated-only via `GA.turns.*`, compresses only new `hash:len` blob keys, zero decompress; order-safe in BOTH scroll directions; merges require a provable anchor (unanchored captures bank blobs); captures serialize through a promise chain; triggers = immediate on create + 1200 ms debounce on restore/settle via reanchorer `ctx.onSettled`. New `tests/content/convo-capture.test.js`; suite 500 pass, both builds OK.

**Goal** — Populate the `ga:convo:*` store (T-009) from the live page for ANNOTATED conversations, reusing the existing turn-discovery machinery, so a transcript accumulates across visits/scrolls despite DOM virtualization.

**Scope**
- In: capture calls in `src/content/thread-controller.js` (`createFromSelection`, `restoreForSession`) and a debounced hook off the existing `src/content/reanchorer.js` MutationObserver.
- Out: the storage/compression layer (T-009); the builder (T-011); export UI (T-012).

**Spec**
- A capture routine builds the turn snapshot from the live DOM using the EXISTING machinery — NO new scraping: `GA.turns.findTurns()` (outermost turns, DOM order, role-tagged), `GA.turns.textOf(el)` (canonical stable text), `GA.turns.fingerprintOf(el)` / `GA.core.turnId.fingerprint` (content hash) → `[{role, text, fp, order}]`.
- PER-MESSAGE, ONLY-NEW compression (zero decompress in capture): `existing = await loadConvo(session)` (RAW record); for each snapshot turn whose blob key `fp.hash + ":" + fp.len` is NOT already in `existing.blobs`, compress its text via `GA.core.compress.gzipToB64` into a new blob; merged index = `mergeTurns(existing.turns, snapshot index)` (T-009's delegate to the shared interleave); `saveConvo` the merged `{turns, blobs}` (existing blobs carried as-is — a turn whose blob key already exists is NEVER re-compressed, and capture NEVER decompresses anything).
- Gate on ANNOTATED-only: capture runs only when the current session has ≥1 thread (`threadController.threads().length`); bail on a null session (pre-id draft chat) — never write a bogus bucket.
- Triggers: (a) on thread create (`createFromSelection`) — IMMEDIATE capture (the annotated turn must never be lost, even if the tab closes seconds later; a mid-stream partial stored here is cleaned at render time by T-011's prefix-dedupe), (b) on visit/restore (`restoreForSession`) — debounced, (c) debounced (after streaming settles) off the EXISTING `reanchorer.js` MutationObserver — do NOT add a new observer.
- Record `title`/`url` from the page (`document.title`, `location.href`) and `capturedAt`.

**Acceptance criteria**
- Unit/DOM: with a fake DOM of turns and ≥1 thread, a capture writes a convo bucket whose plaintext turns index matches `findTurns` and whose blobs map is keyed by each turn's `"<hash>:<len>"`.
- Progressive reveal BOTH directions: after a first capture, (i) turns APPENDED at the end and (ii) older turns PREPENDED by scroll-up each merge correctly — the stored index reflects true conversation order (via the interleave), only the NEW turns' blobs are compressed (spy: `gzipToB64` not called for existing keys), and nothing is lost.
- Zero threads → no-op (no bucket); null session → no-op; rapid trigger calls collapse into one capture (debounce).
- Reuses `GA.turns.*` (no new querySelector scraping introduced); no decompress call anywhere in the capture path.
- `npm test` passes; `node build.js` succeeds.

**Depends on** — T-009.

### Ticket T-011: [C2] Transcript → Markdown builder (pure)

> **Status: ✅ DONE** — shipped in commit `2b3d664` on `master`. Verified 2026-07-11: pure `src/core/transcript.js` `GA.core.transcript.build(convo, threads)` — sorts by order, F3 prefix-dedupes consecutive same-role partials, role-headed sections, fingerprint-placed thread callouts with full Q&A, "Unanchored notes" fallback, HTML/Markdown-structure escaping. 30 specs in `tests/core/transcript.test.js`; suite 530 pass, both builds OK.

**Goal** — Turn a stored conversation + its threads into a NotebookLM/Obsidian-ready Markdown document. Pure and unit-tested; the UI (T-012) wires it.

**Scope**
- In: new pure `src/core/transcript.js` → `GA.core.transcript.build(convo, threads)` returning a Markdown string.
- Out: reading storage / decompression / delivery (T-012); capture (T-010).

**Spec**
- New `src/core/transcript.js` (GA-global, both manifests + `module.exports` shim; PURE — no DOM, no `CompressionStream`). `build(convo, threads)` where `convo` is the DECOMPRESSED record `{title,url,provider,capturedAt,turns:[{role,text,fp,order}]}` (T-012 decompresses each blob before calling) and `threads` is that conversation's thread array.
- PREFIX-DEDUPE of stale partials (fix F3): after sorting turns by `order`, when two CONSECUTIVE same-role turns have normalized texts (`GA.core.turnId.normalize`) where one is a strict prefix of the other, render only the LONGER — a mid-stream capture of a still-streaming answer must not appear next to its completed version. (Regenerated non-prefix answers are a documented limitation, not this ticket's problem.)
- Output: a header (title, provider, date, url — framed as a CAPTURED transcript, never claiming full-conversation fidelity); each turn as `## You` / `## Assistant` + its text; each thread rendered as a blockquote callout inserted after the turn it anchors to — the highlighted quote (`thread.selector.exact`) + the thread's FULL follow-up Q&A (`thread.messages[]`, user + model). Map a thread to its turn by fingerprint/anchor (`GA.core.turnId.sameFingerprint(thread.anchor.turn, turn.fp)`); threads whose turn isn't found go in a trailing "Unanchored notes" section.
- Escape/normalize text so the Markdown is well-formed; never build HTML.

**Acceptance criteria**
- Unit (`tests/core/transcript.test.js`): turns render in order with role headings; a thread appears as a callout after its matching turn with its quote + full Q&A; an unmatched thread lands in "Unanchored notes"; an empty/partial transcript produces a valid document; output is plain Markdown (no HTML injection).
- Prefix-dedupe: consecutive same-role turns where one text is a strict prefix of the other render only the longer; a thread anchored to the DROPPED partial still renders (against the surviving turn or in "Unanchored notes" — never silently lost); non-prefix and different-role neighbors are both kept.
- New file in both manifests + `module.exports` shim.
- `npm test` passes; `node build.js` succeeds.

**Depends on** — T-009 (record shape).

### Ticket T-012: [C2] Panel "Export conversation for NotebookLM" button

> **Status: ✅ DONE** — shipped in commit `214502f` on `master`. Verified 2026-07-11: "Export for NotebookLM" button in the panel header (new download glyph) — the system's SOLE decompress site (verified repo-wide); per-blob `hash:len` inflate with F5 self-heal (delete corrupt entry + save against a re-loaded record), sanitized-filename download + best-effort clipboard, every degradation path → toast. 14 specs in `tests/dom/panel-export.dom.test.js`; suite 544 pass, both builds OK.

**Goal** — In the "Comment threads" panel, a button that exports the CURRENT conversation's transcript + marginalia comments as a Markdown file for NotebookLM. One click, current conversation only (no picker — backup on the options page covers all-conversations).

**Scope**
- In: an export button in the panel header (`src/content/panel.js`) that reads the current session's convo bucket + threads, decompresses, builds Markdown (T-011), and delivers it.
- Out: the gear icon (T-006); the builder (T-011); the storage layer (T-009/T-010).

**Spec**
- Add an "Export for NotebookLM" button to the panel header (`src/content/panel.js`), alongside the gear (T-006) and close button. Icon via `GA.icons.make(...)` (add a "download"/"export" icon if none fits).
- On click — THE SOLE DECOMPRESS SITE in the whole system: load the current session's RAW convo record (`loadConvo(currentSession)` from T-009 — it does NOT decompress); decompress each message blob via `GA.core.compress.b64ToText(blobs[t.fp.hash + ":" + t.fp.len])` per turn into a decoded `{…, turns:[{role,text,fp,order}]}` record; get the conversation's threads (`GA.threadController.threads()`); call `GA.core.transcript.build(decoded, threads)` (T-011); then DELIVER: download as `<title-or-provider>-YYYYMMDD.md` (Blob + temporary `<a download>`, sanitized filename) AND copy to clipboard (`navigator.clipboard.writeText`, best-effort in its OWN catch — a clipboard failure must not undo a successful download). Toast/status on success; a friendly message if there is no captured transcript yet.
- SELF-HEALING (fix F5): a turn whose blob is missing exports as empty text (never throws mid-export); a blob whose `b64ToText` THROWS (corrupt) also renders empty AND — best-effort, own catch — that `blobs["<hash>:<len>"]` entry is DELETED and the record `saveConvo`d, so the next capture re-compresses the message from the live DOM.
- CURRENT conversation only — no conversation picker. No other file in `src/` may call `b64ToText`/`DecompressionStream` (capture, import, backup all stay decompress-free).

**Acceptance criteria**
- DOM test: the panel header renders the export button (closeBtn stays last); clicking it loads the RAW record, decompresses each blob by its `"<hash>:<len>"` key, calls `transcript.build` with the decoded record + threads, and triggers a download (stub the storage load + URL/anchor); handles "no transcript captured yet" gracefully (no download).
- Corrupt/missing blob: export still succeeds with that turn empty; a corrupt blob's entry is removed via `saveConvo` (self-heal); clipboard rejection leaves the download succeeded.
- Never builds innerHTML from thread/transcript text; panel.js is the only non-test caller of `b64ToText`.
- MANUAL smoke test noted for release (fix F6): the .md download works on Gemini, ChatGPT, and Claude (page CSP vs `blob:` URL) — clipboard is the built-in fallback.
- `npm test` passes; `node build.js` succeeds.

**Depends on** — T-009, T-010, T-011.
