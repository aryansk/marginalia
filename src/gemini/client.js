// client.js — Gemini web RPC client (runs in the background script).
//
// Replays gemini.google.com's internal StreamGenerate endpoint using the user's
// logged-in session. The background fetch is cross-origin to the extension but
// targets a host we hold permission for, so the session cookies are attached
// automatically (credentials: 'include'). We only need the page tokens.
//
// ⚠️ REVERSE-ENGINEERED & UNDOCUMENTED. The f.req payload shape and the response
// parsing path can change without notice. If replies stop coming through:
//   1. Open DevTools > Network on gemini.google.com, send a normal message.
//   2. Inspect the StreamGenerate request's `f.req` form field and the response.
//   3. Adjust buildBody() / extractText() below to match. Everything fragile is
//      isolated in this file on purpose.
var GA = GA || {};

GA.client = (function () {
  const ENDPOINT =
    "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
  let reqid = Math.floor(Math.random() * 900000) + 100000;

  function buildBody(prompt, at) {
    // Minimal known-good shape. New side-conversation each time (empty triplet),
    // with the full thread context already baked into `prompt` by the caller.
    const messageStruct = [[prompt], null, [null, null, null]];
    const freq = JSON.stringify([null, JSON.stringify(messageStruct)]);
    const params = new URLSearchParams();
    params.set("f.req", freq);
    params.set("at", at);
    return params.toString();
  }

  function buildUrl(bl, sid) {
    const u = new URL(ENDPOINT);
    if (bl) u.searchParams.set("bl", bl);
    if (sid) u.searchParams.set("f.sid", sid);
    u.searchParams.set("hl", "en");
    u.searchParams.set("_reqid", String((reqid += 100000)));
    u.searchParams.set("rt", "c");
    return u.toString();
  }

  // Parse the latest model text from accumulated batchexecute output.
  function parseLatest(raw) {
    let text = null;
    const lines = raw.split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (t.indexOf('[["wrb.fr"') !== 0) continue;
      let outer;
      try {
        outer = JSON.parse(t);
      } catch (e) {
        continue;
      }
      for (const item of outer) {
        if (!Array.isArray(item) || item[0] !== "wrb.fr" || !item[2]) continue;
        let body;
        try {
          body = JSON.parse(item[2]);
        } catch (e) {
          continue;
        }
        const got = extractText(body);
        if (got != null) text = got;
      }
    }
    return text;
  }

  function extractText(body) {
    try {
      if (body[4] && body[4][0] && body[4][0][1] && body[4][0][1][0] != null)
        return body[4][0][1][0];
    } catch (e) {}
    return deepFindText(body, 0);
  }

  function deepFindText(node, depth) {
    if (depth > 9) return null;
    if (typeof node === "string") return node.length > 1 ? node : null;
    if (Array.isArray(node)) {
      for (const c of node) {
        const r = deepFindText(c, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  async function ask(req, onChunk) {
    const tokens = req.tokens || {};
    if (!tokens.at)
      throw new Error("Missing session token (SNlM0e). Are you logged in to Gemini?");

    const res = await fetch(buildUrl(tokens.bl, tokens.sid), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Same-Domain": "1",
      },
      body: buildBody(req.prompt, tokens.at),
    });
    if (!res.ok) throw new Error("Gemini request failed (HTTP " + res.status + ").");

    if (!res.body || !res.body.getReader) {
      const txt = await res.text();
      const text = parseLatest(txt);
      if (text == null) throw new Error(parseFailMsg());
      onChunk && onChunk(text);
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
      const text = parseLatest(buf);
      if (text != null && text !== last) {
        last = text;
        onChunk && onChunk(text);
      }
    }
    const finalText = parseLatest(buf) || last;
    if (!finalText) throw new Error(parseFailMsg());
    return finalText;
  }

  function parseFailMsg() {
    return "Couldn't parse Gemini's response — the internal API shape may have changed (see client.js).";
  }

  return { ask, parseLatest, buildBody, buildUrl };
})();
