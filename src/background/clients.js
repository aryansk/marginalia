// clients.js — picks the backend client for an ask from background/registry.js.
// Each client implements `ask(req, onChunk) -> Promise<string>` (see
// src/<provider>/client.js). The content script tags each ask with its
// `provider` (from the page host via core/sites.js); here we use that provider's
// official-API client when its API key is set in settings, otherwise its
// logged-in web-session client (falling back to Gemini web for anything
// unrecognized).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.clientFor = function (provider, settings) {
  const s = settings || {};
  const p = GA.PROVIDERS && GA.PROVIDERS[provider];
  if (!p) return GA.client; // unknown provider -> Gemini web session
  const useApi = p.apiKeyField && s[p.apiKeyField];
  const name = useApi ? p.apiClient : p.webClient || p.apiClient;
  return GA[name];
};

if (typeof module !== "undefined" && module.exports) module.exports = { clientFor: GA.clientFor };
