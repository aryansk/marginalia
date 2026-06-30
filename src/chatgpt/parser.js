// parser.js — pure parser for ChatGPT's /backend-api/conversation SSE stream.
// Given the accumulated response text, return the assistant answer (or null).
//
// ChatGPT emits Server-Sent Events as `data: {json}` lines terminated by
// `data: [DONE]`. Two shapes appear, sometimes mixed within one stream:
//   1. Snapshot: an event carrying the whole message so far at
//      message.content.parts[0] (also wrapped under `v` in the first event).
//   2. Delta:    JSON-patch-style ops { "o":"append", "p":".../parts/0", "v":"…" }
//      that append text to the part patched by the most recent `p`.
// We replay events in order — snapshots replace, deltas append — which yields the
// final text for either shape. All fragility lives here; see payload.js for the
// request side.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.chatgpt = GA.chatgpt || {};

GA.chatgpt.parser = (function () {
  const PARTS_PATH = /\/message\/content\/parts\/0$/;

  // If `obj` is (or wraps) an assistant-message snapshot, return parts[0] string.
  function snapshotText(obj) {
    const msg = obj && (obj.message || (obj.v && obj.v.message));
    const parts = msg && msg.content && msg.content.parts;
    if (parts && typeof parts[0] === "string") return parts[0];
    return null;
  }

  function parseLatest(raw) {
    let text = "";
    let sawAny = false;
    let lastPath = null;
    const lines = String(raw == null ? "" : raw).split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (t.indexOf("data:") !== 0) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch (e) {
        continue;
      }

      const snap = snapshotText(obj);
      if (snap != null) {
        text = snap; // snapshot replaces
        sawAny = true;
        lastPath = "/message/content/parts/0";
        continue;
      }

      // delta op: append to the text part (tracking the patched path)
      if (obj && obj.o === "append") {
        if (typeof obj.p === "string") lastPath = obj.p;
        const path = typeof obj.p === "string" ? obj.p : lastPath;
        if (typeof obj.v === "string" && path && PARTS_PATH.test(path)) {
          text += obj.v;
          sawAny = true;
        }
      }
    }
    return sawAny ? text : null;
  }

  return { parseLatest, snapshotText };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.chatgpt.parser;
