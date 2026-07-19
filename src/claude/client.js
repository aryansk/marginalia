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

  // The org id is stable for a login session — cache it so follow-ups skip the
  // extra round-trip. Cleared when any step gets an auth error (relogin etc.).
  let cachedOrgId = null;

  function httpError(message, status) {
    const e = new Error(message);
    e.status = status;
    return e;
  }

  async function getOrgId(signal) {
    if (cachedOrgId) return cachedOrgId;
    const res = await fetch(GA.claude.payload.ORGS_URL, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: signal,
    });
    if (!res.ok)
      throw httpError(
        "Couldn't reach Claude (HTTP " + res.status + "). Are you logged in?",
        res.status,
      );
    const orgs = await res.json().catch(() => null);
    const org = GA.claude.payload.pickOrgId(orgs);
    if (!org) throw new Error("Couldn't read your Claude account. Are you logged in to claude.ai?");
    cachedOrgId = org;
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
    if (!res.ok)
      throw httpError(
        "Couldn't start a Claude conversation (HTTP " + res.status + ").",
        res.status,
      );
    const json = await res.json().catch(() => null);
    return (json && json.uuid) || convUuid;
  }

  async function ask(req, onChunk) {
    const P = GA.claude.payload;
    const parser = GA.claude.parser;
    const prompt = (req && req.prompt) || "";

    // One abort budget covers the whole flow (org lookup -> conversation ->
    // completion). It aborts if any step goes silent (see api-util.js) or when
    // the caller cancels via req.signal; bumped after each step and as stream
    // bytes arrive so a live reply isn't cut off.
    const budget = GA.makeAbortBudget(GA.REQUEST_TIMEOUT_MS, req && req.signal);
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
      if (!res.ok) throw httpError("Claude request failed (HTTP " + res.status + ").", res.status);

      // Shared incremental read-loop (background/api-util.js): only new
      // complete SSE lines are parsed per chunk.
      return await GA.streamText(res, parser.makeStream(), onChunk, failMsg, budget);
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) cachedOrgId = null;
      throw GA.mapBudgetError(e, budget, timeoutMsg);
    } finally {
      budget.clear();
    }
  }

  return { ask };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.claudeClient;
