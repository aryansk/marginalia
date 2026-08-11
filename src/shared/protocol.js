// protocol.js — the single source of truth for the message/port contract between
// the content script and the background script. Loaded by BOTH (manifest
// content_scripts AND background.scripts) so the two sides can't drift.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.protocol = {
  PORT_ASK: "ga-ask", // runtime.connect port name for streamed asks
  MSG_ASK: "ask", // content -> bg over the port: {provider, prompt, tokens?}
  MSG_CHUNK: "chunk", // bg -> content: {delta} appended text, or {reset, text} full rewrite
  MSG_DONE: "done", // bg -> content: final answer
  MSG_ERROR: "error", // bg -> content: failure {message, code?}
  MSG_PING: "ping", // bg -> content: heartbeat while an ask is in flight (keeps
  // Chrome's MV3 worker alive and feeds the content-side watchdog)
  MSG_OPEN_FROM_CONTEXT: "ga-open-from-context", // bg -> content (context-menu click)
  MSG_READ_TOKENS: "ga-read-tokens", // content -> bg: read WIZ_global_data in MAIN world
  MSG_OPEN_OPTIONS: "ga-open-options", // content -> bg: open the extension options page
  MSG_TEST_KEY: "ga-test-key", // options -> bg: {provider, key, model} minimal live request
  MSG_LIST_MODELS: "ga-list-models", // options -> bg: {provider, key} fetch model ids
  CONTEXT_MENU_ID: "ga-ask",
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.protocol;
