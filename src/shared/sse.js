// sse.js — factory for the official-API SSE parsers (OpenAI, Google AI,
// Anthropic). They all read `data: {json}` lines terminated by `data: [DONE]`
// and concatenate text fragments in order; only how the text is pulled out of
// each event differs. Keeping that protocol scaffolding here means a change to it
// (blank/comment lines, [DONE] handling, malformed JSON) is made in one place.
//
// Pass `extract(obj)` returning the event's text fragment as a string (possibly
// empty) or null/undefined when the event carries no text. The frame-based
// gemini web parser is a different format and stays separate (gemini/parser.js).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.sse = GA.sse || {};

GA.sse.makeParser = function (extract) {
  return function parseLatest(raw) {
    let text = "";
    let sawAny = false;
    const lines = String(raw == null ? "" : raw).split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (t.indexOf("data:") !== 0) continue; // ignore `event:` / comments / blanks
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch (e) {
        continue;
      }
      const frag = extract(obj);
      if (typeof frag === "string") {
        text += frag;
        sawAny = true;
      }
    }
    return sawAny ? text : null;
  };
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.sse;
