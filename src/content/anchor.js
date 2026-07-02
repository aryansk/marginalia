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
  // String matching (which occurrence) lives in core/anchor-match.js.
  function locate(selector, rootEl) {
    return locateInText(textOf(rootEl), selector, rootEl);
  }

  // Same as locate() but against a pre-extracted text of rootEl — lets a batch
  // re-anchor (selection.reanchorAll) extract each section's text ONCE and
  // match many selectors against it.
  function locateInText(full, selector, rootEl) {
    if (!selector || !selector.exact) return null;
    const idx = GA.core.anchorMatch.bestMatch(full, selector);
    if (idx < 0) return null;
    return rangeFromOffsets(rootEl, idx, idx + selector.exact.length);
  }

  // Skip text inside our own UI (comment boxes, modal, toast). Otherwise a
  // whole-document re-anchor could match the highlighted phrase where it appears
  // *inside a comment box* instead of in Gemini's answer.
  const OWN_UI = ".ga-gutter, .ga-modal-overlay, .ga-toast";

  function walker(rootEl) {
    return document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (p && p.closest && p.closest(OWN_UI)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
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
    if (range.startContainer.nodeType === 3) {
      while ((n = w.nextNode())) {
        if (n === range.startContainer) return pos + range.startOffset;
        pos += n.nodeValue.length;
      }
      return -1;
    }
    // Element-boundary start (triple-click, cross-block selections): the offset
    // is the first text position at/after the boundary. Without this the
    // selector would carry no prefix/suffix and repeated phrases couldn't be
    // disambiguated on re-anchor.
    try {
      while ((n = w.nextNode())) {
        if (range.comparePoint(n, 0) >= 0) return pos;
        pos += n.nodeValue.length;
      }
    } catch (e) {}
    return -1;
  }

  return { fromRange, locate, locateInText, textOf };
})();
