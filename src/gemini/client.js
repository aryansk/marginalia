// client.js — WebRpcClient: the web-session strategy implementing the
// GeminiClient interface `{ ask(req, onChunk) -> Promise<string> }`.
//
// Replays gemini.google.com's internal StreamGenerate endpoint using the user's
// logged-in session (cookies attach automatically; we only pass page tokens).
// This file is now just transport + the streaming loop — the wire format lives
// in gemini/payload.js and response parsing in gemini/parser.js, both pure and
// unit-tested. A future ApiKeyClient can implement the same `ask` interface.
//
// ⚠️ REVERSE-ENGINEERED & UNDOCUMENTED. If replies stop coming through, inspect a
// live StreamGenerate request in DevTools and adjust gemini/payload.js (request)
// or gemini/parser.js (response). Everything fragile is isolated in those two.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.client = (function () {
  function parseFailMsg() {
    return "Couldn't parse Gemini's response — the internal API shape may have changed (see gemini/parser.js).";
  }

  async function ask(req, onChunk) {
    const payload = GA.gemini.payload;
    const parser = GA.gemini.parser;
    const tokens = (req && req.tokens) || {};
    if (!tokens.at)
      throw new Error("Missing session token (SNlM0e). Are you logged in to Gemini?");

    const res = await fetch(payload.buildUrl(tokens.bl, tokens.sid), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Same-Domain": "1",
      },
      body: payload.buildBody(req.prompt, tokens.at),
    });
    if (!res.ok) throw new Error("Gemini request failed (HTTP " + res.status + ").");

    // No streaming body available — parse the whole response at once.
    if (!res.body || !res.body.getReader) {
      const text = parser.parseLatest(await res.text());
      if (text == null) throw new Error(parseFailMsg());
      if (onChunk) onChunk(text);
      return text;
    }

    // Stream: re-parse the growing buffer and emit each newly-longer answer.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let last = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const text = parser.parseLatest(buf);
      if (text != null && text !== last) {
        last = text;
        if (onChunk) onChunk(text);
      }
    }
    const finalText = parser.parseLatest(buf) || last;
    if (!finalText) throw new Error(parseFailMsg());
    return finalText;
  }

  return { ask };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.client;
