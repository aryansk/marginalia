// anchor-match.js — pure string matching for the TextQuoteSelector. Given the
// full text of a container and a {exact, prefix, suffix} selector, find the byte
// offset of the best occurrence. No DOM — the DOM range mapping stays in anchor.js.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.anchorMatch = (function () {
  // Index of the occurrence of `exact` whose surrounding text best matches the
  // recorded prefix/suffix (disambiguates repeated phrases). -1 if not found.
  function bestMatch(full, selector) {
    const exact = selector.exact;
    if (!exact) return -1;
    const prefix = selector.prefix || "";
    const suffix = selector.suffix || "";
    let from = 0,
      best = -1,
      bestScore = -1;
    for (;;) {
      const i = full.indexOf(exact, from);
      if (i < 0) break;
      const pre = full.slice(Math.max(0, i - prefix.length), i);
      const suf = full.slice(i + exact.length, i + exact.length + suffix.length);
      const score = commonSuffixLen(pre, prefix) + commonPrefixLen(suf, suffix);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
      from = i + 1;
    }
    return best;
  }

  function commonPrefixLen(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }
  function commonSuffixLen(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  }

  return { bestMatch, commonPrefixLen, commonSuffixLen };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.anchorMatch;
