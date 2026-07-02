// payload.js — pure request builder for the official Anthropic Messages API
// (Claude). No DOM, no network. Used when an Anthropic API key is set (see
// client.js); otherwise the logged-in claude.ai web session is used.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.anthropic = GA.anthropic || {};

GA.anthropic.payload = (function () {
  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const VERSION = "2023-06-01"; // anthropic-version header

  // `prompt` already carries the full thread context (composed by core/prompt.js).
  function buildBody(model, prompt, maxTokens) {
    return JSON.stringify({
      model: model,
      max_tokens: maxTokens || 4096,
      messages: [{ role: "user", content: prompt || "" }],
      stream: true,
    });
  }

  // Uniform { url, headers, body } shape consumed by the API-client factory.
  function buildRequest(model, prompt, key) {
    return {
      url: ENDPOINT,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": VERSION,
        // Allow the request from a non-anthropic origin (the extension background).
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: buildBody(model, prompt),
    };
  }

  return { ENDPOINT, VERSION, buildBody, buildRequest };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.anthropic.payload;
