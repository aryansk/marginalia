// client.js — ChatGPT web-session strategy implementing the shared client
// interface `{ ask(req, onChunk) -> Promise<string> }`. Replays chatgpt.com's
// private backend using the user's logged-in cookies (no API key).
//
// Auth dance: (1) GET /api/auth/session for a Bearer access token, (2) POST
// /backend-api/sentinel/chat-requirements for the per-request sentinel token,
// (3) POST /backend-api/conversation and stream the SSE reply.
//
// ⚠️ REVERSE-ENGINEERED. Cookie/CSRF/proof-of-work behavior changes often; if the
// stream stops, inspect a live request in DevTools. Everything fragile is here +
// in payload.js (request) and parser.js (response).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.chatgptClient = (function () {
  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function userAgent() {
    return (typeof navigator !== "undefined" && navigator.userAgent) || "Mozilla/5.0";
  }

  async function getAccessToken() {
    const res = await fetch(GA.chatgpt.payload.AUTH_URL, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("Couldn't reach ChatGPT (HTTP " + res.status + "). Are you logged in?");
    const json = await res.json().catch(() => ({}));
    if (!json || !json.accessToken)
      throw new Error("Couldn't read your ChatGPT session. Are you logged in to chatgpt.com?");
    return json.accessToken;
  }

  // The Sentinel requirements call issues the per-request token + the proof-of-work
  // challenge. It wants its own (cheap) proof in the body. We surface failures so a
  // bad/changed challenge shows a clear message instead of an opaque downstream 403.
  async function getRequirements(accessToken, deviceId) {
    const P = GA.chatgpt.payload;
    const prelim = P.buildProofToken("requirements", "0", userAgent());
    const res = await fetch(P.REQUIREMENTS_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
        "oai-language": "en-US",
        "oai-device-id": deviceId,
      },
      body: P.buildRequirementsBody(prelim),
    });
    if (!res.ok)
      throw new Error("ChatGPT anti-bot check failed (HTTP " + res.status + "). Try sending a message on chatgpt.com first.");
    return (await res.json().catch(() => ({}))) || {};
  }

  async function ask(req, onChunk) {
    const P = GA.chatgpt.payload;
    const parser = GA.chatgpt.parser;
    const prompt = (req && req.prompt) || "";
    const ua = userAgent();

    const accessToken = await getAccessToken();
    const deviceId = uuid();
    const reqs = await getRequirements(accessToken, deviceId);

    // Challenges we can't solve headlessly — fail with a clear, actionable message.
    if (reqs.arkose && reqs.arkose.required)
      throw new Error("ChatGPT requires an Arkose challenge this extension can't solve. Send one message on chatgpt.com, then retry.");
    if (reqs.turnstile && reqs.turnstile.required)
      throw new Error("ChatGPT requires a Turnstile challenge this extension can't solve.");

    const headers = {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "oai-language": "en-US",
      "oai-device-id": deviceId,
    };
    if (reqs.token) headers["OpenAI-Sentinel-Chat-Requirements-Token"] = reqs.token;
    if (reqs.proofofwork && reqs.proofofwork.required) {
      headers["OpenAI-Sentinel-Proof-Token"] = P.buildProofToken(
        reqs.proofofwork.seed,
        reqs.proofofwork.difficulty,
        ua
      );
    }

    const res = await fetch(P.CONVERSATION_URL, {
      method: "POST",
      credentials: "include",
      headers: headers,
      body: P.buildConversationBody({
        prompt: prompt,
        messageId: uuid(),
        parentId: uuid(),
        model: "auto",
      }),
    });
    if (res.status === 403)
      throw new Error("ChatGPT blocked the request (403) — its proof-of-work/Arkose checks may have changed. Send a message on chatgpt.com, then compare its Network request against src/chatgpt/.");
    if (!res.ok) throw new Error("ChatGPT request failed (HTTP " + res.status + ").");

    const failMsg = "Couldn't parse ChatGPT's response — the internal API shape may have changed.";

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
  }

  return { ask };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.chatgptClient;
