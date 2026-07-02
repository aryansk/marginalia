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

GA.claude.parser = (function () {
  function fragmentText(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (typeof obj.completion === "string") return obj.completion;
    if (obj.delta && typeof obj.delta.text === "string") return obj.delta.text;
    return null;
  }

  function parseLatest(raw) {
    let text = "";
    let sawAny = false;
    const lines = String(raw == null ? "" : raw).split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (t.indexOf("data:") !== 0) continue; // ignore `event:` / blank lines
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch (e) {
        continue;
      }
      const frag = fragmentText(obj);
      if (frag != null) {
        text += frag;
        sawAny = true;
      }
    }
    return sawAny ? text : null;
  }

  return { parseLatest };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.claude.parser;
