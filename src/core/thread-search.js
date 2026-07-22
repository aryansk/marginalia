// thread-search.js — pure keyword matcher for the all-threads panel. Tests a
// thread record against a query with a case-insensitive substring match over
// its highlight snippet (selector.exact), every message's text (both the
// user's questions and the AI's replies), and any attached labels. No DOM,
// null-safe, unit-tested.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.threadSearch = (function () {
  // matches(thread, query) -> boolean. Empty/whitespace query matches all.
  function matches(thread, query) {
    const q = String(query == null ? "" : query)
      .trim()
      .toLowerCase();
    if (!q) return true;
    if (!thread) return false;
    const snippet = thread.selector && thread.selector.exact;
    if (snippet && String(snippet).toLowerCase().indexOf(q) >= 0) return true;
    const messages = thread.messages || [];
    for (let i = 0; i < messages.length; i++) {
      const text = messages[i] && messages[i].text;
      if (text && String(text).toLowerCase().indexOf(q) >= 0) return true;
    }
    const labels = thread.labels || [];
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] && String(labels[i]).toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  }

  return { matches };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.threadSearch;
