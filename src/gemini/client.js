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

    // Abort the request if it goes silent (see background/api-util.js); bumped as
    // stream bytes arrive so a slow-but-live reply isn't cut off.
    const budget = GA.makeAbortBudget(GA.REQUEST_TIMEOUT_MS);
    const timeoutMsg = "Gemini request timed out.";
    let res;
    try {
      res = await fetch(payload.buildUrl(tokens.bl, tokens.sid), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "X-Same-Domain": "1",
        },
        body: payload.buildBody(req.prompt, tokens.at),
        signal: budget.signal,
      });
    } catch (e) {
      budget.clear();
      if (budget.aborted() || (e && e.name === "AbortError")) throw new Error(timeoutMsg);
      throw e;
    }
    if (!res.ok) {
      budget.clear();
      throw new Error("Gemini request failed (HTTP " + res.status + ").");
    }

    try {
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
        budget.bump();
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
    } catch (e) {
      if (budget.aborted() || (e && e.name === "AbortError")) throw new Error(timeoutMsg);
      throw e;
    } finally {
      budget.clear();
    }
  }

  return { ask };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.client;
