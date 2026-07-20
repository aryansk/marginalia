// parser.js — Anthropic Messages API SSE parser. The API streams
// content_block_delta events whose delta.text carries the answer (older shapes
// used a bare `completion` string; we accept both). The two-shape extractor is
// shared with claude/parser.js via shared/sse.js (which loads before both).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.anthropic = GA.anthropic || {};
// Browser: shared/sse.js loaded earlier set GA.sse. Node/tests: require it so
// this module stays importable on its own.
var sse = GA.sse || (typeof require !== "undefined" ? require("../shared/sse.js") : null);

GA.anthropic.parser = (function () {
  return {
    // Test oracle: production streaming goes through makeStream (see
    // background/api-client-factory.js); parseLatest exists so specs can
    // whole-buffer-parse a transcript and hold the two equivalent.
    parseLatest: sse.makeParser(sse.extractDeltaText),
    makeStream: function () {
      return sse.makeStream(sse.extractDeltaText);
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.anthropic.parser;
