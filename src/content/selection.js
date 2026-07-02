// selection.js — capture the current selection, locate its answer "section",
// build an anchor, and wrap/unwrap highlight spans across multiple text nodes.
var GA = GA || {};

GA.selection = (function () {
  // Live registry of highlight spans per thread. anchorEl()/orphan checks are
  // pointer lookups instead of document.querySelector — they run every mutation
  // and scroll frame, so this is what keeps the observer callback cheap.
  const spansByThread = new Map(); // threadId -> [span, ...]

  // Candidate selectors for the current site's model-answer container. The exact
  // DOM changes over time; we try several and fall back to the nearest big block.
  // The per-site lists live in core/sites.js; confirm/extend against the live page.
  function responseSelectors() {
    return GA.core.sites.responseSelectors(GA.provider);
  }

  function findSection(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    if (!el) return document.body;
    for (const sel of responseSelectors()) {
      const match = el.closest(sel);
      if (match) return match;
    }
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.textContent && cur.textContent.trim().length > 200) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  function findAllSections() {
    const set = new Set();
    for (const sel of responseSelectors())
      document.querySelectorAll(sel).forEach((e) => set.add(e));
    return set.size ? Array.from(set) : [document.body];
  }

  function capture() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const text = range.toString().trim();
    if (!text) return null;
    const sectionEl = findSection(range.commonAncestorContainer);
    const selector = GA.anchor.fromRange(range, sectionEl);
    return {
      range,
      text,
      sectionEl,
      sectionText: (sectionEl.innerText || sectionEl.textContent || "").trim(),
      selector,
    };
  }

  // Wrap each text-node slice intersecting `range` in a highlight span.
  // Returns the list of created spans (first one is the anchor for layout).
  function highlightRange(range, threadId) {
    const spans = [];
    let root = range.commonAncestorContainer;
    if (root.nodeType === 3) root = root.parentNode;
    if (!root) return spans;

    const textNodes = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        return range.intersectsNode(n) && n.nodeValue && n.nodeValue.length
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    while ((n = w.nextNode())) textNodes.push(n);

    textNodes.forEach(function (tn) {
      let s = tn === range.startContainer ? range.startOffset : 0;
      let e = tn === range.endContainer ? range.endOffset : tn.nodeValue.length;
      if (s >= e) return;
      let target = tn;
      if (s > 0) target = target.splitText(s);
      if (e - s < target.nodeValue.length) target.splitText(e - s);
      const span = document.createElement("span");
      span.className = "ga-highlight";
      span.dataset.gaThread = threadId;
      target.parentNode.insertBefore(span, target);
      span.appendChild(target);
      spans.push(span);
    });
    if (spans.length) {
      spansByThread.set(threadId, spans);
      // CSS Anchor Positioning target (used by the gutter on Chrome; inert
      // elsewhere). Thread ids are [A-Za-z0-9_], a valid dashed-ident tail.
      spans[0].style.setProperty("anchor-name", "--ga-" + threadId);
    }
    return spans;
  }

  // Keep the anchor-name on the span the layout actually measures: a site
  // re-render can kill the originally named span while later spans survive.
  // Called from the gutter's full relayout when anchored mode is on.
  function ensureAnchorName(threadId) {
    const el = anchorEl(threadId);
    if (el && !el.style.getPropertyValue("anchor-name"))
      el.style.setProperty("anchor-name", "--ga-" + threadId);
  }

  function highlightSelector(selector, threadId) {
    const sections = findAllSections();
    for (const section of sections) {
      const range = GA.anchor.locate(selector, section);
      if (range) {
        const spans = highlightRange(range, threadId);
        if (spans.length) return spans;
      }
    }
    // Fallback: search the whole document. The section selectors are heuristic,
    // so the highlight may live in a container none of them matched. anchor.js
    // already skips our own UI text, so this won't match inside a comment box.
    if (!(sections.length === 1 && sections[0] === document.body)) {
      const range = GA.anchor.locate(selector, document.body);
      if (range) {
        const spans = highlightRange(range, threadId);
        if (spans.length) return spans;
      }
    }
    return [];
  }

  // Batch form of highlightSelector for the re-anchor pass: extract each
  // section's text ONCE and match every orphan against the cached strings —
  // instead of walking the whole document per thread, per frame. Wrapping a
  // match in highlight spans doesn't change any extracted text, so the caches
  // stay valid across threads. Returns Map(threadId -> spans).
  function reanchorAll(threads) {
    const result = new Map();
    if (!threads.length) return result;
    const sections = findAllSections();
    const texts = sections.map((s) => GA.anchor.textOf(s));
    const useBodyFallback = !(sections.length === 1 && sections[0] === document.body);
    let bodyText = null; // extracted at most once per pass

    threads.forEach(function (thread) {
      let spans = [];
      for (let i = 0; i < sections.length && !spans.length; i++) {
        const range = GA.anchor.locateInText(texts[i], thread.selector, sections[i]);
        if (range) spans = highlightRange(range, thread.id);
      }
      if (!spans.length && useBodyFallback) {
        if (bodyText === null) bodyText = GA.anchor.textOf(document.body);
        const range = GA.anchor.locateInText(bodyText, thread.selector, document.body);
        if (range) spans = highlightRange(range, thread.id);
      }
      result.set(thread.id, spans);
    });
    return result;
  }

  function unhighlight(threadId) {
    spansByThread.delete(threadId);
    const q = 'span.ga-highlight[data-ga-thread="' + cssEscape(threadId) + '"]';
    document.querySelectorAll(q).forEach(function (span) {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
  }

  // Whether this environment produces client rects at all (jsdom doesn't) —
  // when it does, a span with none is inside a hidden/display:none subtree and
  // must count as orphaned rather than anchoring a box to nowhere.
  let rectsWork = null;
  function hasRects(el) {
    if (rectsWork === null)
      rectsWork = document.documentElement.getClientRects().length > 0;
    return !rectsWork || el.getClientRects().length > 0;
  }

  // The thread's live anchor span (first visible one), or null when the thread
  // is orphaned. Registry lookup only — no DOM queries on the hot path.
  function anchorEl(threadId) {
    const spans = spansByThread.get(threadId);
    if (!spans) return null;
    for (const s of spans) {
      if (s.isConnected && hasRects(s)) return s;
    }
    return null; // spans died with a re-render (or are hidden) — orphan
  }

  // Main visual state of a thread's highlight spans: "active" | "resolved" |
  // null (idle) — exclusive. Hover is a separate additive layer (below) so
  // mousing over a box can't clobber the active state.
  const HL_STATES = { active: "ga-highlight-active", resolved: "ga-highlight-resolved" };
  function setHighlightState(threadId, stateName) {
    const spans = spansByThread.get(threadId);
    if (!spans) return;
    spans.forEach((s) => {
      for (const k in HL_STATES) s.classList.toggle(HL_STATES[k], k === stateName);
    });
  }

  function setHighlightHover(threadId, on) {
    const spans = spansByThread.get(threadId);
    if (!spans) return;
    spans.forEach((s) => s.classList.toggle("ga-highlight-hover", !!on));
  }

  function setActiveHighlight(threadId, active) {
    setHighlightState(threadId, active ? "active" : null);
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
  }

  return {
    capture,
    findSection,
    findAllSections,
    highlightRange,
    highlightSelector,
    reanchorAll,
    unhighlight,
    anchorEl,
    ensureAnchorName,
    setActiveHighlight,
    setHighlightState,
    setHighlightHover,
  };
})();
