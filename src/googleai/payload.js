// payload.js — pure request builder for the official Google Generative Language
// API (Gemini). No DOM, no network. Used when a Gemini API key is set (see
// client.js); otherwise the logged-in gemini.google.com web session is used.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.googleai = GA.googleai || {};

GA.googleai.payload = (function () {
  const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

  // SSE streaming endpoint. The API key rides in the `x-goog-api-key` header
  // (see buildRequest), NOT the URL query string, so it can't leak into browser
  // history, proxy logs, or server access logs.
  function buildUrl(model) {
    return BASE + encodeURIComponent(model) + ":streamGenerateContent?alt=sse";
  }

  // `prompt` already carries the full thread context (composed by core/prompt.js).
  function buildBody(prompt) {
    return JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt || "" }] }] });
  }

  // Uniform { url, headers, body } shape consumed by the API-client factory.
  function buildRequest(model, prompt, key) {
    return {
      url: buildUrl(model),
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: buildBody(prompt),
    };
  }

  // Minimal non-streaming request (":generateContent", the sibling of the SSE
  // endpoint above) for the options-page "Test" button. Key stays in the
  // header, never the query string (same rule as buildRequest).
  function buildTestRequest(model, key) {
    return {
      url: BASE + encodeURIComponent(model) + ":generateContent",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    };
  }

  // pageSize=1000 sidesteps pagination (default page is small); nextPageToken
  // handling is deliberately skipped — fine for the options-page dropdown.
  function buildListRequest(key) {
    return {
      url: BASE.replace(/\/$/, "") + "?pageSize=1000",
      headers: { "x-goog-api-key": key },
    };
  }

  // GET /v1beta/models response -> [{id, created}], chat-capable only. The API
  // exposes no release date, so sort by the numeric version in the id
  // (2.5 > 2.0 > 1.5), stable within a version. Anchored to "gemini-<n>" so
  // other generateContent ids (gemma-3-27b-it, gemini-exp-1206) can't parse a
  // bogus "version" and outrank the actual flagships.
  function parseModels(json) {
    const models = (json && Array.isArray(json.models) && json.models) || [];
    const version = (id) => {
      const m = /^gemini-(\d+(?:\.\d+)?)/.exec(id);
      return m ? parseFloat(m[1]) : 0;
    };
    return models
      .filter(
        (m) =>
          m &&
          typeof m.name === "string" &&
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.indexOf("generateContent") !== -1,
      )
      .map((m) => ({ id: m.name.replace(/^models\//, ""), created: null }))
      .sort((a, b) => version(b.id) - version(a.id));
  }

  return {
    BASE,
    buildUrl,
    buildBody,
    buildRequest,
    buildTestRequest,
    buildListRequest,
    parseModels,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.googleai.payload;
