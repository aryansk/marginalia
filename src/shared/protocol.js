// protocol.js — the single source of truth for the message/port contract between
// the content script and the background script. Loaded by BOTH (manifest
// content_scripts AND background.scripts) so the two sides can't drift.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.protocol = {
  PORT_ASK: "ga-ask", // runtime.connect port name for streamed asks
  MSG_ASK: "ask", // content -> bg over the port: {prompt, tokens}
  MSG_CHUNK: "chunk", // bg -> content: partial answer
  MSG_DONE: "done", // bg -> content: final answer
  MSG_ERROR: "error", // bg -> content: failure
  MSG_OPEN_FROM_CONTEXT: "ga-open-from-context", // bg -> content (context-menu click)
  MSG_READ_TOKENS: "ga-read-tokens", // content -> bg: read WIZ_global_data in MAIN world
  CONTEXT_MENU_ID: "ga-ask",
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.protocol;
