// keyboard-nav.js — keyboard-first thread navigation (the Linear/Figma habit):
//   Alt+ArrowDown / Alt+ArrowUp  cycle threads by position (orphans last),
//                                scrolling each highlight into view and
//                                focusing its box;
//   Alt+Shift+C                  toggle every thread collapsed/expanded.
// Alt-based so the host site's own shortcuts are untouched; inactive while
// typing in any editable field (the sites' composers included).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.keyboardNav = (function () {
  function isTyping(e) {
    const t = e.target;
    return t && t.closest && !!t.closest("input, textarea, [contenteditable='true'], [contenteditable='']");
  }

  function cycle(dir) {
    const ids = GA.gutter.orderedIds();
    const next = GA.core.cycle.nextId(ids, GA.gutter.activeId(), dir);
    if (!next) return;
    const anchor = GA.selection.anchorEl(next);
    if (anchor) anchor.scrollIntoView({ block: "center", behavior: "smooth" });
    GA.gutter.setActive(next);
    const it = GA.gutter.get(next);
    if (it) it.box.el.focus();
  }

  function setup() {
    document.addEventListener("keydown", function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTyping(e)) return;
      if (e.key === "ArrowDown" && !e.shiftKey) {
        e.preventDefault();
        cycle(1);
      } else if (e.key === "ArrowUp" && !e.shiftKey) {
        e.preventDefault();
        cycle(-1);
      } else if (e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        GA.gutter.toggleAllCollapsed();
      } else if (e.shiftKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        GA.panel.toggle();
      }
    });
  }

  return { setup };
})();
