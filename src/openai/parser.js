// parser.js — OpenAI Chat Completions SSE parser. The `data:`/`[DONE]`/JSON
// scaffolding lives in shared/sse.js; here we only pull the text fragment out of
// each event (choices[0].delta.content). Given the accumulated response text,
// parseLatest returns the assistant answer so far, or null.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.openai = GA.openai || {};
// Browser: shared/sse.js loaded earlier set GA.sse. Node/tests: require it so
// this module stays importable on its own.
var sse = GA.sse || (typeof require !== "undefined" ? require("../shared/sse.js") : null);

GA.openai.parser = (function () {
  function extract(obj) {
    const delta = obj && obj.choices && obj.choices[0] && obj.choices[0].delta;
    return delta && typeof delta.content === "string" ? delta.content : null;
  }
  return {
    // Test oracle: production streaming goes through makeStream (openai/client.js
    // via the api-client factory); parseLatest exists so specs can whole-buffer-
    // parse a transcript and hold the two equivalent.
    parseLatest: sse.makeParser(extract),
    makeStream: function () {
      return sse.makeStream(extract);
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.openai.parser;
