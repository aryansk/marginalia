// modal.js — full-screen view of a single thread's conversation, with its own
// composer: you can keep asking follow-ups from the maximized view. Accessible
// dialog: focus is trapped inside, Esc closes, and focus returns to whatever
// opened it. The docked box is refreshed by the controller's onClosed callback.
var GA = GA || {};

GA.Modal = (function () {
  let overlay = null;
  let opener = null;
  let onClosedCb = null;
  let sessionWidth = 0; // drag-resized width, remembered for this page session
  let endDrag = null; // active drag teardown (also run on close)
  let detachFeed = null; // live-stream unsubscribe (open-mid-stream case)

  // handlers: the thread's box handlers (ask/persist/onStop) — optional; the
  // composer is omitted when absent (read-only legacy behavior).
  function open(thread, handlers, onClosed) {
    close();
    onClosedCb = onClosed || null;
    opener = document.activeElement;

    const snippet = GA.truncate(thread.selector && thread.selector.exact, 120);
    overlay = GA.el("div", {
      class: "ga-modal-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Comment thread: " + snippet,
    });

    const title = GA.el("div", {
      class: "ga-modal-title",
      text: snippet,
      title: thread.selector && thread.selector.exact,
    });
    const closeBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn ga-modal-close",
        title: "Close (Esc)",
        "aria-label": "Close",
        onclick: close,
      },
      GA.icons.make("close"),
    );
    const header = GA.el("div", { class: "ga-modal-header" }, [title, closeBtn]);

    const body = GA.el("div", { class: "ga-modal-body", role: "log", "aria-label": "Messages" });
    const empty = GA.el("div", { class: "ga-modal-empty", text: "No messages yet." });

    function appendMsg(role, text, meta) {
      empty.remove();
      const el = GA.el("div", { class: "ga-msg ga-msg-" + role });
      if (role === "model") {
        if (meta && meta.error) {
          el.appendChild(
            GA.el("div", { class: "ga-error-card" }, [
              GA.el("span", { class: "ga-error-icon" }, GA.icons.make("alert")),
              GA.el("span", { class: "ga-error-text", text: text }),
            ]),
          );
        } else {
          el.appendChild(GA.markdown.render(text));
        }
      } else {
        el.textContent = text;
      }
      body.appendChild(el);
      body.scrollTop = body.scrollHeight;
      return el;
    }

    (thread.messages || []).forEach((m) => appendMsg(m.role, m.text, m));
    if (!thread.messages || !thread.messages.length) body.appendChild(empty);

    const parts = [header, body];

    // Composer: same turn orchestration as the docked box.
    let composer = null;
    if (handlers && handlers.ask) {
      const stream = { pending: null, frame: 0, renderer: null, lastText: null, errored: false };
      function flush() {
        stream.frame = 0;
        if (stream.pending == null) return;
        stream.lastText = stream.pending;
        stream.pending = null;
        if (stream.renderer && overlay && !stream.errored) {
          stream.renderer.update(stream.lastText);
          body.scrollTop = body.scrollHeight;
        }
      }
      const ops = {
        appendUser: (text) => appendMsg("user", text),
        beginModel: () => {
          const el = appendMsg("model", "");
          el.classList.add("ga-msg-streaming");
          stream.renderer = GA.markdown.makeStreamRenderer(el);
          stream.lastText = null;
          stream.errored = false;
          return el;
        },
        renderModel: (el, text) => {
          stream.pending = text;
          if (!stream.frame) stream.frame = requestAnimationFrame(flush);
        },
        renderError: (el, message) => {
          if (stream.frame) cancelAnimationFrame(stream.frame);
          stream.frame = 0;
          stream.pending = null;
          stream.errored = true;
          el.textContent = "";
          el.appendChild(
            GA.el("div", { class: "ga-error-card" }, [
              GA.el("span", { class: "ga-error-icon" }, GA.icons.make("alert")),
              GA.el("span", { class: "ga-error-text", text: message }),
            ]),
          );
        },
        endModel: (el) => {
          if (stream.frame) cancelAnimationFrame(stream.frame);
          stream.frame = 0;
          const finalText = stream.pending != null ? stream.pending : stream.lastText;
          stream.pending = null;
          stream.renderer = null;
          if (!stream.errored && finalText != null && overlay) {
            el.textContent = "";
            el.appendChild(GA.markdown.render(finalText));
          }
          el.classList.remove("ga-msg-streaming");
        },
        setLoading: (v) => composer && composer.setLoading(v),
        ask: handlers.ask,
        persist: handlers.persist,
      };
      composer = GA.Composer({
        placeholder: "Ask a follow-up about the highlighted text…",
        onSubmit: (q) => GA.threadTurn.run(thread, q, ops),
        onStop: () => handlers.onStop && handlers.onStop(thread),
      });
      parts.push(composer.el);

      // Late-join an answer already streaming in the docked box (controller's
      // live-stream registry): seed a bubble with the text so far, follow the
      // feed, and finalize once the box's turn settles. Stop needs no special
      // casing — onStop targets the thread's in-flight ask by id, whichever
      // surface started it.
      const feed = handlers.liveStream ? handlers.liveStream(thread.id) : null;
      if (feed) {
        const el = ops.beginModel();
        ops.setLoading(true);
        ops.renderModel(el, feed.text);
        const onFeed = (text, done) => {
          ops.renderModel(el, text);
          if (!done) return;
          detachFeed = null;
          // The box's threadTurn pushes the settled message (final / stopped /
          // error) only after the feed ends — defer one tick so we can read it.
          setTimeout(() => {
            if (!overlay) return;
            const msgs = thread.messages || [];
            const last = msgs[msgs.length - 1];
            if (last && last.role === "model" && last.error) ops.renderError(el, last.text);
            ops.endModel(el);
            ops.setLoading(false);
          }, 0);
        };
        feed.subscribe(onFeed);
        detachFeed = () => feed.unsubscribe(onFeed);
      }
    }

    const panel = GA.el("div", { class: "ga-modal" }, parts);
    if (sessionWidth) panel.style.width = sessionWidth + "px";
    attachResize(panel);
    overlay.appendChild(panel);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    (composer ? composer.textarea : closeBtn).focus();
  }

  // Edge drag handles: the modal is flex-centered, so to keep the edge under
  // the cursor the width changes by 2*dx. Mouse events (not pointer) — no
  // capture needed, and they run in jsdom. Width clamps to
  // [MODAL_MIN_PX, MODAL_MAX_FRAC * viewport]; the result is remembered for
  // the rest of the page session only.
  function attachResize(panel) {
    function start(side) {
      return function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW =
          parseInt(panel.style.width, 10) || panel.getBoundingClientRect().width || 820;
        const max = Math.round(window.innerWidth * GA.config.MODAL_MAX_FRAC);
        function move(ev) {
          const dx = ev.clientX - startX;
          const w = Math.max(
            GA.config.MODAL_MIN_PX,
            Math.min(max, Math.round(startW + side * 2 * dx)),
          );
          panel.style.width = w + "px";
        }
        function up() {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          if (overlay) overlay.classList.remove("ga-modal-resizing");
          sessionWidth = parseInt(panel.style.width, 10) || sessionWidth;
          endDrag = null;
        }
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
        overlay.classList.add("ga-modal-resizing");
        endDrag = up;
      };
    }
    panel.appendChild(
      GA.el("div", { class: "ga-modal-resize ga-modal-resize-left", onmousedown: start(-1) }),
    );
    panel.appendChild(
      GA.el("div", { class: "ga-modal-resize ga-modal-resize-right", onmousedown: start(1) }),
    );
  }

  function focusables() {
    return overlay
      ? Array.from(overlay.querySelectorAll("button, textarea, a[href], [tabindex]")).filter(
          (el) => !el.disabled && el.offsetParent !== null,
        )
      : [];
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab" && overlay) {
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

  function close() {
    if (!overlay) return;
    if (endDrag) endDrag();
    if (detachFeed) {
      detachFeed();
      detachFeed = null;
    }
    overlay.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey, true);
    if (opener && opener.focus && opener.isConnected) opener.focus();
    opener = null;
    if (onClosedCb) {
      const cb = onClosedCb;
      onClosedCb = null;
      cb();
    }
  }

  return { open, close };
})();
