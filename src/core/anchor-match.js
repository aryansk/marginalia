// anchor-match.js — pure string matching for the TextQuoteSelector. Given the
// full text of a container and a {exact, prefix, suffix} selector, find the byte
// offset of the best occurrence. No DOM — the DOM range mapping stays in anchor.js.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.anchorMatch = (function () {
  // Chars of one-sided context agreement that count as corroboration when the
  // recorded context is longer than that. A lone shared space or period is not
  // evidence — it is what any two occurrences share by accident.
  const CONF_SIDE = 4;

  // Score every occurrence of `exact` and report the winner along with how well
  // its surroundings reproduced the recorded context. Callers decide what to do
  // with a weak match: the closer the search is scoped to the originating turn,
  // the less textual corroboration it needs. Returns null when the text is
  // absent or the occurrence is ambiguous.
  function evaluate(full, selector) {
    if (!selector || !selector.exact) return null;
    const exact = selector.exact;
    const prefix = selector.prefix || "";
    const suffix = selector.suffix || "";
    const hasContext = prefix.length > 0 || suffix.length > 0;

    let from = 0,
      best = -1,
      bestScore = -1,
      secondScore = -1,
      bestConfident = false,
      count = 0;

    for (;;) {
      const i = full.indexOf(exact, from);
      if (i < 0) break;
      count++;
      const pre = full.slice(Math.max(0, i - prefix.length), i);
      const suf = full.slice(i + exact.length, i + exact.length + suffix.length);
      const preAgree = commonSuffixLen(pre, prefix);
      const sufAgree = commonPrefixLen(suf, suffix);
      const score = preAgree + sufAgree;
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = i;
        bestConfident =
          hasContext &&
          sideOk(preAgree, prefix.length, pre.length) &&
          sideOk(sufAgree, suffix.length, suf.length);
      } else if (score > secondScore) {
        secondScore = score;
      }
      from = i + 1;
    }

    if (best < 0) return null;

    // Context was recorded and NOT ONE character of it reappeared. That is not
    // an absence of evidence, it is evidence of the wrong occurrence — even
    // when this is the container's only one. (A selector with no recorded
    // context has nothing to contradict, so a unique hit still stands.)
    if (hasContext && bestScore <= 0) return null;

    // Two occurrences the evidence cannot separate. Picking the earlier one is
    // how a comment ends up on the question above the answer it was written on.
    if (count > 1 && bestScore === secondScore) return null;

    return { index: best, score: bestScore, confident: bestConfident, count };
  }

  // Did this side reproduce its recorded context? `avail` is what we recorded,
  // `live` is how much text actually sits on that side of this occurrence (less
  // than `avail` near a container's edge). Full reproduction of whatever was
  // available counts, as does a substantial run — but a 1-char coincidence does not.
  function sideOk(agree, avail, live) {
    if (avail === 0) return true; // nothing was recorded on this side
    const usable = Math.min(avail, live);
    if (usable === 0) return false; // context was recorded, yet none exists here
    return agree === usable || agree >= CONF_SIDE;
  }

  // Index of the occurrence of `exact` whose surrounding text best matches the
  // recorded prefix/suffix (disambiguates repeated phrases). -1 if not found,
  // if the recorded context is contradicted, or if occurrences are tied: a
  // guess would silently highlight the wrong text, and an orphaned thread
  // (which keeps retrying) beats a wrong anchor.
  function bestMatch(full, selector) {
    const ev = evaluate(full, selector);
    return ev ? ev.index : -1;
  }

  // Locate within the turn the thread was created in, where we also recorded
  // WHICH occurrence was selected. When the turn's text is unchanged that index
  // is exact and needs no scoring at all; when it has drifted, the index no
  // longer lands on `exact` and we fall back to context matching.
  function bestMatchInTurn(full, selector, occurrence) {
    if (!selector || !selector.exact) return -1;
    if (typeof occurrence === "number" && occurrence >= 0) {
      const exact = selector.exact;
      let from = 0;
      for (let n = 0; ; n++) {
        const i = full.indexOf(exact, from);
        if (i < 0) break;
        if (n === occurrence) return i;
        from = i + 1;
      }
    }
    return bestMatch(full, selector);
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

  return { evaluate, bestMatch, bestMatchInTurn, commonPrefixLen, commonSuffixLen };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.anchorMatch;
