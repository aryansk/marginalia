// parser.js — Google Generative Language API SSE parser (alt=sse). The
// `data:`/`[DONE]`/JSON scaffolding lives in shared/sse.js; here we only pull the
// text out of each event (candidates[0].content.parts[].text, joined). Given the
// accumulated response text, parseLatest returns the answer so far, or null.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.googleai = GA.googleai || {};
// Browser: shared/sse.js loaded earlier set GA.sse. Node/tests: require it so
// this module stays importable on its own.
var sse = GA.sse || (typeof require !== "undefined" ? require("../shared/sse.js") : null);

GA.googleai.parser = (function () {
  function extract(obj) {
    const cand = obj && obj.candidates && obj.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    if (!Array.isArray(parts)) return null;
    let s = "";
    let found = false;
    for (const p of parts) {
      if (p && typeof p.text === "string") {
        s += p.text;
        found = true;
      }
    }
    return found ? s : null;
  }
  return {
    parseLatest: sse.makeParser(extract),
    makeStream: function () {
      return sse.makeStream(extract);
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.googleai.parser;
