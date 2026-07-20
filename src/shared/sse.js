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

GA.sse = (function () {
  // The ONE data-line grammar step, shared by makeParser and makeStream (they
  // used to implement it twice; the stream tests hold them equivalent). Parse
  // `line`; when it is a well-formed `data: {json}` event whose extract()
  // yields a string fragment, hand the fragment to `emit`. Everything else
  // (`event:` lines, comments, blanks, [DONE], malformed JSON) is ignored.
  function takeDataLine(line, extract, emit) {
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
    if (typeof frag === "string") emit(frag);
  }

  function makeParser(extract) {
    return function parseLatest(raw) {
      let text = "";
      let sawAny = false;
      for (const line of String(raw == null ? "" : raw).split("\n")) {
        takeDataLine(line, extract, (frag) => {
          text += frag;
          sawAny = true;
        });
      }
      return sawAny ? text : null;
    };
  }

  // Incremental cursor over the same grammar: feed decoded chunks as they arrive
  // and only NEW complete lines are parsed (the whole-buffer parseLatest above
  // re-scans everything per chunk — O(n²) over a long answer). `push(chunk)`
  // returns the answer so far (or null); `end()` flushes a trailing line without
  // a final newline and returns the final answer (or null). Output is identical
  // to parseLatest over the concatenated input — tests/shared/sse-stream.test.js
  // holds the two equivalent.
  function makeStream(extract) {
    let tail = ""; // undelivered partial line
    let acc = "";
    let sawAny = false;

    function emit(frag) {
      acc += frag;
      sawAny = true;
    }

    return {
      push(chunk) {
        tail += String(chunk == null ? "" : chunk);
        const lines = tail.split("\n");
        tail = lines.pop(); // keep the incomplete remainder for the next push
        for (const line of lines) takeDataLine(line, extract, emit);
        return sawAny ? acc : null;
      },
      end() {
        if (tail) {
          takeDataLine(tail, extract, emit);
          tail = "";
        }
        return sawAny ? acc : null;
      },
    };
  }

  // Delta-text extractor shared by the two Claude-flavored parsers
  // (claude/parser.js for the claude.ai web stream, anthropic/parser.js for the
  // official Messages API): both streams carry either
  //   { "delta": { "text": "…" } }   (messages-API content_block_delta)
  //   { "completion": "…" }          (legacy bare completion)
  // It lives HERE because sse.js loads before both parsers in every script
  // list (the wiring test enforces it), so sharing costs no load-order coupling.
  function extractDeltaText(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.delta && typeof obj.delta.text === "string") return obj.delta.text;
    if (typeof obj.completion === "string") return obj.completion;
    return null;
  }

  return { makeParser, makeStream, extractDeltaText };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.sse;
