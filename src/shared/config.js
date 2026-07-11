// config.js — named timing/size constants for the content-script shell, so the
// magic numbers live in one labelled place. (Layout-algorithm constants live with
// the algorithm in core/layout-engine.js; anchor context size in core/anchor-match.)
var GA = (typeof GA !== "undefined" && GA) || {};

GA.config = {
  TOKEN_CACHE_TTL_MS: 60000, // re-scrape session tokens at most this often
  ASK_WATCHDOG_MS: 90000, // content-side ask abandoned if the port stays silent this long
  // (background pings every ~20s while streaming, so only a dead worker trips this)
  REANCHOR_RETRY_MS: [400, 1000, 2200, 4000, 6500], // post-load re-anchor attempts (lazy hydration)
  SECTION_CHARS: 4000, // max chars of answer-section context sent to Gemini
  CONVERSATION_CHARS: 12000, // max chars of whole-conversation context
  TOAST_MS: 2600, // toast visible duration
  DRAFT_TTL_MS: 7 * 24 * 60 * 60 * 1000, // isStaleDraft's age threshold (sweeps never delete non-empty buckets)
  SNIPPET_CHARS: 60, // highlighted-text snippet length in a box header
  TEXTAREA_MAX_PX: 120, // composer auto-grow cap
};

if (typeof module !== "undefined" && module.exports) module.exports = GA.config;
