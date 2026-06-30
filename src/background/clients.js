// clients.js — the provider → backend-client registry used by the ask router in
// background.js. Each client implements `ask(req, onChunk) -> Promise<string>`
// (see src/<provider>/client.js). Loaded after all the per-provider clients so
// the globals exist. The content script tags each ask with its `provider`
// (derived from the page host via core/sites.js); the router looks it up here.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.clients = {
  gemini: GA.client,
  chatgpt: GA.chatgptClient,
  claude: GA.claudeClient,
};

GA.clientFor = function (provider) {
  return (provider && GA.clients[provider]) || GA.client;
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.clients;
