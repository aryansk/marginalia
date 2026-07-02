// client.js — Claude web-session strategy implementing the shared client
// interface `{ ask(req, onChunk) -> Promise<string> }`. Replays claude.ai's
// private backend using the user's logged-in cookies (no API key).
//
// Setup: (1) GET /api/organizations to find the org id, (2) POST a fresh
// chat_conversation, (3) POST .../completion and stream the SSE reply.
//
// ⚠️ REVERSE-ENGINEERED. Cookie/CSRF behavior changes often; if the stream stops,
// inspect a live request in DevTools. Everything fragile is here + in payload.js
// (request) and parser.js (response).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.claudeClient = (function () {
  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  async function getOrgId(signal) {
    const res = await fetch(GA.claude.payload.ORGS_URL, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: signal,
    });
    if (!res.ok) throw new Error("Couldn't reach Claude (HTTP " + res.status + "). Are you logged in?");
    const orgs = await res.json().catch(() => null);
    const org = GA.claude.payload.pickOrgId(orgs);
    if (!org) throw new Error("Couldn't read your Claude account. Are you logged in to claude.ai?");
    return org;
  }

  async function createConversation(orgId, signal) {
    const convUuid = uuid();
    const res = await fetch(GA.claude.payload.conversationsUrl(orgId), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: GA.claude.payload.buildConversationBody(convUuid),
      signal: signal,
    });
    if (!res.ok) throw new Error("Couldn't start a Claude conversation (HTTP " + res.status + ").");
    const json = await res.json().catch(() => null);
    return (json && json.uuid) || convUuid;
  }

  async function ask(req, onChunk) {
    const P = GA.claude.payload;
    const parser = GA.claude.parser;
    const prompt = (req && req.prompt) || "";

    // One abort budget covers the whole flow (org lookup -> conversation ->
    // completion). It aborts if any step goes silent (see api-util.js); bumped
    // after each step and as stream bytes arrive so a live reply isn't cut off.
    const budget = GA.makeAbortBudget(GA.REQUEST_TIMEOUT_MS);
    const timeoutMsg = "Claude request timed out.";
    const failMsg = "Couldn't parse Claude's response — the internal API shape may have changed.";
    try {
      const orgId = await getOrgId(budget.signal);
      budget.bump();
      const convId = await createConversation(orgId, budget.signal);
      budget.bump();

      const res = await fetch(P.completionUrl(orgId, convId), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: P.buildCompletionBody({ prompt: prompt, parentUuid: P.ROOT_PARENT_UUID }),
        signal: budget.signal,
      });
      if (!res.ok) throw new Error("Claude request failed (HTTP " + res.status + ").");

      if (!res.body || !res.body.getReader) {
        const text = parser.parseLatest(await res.text());
        if (text == null) throw new Error(failMsg);
        if (onChunk) onChunk(text);
        return text;
      }

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
      if (!finalText) throw new Error(failMsg);
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

if (typeof module !== "undefined" && module.exports) module.exports = GA.claudeClient;
