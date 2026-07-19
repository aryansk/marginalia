// dialog.js — shared overlay-dialog lifecycle for the modal and the panel:
// one accessible pattern (role=dialog, aria-modal, focus trapped inside, Esc
// closes, focus returns to whatever opened it) instead of two hand-kept
// copies. The caller supplies the dialog's content; this module owns only the
// overlay, the keyboard handling, and the open/close bookkeeping.
//
// GA.dialog.open({ label, className?, content, initialFocus?, onEscape?,
//   onClose? }) -> { overlay, close(), isOpen() }
//
// - label:        the overlay's aria-label.
// - className:    extra overlay class(es) beside "ga-modal-overlay".
// - content:      element appended into the overlay (the .ga-modal panel).
// - initialFocus: element focused once the dialog is in the document.
// - onEscape(e):  return true to VETO the close (e.g. Escape clears a search
//                 box first); Escape's stopPropagation has already run either
//                 way, so the host page never sees it.
// - onClose():    runs exactly once, after focus is restored.
//
// No module-level singleton: each open() returns its own handle, so a caller
// can keep one dialog per surface without this module arbitrating.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.dialog = (function () {
  function open(opts) {
    const overlay = GA.el("div", {
      class: "ga-modal-overlay" + (opts.className ? " " + opts.className : ""),
      role: "dialog",
      "aria-modal": "true",
      "aria-label": opts.label,
    });
    // Captured now, restored on close — but only if it still exists and is
    // still in the document by then.
    const opener = document.activeElement;
    let closed = false;

    function focusables() {
      return Array.from(
        overlay.querySelectorAll("button, textarea, input, a[href], [tabindex]"),
      ).filter((el) => !el.disabled && el.offsetParent !== null);
    }

    // Capture phase, so Escape/Tab win over the host page's own handlers.
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (opts.onEscape && opts.onEscape(e) === true) return; // vetoed — keep open
        close();
      } else if (e.key === "Tab") {
        // focus trap: Tab cycles inside the dialog
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || !overlay.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    // Mousedown on the backdrop itself (not on the content) closes.
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    if (opts.content) overlay.appendChild(opts.content);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    if (opts.initialFocus) opts.initialFocus.focus();

    function close() {
      if (closed) return; // idempotent — onClose must fire exactly once
      closed = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      if (opener && opener.focus && opener.isConnected) opener.focus();
      if (opts.onClose) opts.onClose();
    }

    return {
      overlay,
      close,
      isOpen: () => !closed,
    };
  }

  return { open };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.dialog;
