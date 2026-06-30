// payload.js — pure request builders + endpoint URLs for ChatGPT's private web
// backend (chatgpt.com/backend-api). No DOM, no network, so the wire format is
// unit-testable. The transport + auth dance lives in client.js.
//
// ⚠️ REVERSE-ENGINEERED & UNDOCUMENTED. If replies stop, inspect a live
// /backend-api/conversation request in DevTools and adjust this file (request)
// or parser.js (SSE response).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.chatgpt = GA.chatgpt || {};

GA.chatgpt.payload = (function () {
  const ORIGIN = "https://chatgpt.com";
  const AUTH_URL = ORIGIN + "/api/auth/session"; // -> { accessToken }
  const REQUIREMENTS_URL = ORIGIN + "/backend-api/sentinel/chat-requirements";
  const CONVERSATION_URL = ORIGIN + "/backend-api/conversation"; // SSE

  // The minimal known-good "next" turn. `prompt` already carries the full thread
  // context (composed by core/prompt.js); we send it as a fresh user message and
  // let the server pick the default model ("auto").
  function buildConversationBody(opts) {
    const o = opts || {};
    const body = {
      action: "next",
      messages: [
        {
          id: o.messageId,
          author: { role: "user" },
          content: { content_type: "text", parts: [o.prompt || ""] },
          metadata: {},
        },
      ],
      parent_message_id: o.parentId,
      model: o.model || "auto",
      timezone_offset_min: o.tzOffsetMin == null ? 0 : o.tzOffsetMin,
      history_and_training_disabled: false,
      conversation_mode: { kind: "primary_assistant" },
      force_paragen: false,
      force_rate_limit: false,
    };
    return JSON.stringify(body);
  }

  function buildRequirementsBody(proofToken) {
    return JSON.stringify({ p: proofToken || "" });
  }

  // ---- Sentinel proof-of-work ----
  // ChatGPT gates /backend-api/conversation behind a proof-of-work: find a config
  // whose SHA3-512(seed + base64(config)) has a prefix <= the server's difficulty,
  // and send "gAAAAAB" + that base64 as the proof token. The server checks the
  // hash + format; the exact config fields aren't strictly validated, so we keep a
  // stable, minimal shape. ⚠️ If 403s persist, this shape is the thing to re-tune.
  const POW_PREFIX = "gAAAAAB";
  const POW_FALLBACK_PREFIX = "gAAAAABwQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D";

  function b64(str) {
    if (typeof btoa === "function") {
      const bytes = new TextEncoder().encode(str);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    return Buffer.from(str, "utf8").toString("base64");
  }

  // opts: { now, core, screen, maxIter } — injected for deterministic tests.
  function buildProofToken(seed, difficulty, userAgent, opts) {
    opts = opts || {};
    const cores = [8, 12, 16, 24];
    const screens = [3000, 4000, 6000];
    const core = opts.core != null ? opts.core : cores[(Math.random() * cores.length) | 0];
    const screen = opts.screen != null ? opts.screen : screens[(Math.random() * screens.length) | 0];
    const now = opts.now || new Date().toString();
    const maxIter = opts.maxIter || 500000;
    const diff = String(difficulty || "");
    const config = [
      core + screen, now, 4294705152, 0, userAgent || "",
      "", "en-US", "en-US,en", 0, "", "", "",
    ];
    for (let i = 0; i < maxIter; i++) {
      config[3] = i;
      const base = b64(JSON.stringify(config));
      const hash = GA.chatgpt.sha3.sha3_512(String(seed || "") + base);
      if (hash.substring(0, diff.length) <= diff) return POW_PREFIX + base;
    }
    return POW_FALLBACK_PREFIX + b64('"' + String(seed || "") + '"');
  }

  return {
    ORIGIN,
    AUTH_URL,
    REQUIREMENTS_URL,
    CONVERSATION_URL,
    buildConversationBody,
    buildRequirementsBody,
    buildProofToken,
    b64,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.chatgpt.payload;
