// client.js — Anthropic Messages API strategy implementing the shared client
// interface `{ ask(req, onChunk) -> Promise<string> }`. Used for provider
// "claude" when an Anthropic API key is set; otherwise the logged-in claude.ai
// web session client is used. The shared validate/fetch/stream flow lives in
// background/api-client-factory.js; this file is just the Anthropic config.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.anthropicClient = GA.makeApiClient({
  label: "Anthropic",
  apiKeyField: "anthropicApiKey",
  modelField: "anthropicModel",
  missingKeyMsg: "Add your Anthropic (Claude) API key in the extension's settings.",
  buildRequest: GA.anthropic.payload.buildRequest,
  makeStream: GA.anthropic.parser.makeStream,
});

if (typeof module !== "undefined" && module.exports) module.exports = GA.anthropicClient;
