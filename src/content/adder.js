// adder.js — the selection "adder": a small Comment pill that appears when the
// user selects text inside an AI answer (the Medium/Hypothes.is pattern, and
// the main way anyone discovers this extension exists). Clicking it opens a
// comment box on the selection — same path as the context menu / shortcut.
//
// Shown only for selections inside a recognized answer section; can be turned
// off in Settings (settings.adder).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.adder = (function () {
  let pill = null;
  let visible = false;
  let debounceTimer = 0;

  function ensurePill(onComment) {
    if (pill) return pill;
    pill = GA.el(
      "button",
      {
        class: "ga-adder",
        "aria-label": "Comment on or ask about the selected text",
      },
      [GA.icons.make("comment-plus"), "Comment / Ask"],
    );
    // mousedown (not click) + preventDefault: the page selection must survive
    // until createFromSelection() reads it.
    pill.addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      hide();
      onComment();
    });
    document.body.appendChild(pill);
    return pill;
  }

  function eligibleRange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!String(range).trim()) return null;
    let el = range.commonAncestorContainer;
    if (el.nodeType === 3) el = el.parentElement;
    if (!el || (el.closest && el.closest(".ga-gutter, .ga-modal-overlay, .ga-adder"))) return null;
    // Only inside a recognized answer section — a [body] fallback means the
    // site's containers weren't found, so don't second-guess random pages.
    const sections = GA.selection.findAllSections();
    if (sections.length === 1 && sections[0] === document.body) return null;
    if (!sections.some((s) => s.contains(el))) return null;
    return range;
  }

  function show(onComment) {
    const range = eligibleRange();
    if (!range) {
      hide();
      return;
    }
    const el = ensurePill(onComment);
    el.classList.add("ga-adder-show");
    visible = true;
    const rect = range.getBoundingClientRect();
    const pos = GA.core.adderPosition.position(
      rect,
      { width: el.offsetWidth || 110, height: el.offsetHeight || 32 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";
  }

  function hide() {
    if (!visible || !pill) return;
    visible = false;
    pill.classList.remove("ga-adder-show");
  }

  function setup(onComment) {
    document.addEventListener("mouseup", function (e) {
      if (pill && pill.contains(e.target)) return;
      // wait a tick so the browser finalizes the selection first
      setTimeout(function () {
        if (GA.settings.adder === false) return;
        show(onComment);
      }, 0);
    });
    document.addEventListener("selectionchange", function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) hide();
      }, 120);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hide();
    });
    window.addEventListener("scroll", hide, true);
  }

  return { setup, hide };
})();
