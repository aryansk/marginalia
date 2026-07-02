// client.js — OpenAI Chat Completions strategy implementing the shared client
// interface `{ ask(req, onChunk) -> Promise<string> }`. Used for provider
// "chatgpt" when an OpenAI API key is set (the only path now — chatgpt.com's web
// session is Turnstile-blocked). The shared validate/fetch/stream flow lives in
// background/api-client-factory.js; this file is just the OpenAI config.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.openaiClient = GA.makeApiClient({
  label: "OpenAI",
  apiKeyField: "openaiApiKey",
  modelField: "openaiModel",
  missingKeyMsg: "Add your OpenAI API key in the extension's settings to use ChatGPT.",
  buildRequest: GA.openai.payload.buildRequest,
  parser: GA.openai.parser.parseLatest,
});

if (typeof module !== "undefined" && module.exports) module.exports = GA.openaiClient;
