// parser.js — pure parser for Claude's .../completion SSE stream. Given the
// accumulated response text, return the assistant answer (or null).
//
// claude.ai streams Server-Sent Events; the text arrives as a sequence of
// deltas that we concatenate in order. Two shapes appear across versions:
//   1. { "type":"completion", "completion":"…" }              (legacy)
//   2. { "type":"content_block_delta", "delta":{"text":"…"} } (messages API style)
// Both shapes are recognized by the shared extractor in shared/sse.js
// (also used by anthropic/parser.js — the official API streams the same two);
// see payload.js for the request side.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.claude = GA.claude || {};
// Browser: shared/sse.js loaded earlier set GA.sse. Node/tests: require it so
// this module stays importable on its own.
var sse = GA.sse || (typeof require !== "undefined" ? require("../shared/sse.js") : null);

GA.claude.parser = (function () {
  return {
    // Test oracle: production streaming goes through makeStream (claude/client.js);
    // parseLatest exists so specs can whole-buffer-parse a transcript and hold
    // the two equivalent.
    parseLatest: sse.makeParser(sse.extractDeltaText),
    makeStream: function () {
      return sse.makeStream(sse.extractDeltaText);
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.claude.parser;
