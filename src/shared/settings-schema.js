// settings-schema.js — single source of truth for stored-data keys and the
// settings defaults. Shared by content scripts (util.js, store.js) and the
// options page so the schema can't drift between contexts.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.schema = {
  SETTINGS_KEY: "ga:settings",
  THREADS_PREFIX: "ga:threads:", // storage.local key prefix, one bucket per session
  DRAFT_SESSION: "__draft__", // bucket for threads created before /app/<id> exists

  DEFAULT_SETTINGS: {
    // Context sent to Gemini with each follow-up: 'section' | 'selection' | 'conversation'
    scope: "section",
    // Configurable shortcut to open a comment box (Ctrl+H is reserved by Firefox).
    shortcut: { ctrl: true, shift: true, alt: false, meta: false, key: "h" },
    debug: false,
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.schema;
