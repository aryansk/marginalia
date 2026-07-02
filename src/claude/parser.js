// parser.js — pure parser for Claude's .../completion SSE stream. Given the
// accumulated response text, return the assistant answer (or null).
//
// claude.ai streams Server-Sent Events; the text arrives as a sequence of
// deltas that we concatenate in order. Two shapes appear across versions:
//   1. { "type":"completion", "completion":"…" }              (legacy)
//   2. { "type":"content_block_delta", "delta":{"text":"…"} } (messages API style)
// We append every text fragment we recognize. All fragility lives here; see
// payload.js for the request side.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.claude = GA.claude || {};
// Browser: shared/sse.js loaded earlier set GA.sse. Node/tests: require it so
// this module stays importable on its own.
var sse = GA.sse || (typeof require !== "undefined" ? require("../shared/sse.js") : null);

GA.claude.parser = (function () {
  function fragmentText(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (typeof obj.completion === "string") return obj.completion;
    if (obj.delta && typeof obj.delta.text === "string") return obj.delta.text;
    return null;
  }

  return {
    parseLatest: sse.makeParser(fragmentText),
    makeStream: function () {
      return sse.makeStream(fragmentText);
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.claude.parser;
