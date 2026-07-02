// stream-delta.js — pure helper for the chunk protocol between background and
// content. Clients produce the FULL answer-so-far on every chunk; posting that
// over the port re-serializes the whole string each time (O(n²) over a long
// answer). The background instead sends only what changed:
//   next(prev, full) -> { delta }          full extends prev (the normal case)
//                     | { reset, text }    full rewrote earlier text (Gemini
//                                          revision frames) — send it whole
//                     | null               nothing new
// The content side (ask-service.js) reassembles: acc += delta, or acc = text.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.streamDelta = (function () {
  function next(prev, full) {
    prev = prev == null ? "" : String(prev);
    full = full == null ? "" : String(full);
    if (full === prev) return null;
    if (prev && full.lastIndexOf(prev, 0) === 0) return { delta: full.slice(prev.length) };
    if (!prev) return { delta: full };
    return { reset: true, text: full };
  }

  return { next };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.streamDelta;
