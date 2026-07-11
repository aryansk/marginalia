// settings-schema.js — single source of truth for stored-data keys and the
// settings defaults. Shared by content scripts (util.js, store.js) and the
// options page so the schema can't drift between contexts.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.schema = {
  SETTINGS_KEY: "ga:settings",
  THREADS_PREFIX: "ga:threads:", // storage.local key prefix, one bucket per session
  CONVO_PREFIX: "ga:convo:", // transcript record per session (per-message gzip blobs)
  DRAFT_SESSION: "__draft__", // bucket for threads created before /app/<id> exists

  DEFAULT_SETTINGS: {
    // Context sent with each follow-up: 'section' | 'selection' | 'conversation'
    scope: "section",
    // Configurable shortcut to open a comment box (Ctrl+H is reserved by Firefox).
    shortcut: { ctrl: true, shift: true, alt: false, meta: false, key: "h" },
    // Show the floating "Comment" pill when text is selected in an answer.
    adder: true,
    debug: false,
    // Optional per-provider API keys. When a key is set, that site's follow-ups go
    // through the official API instead of the logged-in web session. Empty = web
    // session (ChatGPT has no web fallback, so it needs a key). Models are free-text
    // because vendors rename/retire ids over time.
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    geminiApiKey: "",
    geminiModel: "gemini-2.5-flash",
    anthropicApiKey: "",
    anthropicModel: "claude-sonnet-4-6",
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.schema;
