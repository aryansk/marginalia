// client.js — Google Generative Language API strategy implementing the shared
// client interface `{ ask(req, onChunk) -> Promise<string> }`. Used for provider
// "gemini" when a Gemini API key is set; otherwise the logged-in
// gemini.google.com web session client is used. The shared validate/fetch/stream
// flow lives in background/api-client-factory.js; this file is just the config.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.googleaiClient = GA.makeApiClient({
  label: "Google AI",
  apiKeyField: "geminiApiKey",
  modelField: "geminiModel",
  missingKeyMsg: "Add your Gemini (Google AI) API key in the extension's settings.",
  buildRequest: GA.googleai.payload.buildRequest,
  parser: GA.googleai.parser.parseLatest,
});

if (typeof module !== "undefined" && module.exports) module.exports = GA.googleaiClient;
