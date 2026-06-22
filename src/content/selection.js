// selection.js — capture the current selection, locate its answer "section",
// build an anchor, and wrap/unwrap highlight spans across multiple text nodes.
var GA = GA || {};

GA.selection = (function () {
  // Candidate selectors for a Gemini model-answer container. The exact DOM
  // changes over time; we try several and fall back to the nearest big block.
  // Confirm/extend against the live page (see plan).
  GA.GEMINI_RESPONSE_SELECTORS = [
    "message-content",
    "model-response",
    ".model-response-text",
    '[data-message-author-role="model"]',
    ".markdown",
    ".response-container-content",
  ];

  function findSection(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    if (!el) return document.body;
    for (const sel of GA.GEMINI_RESPONSE_SELECTORS) {
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
    for (const sel of GA.GEMINI_RESPONSE_SELECTORS)
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
    return spans;
  }

  function highlightSelector(selector, threadId) {
    for (const section of findAllSections()) {
      const range = GA.anchor.locate(selector, section);
      if (range) {
        const spans = highlightRange(range, threadId);
        if (spans.length) return spans;
      }
    }
    return [];
  }

  function unhighlight(threadId) {
    const q = 'span.ga-highlight[data-ga-thread="' + cssEscape(threadId) + '"]';
    document.querySelectorAll(q).forEach(function (span) {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
  }

  function anchorEl(threadId) {
    return document.querySelector(
      'span.ga-highlight[data-ga-thread="' + cssEscape(threadId) + '"]'
    );
  }

  function setActiveHighlight(threadId, active) {
    const q = 'span.ga-highlight[data-ga-thread="' + cssEscape(threadId) + '"]';
    document.querySelectorAll(q).forEach((s) => s.classList.toggle("ga-highlight-active", !!active));
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
    unhighlight,
    anchorEl,
    setActiveHighlight,
  };
})();
