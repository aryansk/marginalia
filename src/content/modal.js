// modal.js — full-screen, scrollable view of a single thread's conversation.
var GA = GA || {};

GA.Modal = (function () {
  let overlay = null;

  function open(thread) {
    close();
    overlay = GA.el("div", { class: "ga-modal-overlay" });

    const title = GA.el("div", {
      class: "ga-modal-title",
      text: GA.truncate(thread.selector && thread.selector.exact, 120),
      title: thread.selector && thread.selector.exact,
    });
    const closeBtn = GA.el("button", {
      class: "ga-iconbtn ga-modal-close",
      text: "✕",
      title: "Close (Esc)",
      onclick: close,
    });
    const header = GA.el("div", { class: "ga-modal-header" }, [title, closeBtn]);

    const body = GA.el("div", { class: "ga-modal-body" });
    (thread.messages || []).forEach(function (m) {
      const el = GA.el("div", { class: "ga-msg ga-msg-" + m.role });
      if (m.role === "model") el.appendChild(GA.markdown.render(m.text));
      else el.textContent = m.text;
      body.appendChild(el);
    });
    if (!thread.messages || !thread.messages.length) {
      body.appendChild(GA.el("div", { class: "ga-modal-empty", text: "No messages yet." }));
    }

    const panel = GA.el("div", { class: "ga-modal" }, [header, body]);
    overlay.appendChild(panel);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  function close() {
    if (overlay) {
      overlay.remove();
      overlay = null;
      document.removeEventListener("keydown", onKey, true);
    }
  }

  return { open, close };
})();
