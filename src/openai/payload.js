// payload.js — pure request builder for the official OpenAI Chat Completions API.
// No DOM, no network. Used when an OpenAI API key is set (see client.js); the
// reverse-engineered chatgpt.com web client was removed (Cloudflare Turnstile).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.openai = GA.openai || {};

GA.openai.payload = (function () {
  const ENDPOINT = "https://api.openai.com/v1/chat/completions";

  // `prompt` already carries the full thread context (composed by core/prompt.js).
  function buildBody(model, prompt) {
    return JSON.stringify({
      model: model,
      messages: [{ role: "user", content: prompt || "" }],
      stream: true,
    });
  }

  // Uniform { url, headers, body } shape consumed by the API-client factory.
  function buildRequest(model, prompt, key) {
    return {
      url: ENDPOINT,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: buildBody(model, prompt),
    };
  }

  return { ENDPOINT, buildBody, buildRequest };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.openai.payload;
