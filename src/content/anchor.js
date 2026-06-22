// anchor.js — robust text anchoring via a W3C-style TextQuoteSelector.
// Create {exact, prefix, suffix} from a Range, and re-locate that Range later
// (after reload / re-render) by best-matching exact text + surrounding context.
var GA = GA || {};

GA.anchor = (function () {
  const CTX = 32; // chars of context kept on each side

  function fromRange(range, rootEl) {
    const exact = range.toString();
    const full = textOf(rootEl);
    const start = offsetOfRangeStart(rootEl, range);
    let prefix = "",
      suffix = "";
    if (start >= 0) {
      prefix = full.slice(Math.max(0, start - CTX), start);
      suffix = full.slice(start + exact.length, start + exact.length + CTX);
    }
    return { exact, prefix, suffix };
  }

  // Returns a Range for the selector within rootEl, or null if not found.
  function locate(selector, rootEl) {
    if (!selector || !selector.exact) return null;
    const full = textOf(rootEl);
    const idx = bestMatch(full, selector);
    if (idx < 0) return null;
    return rangeFromOffsets(rootEl, idx, idx + selector.exact.length);
  }

  function bestMatch(full, sel) {
    const exact = sel.exact;
    const prefix = sel.prefix || "";
    const suffix = sel.suffix || "";
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

  function walker(rootEl) {
    return document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  }

  function textOf(rootEl) {
    let s = "";
    const w = walker(rootEl);
    let n;
    while ((n = w.nextNode())) s += n.nodeValue;
    return s;
  }

  function rangeFromOffsets(rootEl, start, end) {
    const w = walker(rootEl);
    let n,
      pos = 0,
      startNode = null,
      startOff = 0,
      endNode = null,
      endOff = 0;
    while ((n = w.nextNode())) {
      const len = n.nodeValue.length;
      if (startNode === null && pos + len >= start) {
        startNode = n;
        startOff = start - pos;
      }
      if (pos + len >= end) {
        endNode = n;
        endOff = end - pos;
        break;
      }
      pos += len;
    }
    if (!startNode || !endNode) return null;
    const r = document.createRange();
    r.setStart(startNode, startOff);
    r.setEnd(endNode, endOff);
    return r;
  }

  function offsetOfRangeStart(rootEl, range) {
    const w = walker(rootEl);
    let n,
      pos = 0;
    while ((n = w.nextNode())) {
      if (n === range.startContainer) return pos + range.startOffset;
      pos += n.nodeValue.length;
    }
    return -1; // startContainer is an element node — skip context, keep exact only
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

  return { fromRange, locate };
})();
