// parser.js — Anthropic Messages API SSE parser. The API streams
// content_block_delta events whose delta.text carries the answer (older shapes
// used a bare `completion` string; we accept both). This used to piggy-back on
// claude/parser.js, which coupled anthropic to that file's load order; it now has
// its own extractor over the shared SSE scaffolding (shared/sse.js).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.anthropic = GA.anthropic || {};
// Browser: shared/sse.js loaded earlier set GA.sse. Node/tests: require it so
// this module stays importable on its own.
var sse = GA.sse || (typeof require !== "undefined" ? require("../shared/sse.js") : null);

GA.anthropic.parser = (function () {
  function extract(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.delta && typeof obj.delta.text === "string") return obj.delta.text;
    if (typeof obj.completion === "string") return obj.completion;
    return null;
  }
  return { parseLatest: sse.makeParser(extract) };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.anthropic.parser;
