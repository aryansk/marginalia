# Changelog

Notable changes to Marginalia. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## 0.2.0 — 2026-07-13

The transcript & durability release: annotated conversations are now captured
as full transcripts, exportable for NotebookLM, and every layer of thread
storage got hardened against data loss.

### Added

- **Conversation transcript capture.** Annotated conversations are captured
  into local storage from the live page — accumulated across visits and
  scrolls in both directions, so virtualized message lists still yield the
  whole conversation over time. Message text is gzip-compressed per turn;
  capture runs on annotate, on revisit, and after streaming settles.
- **Export for NotebookLM.** One-click button in the threads panel renders
  the captured transcript plus your annotations to Markdown (NotebookLM- and
  Obsidian-ready), downloads it, and copies it to the clipboard. Annotations
  appear as callouts under the turn they were written on; mid-stream partial
  duplicates are collapsed at render time.
- **Backup export / import.** Options page can export all threads and
  transcripts to a JSON archive and restore it later — additive merge (safe
  union, content-max conflict resolution) or wholesale replace. Restores can
  never touch settings or API keys by construction.
- **Options shortcut.** Gear button in the threads panel opens the options
  page directly.

### Fixed

- **Wedged transcript index (F6).** Annotating while an answer was still
  streaming (or before a turn finished hydrating) indexed the turn under a
  fingerprint that never appeared again, permanently freezing the transcript
  at that first window — the NotebookLM export then contained only the
  annotated turns. Capture now recognizes a stored partial that a live turn
  grew out of and upgrades it in place; exports self-heal older wedged
  records (export once, revisit, export again — the second export is
  complete); annotations anchored to a vanished partial re-home onto the
  completed turn by their quoted text.
- **Draft retention (T-004).** Draft conversations with content are never
  auto-deleted; only provably stale empty drafts are swept.
- **Restore isolation.** One malformed stored thread can no longer abort the
  restore loop and hide every other annotation in the conversation; the bad
  record is skipped and left intact for later migration.

## 0.1.1 — earlier store update

- Anchoring rework: threads pin to their message via turn discovery + content
  fingerprinting; anchors that contradict recorded context are rejected
  instead of guessed. Fixed two dead site adapters (Gemini, Claude).
- Threads panel: keyword search across all threads; focus mode (opening one
  thread collapses the rest); composer-local undo/redo (Ctrl+Z).
- UI polish pass: flat host-matched colors, unified counters, elevation
  system, calmer chips; panel button moved bottom-right; fixed Alt shortcuts
  on macOS. Fixed Firefox anchoring probe and highlight scroll lag.
- Renamed to Marginalia; added privacy policy for store listings.

## 0.1.0 — initial release

- Margin annotations ("threads") on Gemini, ChatGPT, and Claude
  conversations: highlight text in an answer, attach a comment thread, and
  ask a model follow-up questions inside the thread.
- Official-API backends (OpenAI, Google AI, Anthropic) with per-provider
  key + model settings; Gemini/Claude fall back to the logged-in web session
  without a key.
- Firefox and Chrome builds; functional-core/imperative-shell architecture
  with a Vitest suite.
