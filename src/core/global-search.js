// global-search.js — pure cross-conversation search over thread buckets
// ([{ session, threads }], as produced by GA.store.listThreadBuckets). Reuses
// the per-thread matcher (core/thread-search) and the label grammar
// (core/labels); no DOM, no storage. "Threads" here means conversation threads
// only — standalone label records (kind:"label") surface through the label
// filters, never through text search.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.globalSearch = (function () {
  // searchThreads(buckets, query) -> [{ session, record }] for every
  // conversation thread matching the query (label records excluded).
  function searchThreads(buckets, query) {
    const out = [];
    for (const b of buckets || []) {
      for (const t of (b && b.threads) || []) {
        if (!t || t.kind === "label") continue;
        if (GA.core.threadSearch.matches(t, query)) out.push({ session: b.session, record: t });
      }
    }
    return out;
  }

  // collectLabels(buckets) -> sorted unique labels across every record of both
  // kinds — the label picker's universe.
  function collectLabels(buckets) {
    const seen = new Set();
    for (const b of buckets || []) {
      for (const t of (b && b.threads) || []) {
        for (const l of (t && t.labels) || []) if (l) seen.add(l);
      }
    }
    return Array.from(seen).sort();
  }

  // filterByLabels(buckets, selected) -> [{ session, record }] where any of the
  // record's labels falls under any selected label (namespace containment via
  // core/labels.covers). Includes BOTH threads and standalone label records.
  // No selection selects nothing — the caller gates on the picker.
  function filterByLabels(buckets, selected) {
    const sel = (selected || []).filter(Boolean);
    const out = [];
    if (!sel.length) return out;
    for (const b of buckets || []) {
      for (const t of (b && b.threads) || []) {
        const labels = (t && t.labels) || [];
        if (labels.some((l) => sel.some((s) => GA.core.labels.covers(s, l))))
          out.push({ session: b.session, record: t });
      }
    }
    return out;
  }

  return { searchThreads, collectLabels, filterByLabels };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.globalSearch;
