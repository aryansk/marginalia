// modal.js — full-screen view of a single thread's conversation, with its own
// composer: you can keep asking follow-ups from the maximized view. The dialog
// lifecycle (overlay, focus trap, Esc, opener-focus restore) is the shared
// GA.dialog; this module keeps the modal-specific parts: header/body assembly,
// the edge drag-resize with session width memory, and the live-stream
// late-join. The docked box is refreshed by the controller's onClosed callback.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.Modal = (function () {
  let dlg = null; // current dialog handle — module close() targets it
  let sessionWidth = 0; // drag-resized width, remembered for this page session
  let endDrag = null; // active drag teardown (also run on close)
  let detachFeed = null; // live-stream unsubscribe (open-mid-stream case)

  // handlers: the thread's box handlers (ask/persist/onStop) — optional; the
  // composer is omitted when absent (read-only legacy behavior).
  function open(thread, handlers, onClosed) {
    close();

    const snippet = GA.truncate(
      thread.selector && thread.selector.exact,
      GA.config.MODAL_SNIPPET_CHARS,
    );
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
          // No Retry in the modal (deliberate): retrying re-runs the docked
          // box's turn machinery, which the modal only mirrors.
          el.appendChild(GA.errorCard(text));
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

    // Assigned once GA.dialog.open returns below; the stream hooks and the
    // late-join closure read it lazily, so "is this modal still open?" always
    // consults THIS open's dialog, not whichever one is current. While the
    // modal is still being assembled (myDlg not set yet) it counts as live —
    // the live-stream late-join seeds its bubble before the dialog exists.
    let myDlg = null;
    const isLive = () => !myDlg || myDlg.isOpen();

    // Composer: same turn orchestration as the docked box. The streaming
    // machine is the shared GA.StreamView; the modal deliberately passes no
    // announce/onFinish/onEnd hooks — it has no live region, unread dot or
    // chip count, and its error cards carry no Retry.
    let composer = null;
    let streamView = null;
    if (handlers && handlers.ask) {
      streamView = GA.StreamView({
        beginEl: () => appendMsg("model", ""),
        isLive: isLive,
        afterUpdate: () => {
          body.scrollTop = body.scrollHeight;
        },
        renderFinal: (el, text) => {
          el.textContent = "";
          el.appendChild(GA.markdown.render(text));
        },
        renderError: (el, message) => {
          el.textContent = "";
          el.appendChild(GA.errorCard(message));
        },
      });
      const ops = {
        appendUser: (text) => appendMsg("user", text),
        beginModel: () => streamView.beginModel(),
        renderModel: (el, text) => streamView.renderModel(el, text),
        renderError: (el, message) => streamView.renderError(el, message),
        endModel: (el) => streamView.endModel(el),
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
            if (!isLive()) return;
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
    myDlg = dlg = GA.dialog.open({
      label: "Comment thread: " + snippet,
      content: panel,
      initialFocus: composer ? composer.textarea : closeBtn,
      onClose: function () {
        if (endDrag) endDrag();
        if (detachFeed) {
          detachFeed();
          detachFeed = null;
        }
        if (streamView) streamView.cancel();
        if (dlg === myDlg) dlg = null;
        if (onClosed) onClosed();
      },
    });
    attachResize(panel, myDlg.overlay);
  }

  // Edge drag handles: the modal is flex-centered, so to keep the edge under
  // the cursor the width changes by 2*dx. Mouse events (not pointer) — no
  // capture needed, and they run in jsdom. Width clamps to
  // [MODAL_MIN_PX, MODAL_MAX_FRAC * viewport]; the result is remembered for
  // the rest of the page session only.
  function attachResize(panel, overlay) {
    function start(side) {
      return function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW =
          parseInt(panel.style.width, 10) ||
          panel.getBoundingClientRect().width ||
          GA.config.MODAL_FALLBACK_PX;
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
          overlay.classList.remove("ga-modal-resizing");
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

  function close() {
    if (dlg) dlg.close();
  }

  return { open, close };
})();
