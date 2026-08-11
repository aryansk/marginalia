// payload.js — pure request builder for the official Anthropic Messages API
// (Claude). No DOM, no network. Used when an Anthropic API key is set (see
// client.js); otherwise the logged-in claude.ai web session is used.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.anthropic = GA.anthropic || {};

GA.anthropic.payload = (function () {
  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const VERSION = "2023-06-01"; // anthropic-version header

  // `prompt` already carries the full thread context (composed by core/prompt.js).
  function buildBody(model, prompt) {
    return JSON.stringify({
      model: model,
      // Fixed cap: no user-facing setting exists for this yet. Plenty for a
      // focused follow-up answer; make it a setting if that ever changes.
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt || "" }],
      stream: true,
    });
  }

  function headers(key) {
    return {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": VERSION,
      // Allow the request from a non-anthropic origin (the extension background).
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }

  // Uniform { url, headers, body } shape consumed by the API-client factory.
  function buildRequest(model, prompt, key) {
    return {
      url: ENDPOINT,
      headers: headers(key),
      body: buildBody(model, prompt),
    };
  }

  const LIST_ENDPOINT = "https://api.anthropic.com/v1/models";

  // Minimal non-streaming request for the options-page "Test" button.
  function buildTestRequest(model, key) {
    return {
      url: ENDPOINT,
      headers: headers(key),
      body: JSON.stringify({
        model: model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    };
  }

  // limit=1000 sidesteps pagination (default page is small); has_more handling
  // is deliberately skipped — fine for the options-page dropdown.
  function buildListRequest(key) {
    return {
      url: LIST_ENDPOINT + "?limit=1000",
      headers: headers(key),
    };
  }

  // GET /v1/models response -> [{id, created}], newest first. Every listed
  // Anthropic model is a chat model, so no capability filter.
  function parseModels(json) {
    const data = (json && Array.isArray(json.data) && json.data) || [];
    return data
      .filter((m) => m && typeof m.id === "string")
      .map((m) => {
        const t = m.created_at ? Date.parse(m.created_at) : NaN;
        return { id: m.id, created: isNaN(t) ? null : t };
      })
      .sort((a, b) => (b.created || 0) - (a.created || 0));
  }

  return {
    ENDPOINT,
    LIST_ENDPOINT,
    VERSION,
    buildBody,
    buildRequest,
    buildTestRequest,
    buildListRequest,
    parseModels,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.anthropic.payload;
