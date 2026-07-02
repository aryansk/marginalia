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

  return { BASE, buildUrl, buildBody, buildRequest };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.googleai.payload;
