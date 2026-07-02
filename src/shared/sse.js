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

// Incremental cursor over the same grammar: feed decoded chunks as they arrive
// and only NEW complete lines are parsed (the whole-buffer parseLatest above
// re-scans everything per chunk — O(n²) over a long answer). `push(chunk)`
// returns the answer so far (or null); `end()` flushes a trailing line without
// a final newline and returns the final answer (or null). Output is identical
// to parseLatest over the concatenated input — tests/shared/sse-stream.test.js
// holds the two equivalent.
GA.sse.makeStream = function (extract) {
  let tail = ""; // undelivered partial line
  let acc = "";
  let sawAny = false;

  function takeLine(line) {
    const t = line.trim();
    if (t.indexOf("data:") !== 0) return;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch (e) {
      return;
    }
    const frag = extract(obj);
    if (typeof frag === "string") {
      acc += frag;
      sawAny = true;
    }
  }

  return {
    push(chunk) {
      tail += String(chunk == null ? "" : chunk);
      const lines = tail.split("\n");
      tail = lines.pop(); // keep the incomplete remainder for the next push
      for (const line of lines) takeLine(line);
      return sawAny ? acc : null;
    },
    end() {
      if (tail) {
        takeLine(tail);
        tail = "";
      }
      return sawAny ? acc : null;
    },
  };
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.sse;
