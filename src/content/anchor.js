// anchor.js — robust text anchoring via a W3C-style TextQuoteSelector.
// Create {exact, prefix, suffix} from a Range, and re-locate that Range later
// (after reload / re-render) by best-matching exact text + surrounding context.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.anchor = (function () {
  const CTX = 32; // chars of context kept on each side
  const CTX_WIDE = 128; // …widened when the quote repeats inside its own turn

  // `rootEl` should be the TURN the selection lives in: `occurrence` and the
  // context slices are relative to it, and re-locate searches that same turn.
  function fromRange(range, rootEl) {
    const exact = range.toString();
    const full = textOf(rootEl);
    const start = offsetOfRangeStart(rootEl, range);
    let prefix = "",
      suffix = "",
      occurrence = -1;
    if (start >= 0) {
      // A one-word selection carries almost no identity of its own; widen the
      // context when the word recurs in this turn so the selector can still
      // stand on its own if the occurrence index ever goes stale.
      const ctx = repeats(full, exact) ? CTX_WIDE : CTX;
      prefix = full.slice(Math.max(0, start - ctx), start);
      suffix = full.slice(start + exact.length, start + exact.length + ctx);
      occurrence = occurrenceAt(full, exact, start);
    }
    return { exact, prefix, suffix, occurrence };
  }

  function repeats(full, exact) {
    if (!exact) return false;
    const first = full.indexOf(exact);
    return first >= 0 && full.indexOf(exact, first + 1) >= 0;
  }

  // Which occurrence of `exact` starts at `start`. Counts the same way
  // anchor-match enumerates them (step by 1), so overlapping quotes agree.
  function occurrenceAt(full, exact, start) {
    if (!exact) return -1;
    let n = 0,
      from = 0,
      i;
    while ((i = full.indexOf(exact, from)) >= 0 && i < start) {
      n++;
      from = i + 1;
    }
    return n;
  }

  // Returns a Range for the selector within rootEl, or null if not found.
  // String matching (which occurrence) lives in core/anchor-match.js.
  function locate(selector, rootEl) {
    return locateInText(textOf(rootEl), selector, rootEl);
  }

  // Same as locate() but against a pre-extracted text of rootEl, so many
  // selectors can be matched against one extraction. (Batch re-anchoring now
  // goes through locateWithin/evaluateIn; only locate() calls this here.)
  function locateInText(full, selector, rootEl) {
    if (!selector || !selector.exact) return null;
    const idx = GA.core.anchorMatch.bestMatch(full, selector);
    if (idx < 0) return null;
    return rangeFromOffsets(rootEl, idx, idx + selector.exact.length);
  }

  // Locate inside the turn we already know the thread belongs to. The recorded
  // occurrence index is exact while the turn's text is unchanged; when it has
  // drifted, anchor-match falls back to context scoring. Null means the quote
  // is NOT in this turn — a contradicted signal, so the caller must orphan
  // rather than go looking elsewhere.
  function locateWithin(full, selector, rootEl) {
    if (!selector || !selector.exact) return null;
    const idx = GA.core.anchorMatch.bestMatchInTurn(full, selector, selector.occurrence);
    if (idx < 0) return null;
    return rangeFromOffsets(rootEl, idx, idx + selector.exact.length);
  }

  // Match without knowing the turn: reports how well the recorded context was
  // reproduced so the caller can insist on corroboration before trusting it.
  function evaluateIn(full, selector, rootEl) {
    if (!selector || !selector.exact) return null;
    const ev = GA.core.anchorMatch.evaluate(full, selector);
    if (!ev) return null;
    const range = rangeFromOffsets(rootEl, ev.index, ev.index + selector.exact.length);
    if (!range) return null;
    return { range: range, index: ev.index, score: ev.score, confident: ev.confident };
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

  // locateInText and occurrenceAt have no production callers outside this
  // module — exported for tests.
  return { fromRange, locate, locateInText, locateWithin, evaluateIn, occurrenceAt, textOf };
})();
