// thread-ui.js — one comment box (a single thread anchored to a highlight).
// Header has the snippet + a top-right loading spinner + expand/delete buttons.
// Supports multi-turn Q&A, Del/Backspace-to-delete with a Yes/No confirm,
// streaming model output, and markdown rendering.
var GA = GA || {};

// handlers: { ask(thread,{onChunk})->Promise<string>, persist(thread),
//             onDelete(thread), onFocus(thread), onExpand(thread), onResize() }
GA.ThreadBox = function (thread, handlers) {
  const state = { loading: false, collapsed: false };

  const root = GA.el("div", { class: "ga-box", tabindex: "0", dataset: { gaThread: thread.id } });

  // ---- header ----
  const snippet = GA.el("div", {
    class: "ga-box-snippet",
    title: thread.selector && thread.selector.exact,
    text: GA.truncate(thread.selector && thread.selector.exact, GA.config.SNIPPET_CHARS),
  });
  const spinner = GA.el("div", { class: "ga-spinner", title: "Waiting for a reply…" });
  const minimizeBtn = GA.el("button", {
    class: "ga-iconbtn ga-minbtn",
    title: "Minimize",
    text: "–",
    onclick: function (e) {
      e.stopPropagation();
      setCollapsed(!state.collapsed);
    },
  });
  const expandBtn = GA.el("button", {
    class: "ga-iconbtn",
    title: "Expand to full view",
    text: "⤢",
    onclick: function (e) {
      e.stopPropagation();
      handlers.onExpand && handlers.onExpand(thread);
    },
  });
  const delBtn = GA.el("button", {
    class: "ga-iconbtn",
    title: "Delete thread (Del)",
    text: "🗑",
    onclick: function (e) {
      e.stopPropagation();
      askDelete();
    },
  });
  const header = GA.el("div", { class: "ga-box-header" }, [
    snippet,
    GA.el("div", { class: "ga-box-actions" }, [spinner, minimizeBtn, expandBtn, delBtn]),
  ]);

  // ---- messages ----
  const messagesEl = GA.el("div", { class: "ga-messages" });

  // ---- composer ----
  const textarea = GA.el("textarea", {
    class: "ga-input",
    rows: "1",
    placeholder: "Ask a follow-up about the highlighted text…",
  });
  textarea.addEventListener("input", autosize);
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  const sendBtn = GA.el("button", { class: "ga-send", text: "Ask", onclick: submit });
  const composer = GA.el("div", { class: "ga-composer" }, [textarea, sendBtn]);

  // ---- delete confirm popover ----
  const confirmEl = GA.el("div", { class: "ga-confirm" }, [
    GA.el("span", { text: "Delete this thread?" }),
    GA.el("div", { class: "ga-confirm-actions" }, [
      GA.el("button", {
        class: "ga-confirm-yes",
        text: "Yes",
        onclick: function (e) {
          e.stopPropagation();
          handlers.onDelete && handlers.onDelete(thread);
        },
      }),
      GA.el("button", {
        class: "ga-confirm-no",
        text: "No",
        onclick: function (e) {
          e.stopPropagation();
          hideDelete();
        },
      }),
    ]),
  ]);

  root.appendChild(header);
  root.appendChild(messagesEl);
  root.appendChild(composer);
  root.appendChild(confirmEl);

  // Del/Backspace deletes — but only when the box (not the textarea) has focus.
  root.addEventListener("keydown", function (e) {
    if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement !== textarea) {
      e.preventDefault();
      askDelete();
    } else if (e.key === "Escape") {
      hideDelete();
    }
  });
  root.addEventListener("mousedown", function () {
    handlers.onFocus && handlers.onFocus(thread);
  });

  // render any existing history (restored threads)
  (thread.messages || []).forEach((m) => appendMessage(m.role, m.text));

  // restore a previously-minimized box (don't persist — nothing changed)
  if (thread.collapsed) setCollapsed(true, false);

  function autosize() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, GA.config.TEXTAREA_MAX_PX) + "px";
    handlers.onResize && handlers.onResize();
  }

  function appendMessage(role, text) {
    const el = GA.el("div", { class: "ga-msg ga-msg-" + role });
    if (role === "model") el.appendChild(GA.markdown.render(text));
    else el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function renderModelInto(el, text) {
    el.textContent = "";
    el.appendChild(GA.markdown.render(text));
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setLoading(v) {
    state.loading = v;
    root.classList.toggle("ga-loading", v);
    textarea.disabled = v;
    sendBtn.disabled = v;
  }

  // Minimized = a third window state: collapse the box to just its header.
  // (normal ⇄ minimized; the expand button still opens the full modal.)
  // `persist` is optional so the initial restore doesn't write back unchanged.
  function setCollapsed(v, persist) {
    state.collapsed = !!v;
    root.classList.toggle("ga-collapsed", state.collapsed);
    minimizeBtn.textContent = state.collapsed ? "▢" : "–";
    minimizeBtn.title = state.collapsed ? "Restore" : "Minimize";
    thread.collapsed = state.collapsed;
    if (persist !== false) handlers.persist && handlers.persist(thread);
    handlers.onResize && handlers.onResize();
  }

  function askDelete() {
    confirmEl.classList.add("ga-confirm-show");
  }
  function hideDelete() {
    confirmEl.classList.remove("ga-confirm-show");
  }

  // The turn orchestration lives in thread-turn.js; this just wires the view's
  // side effects to it.
  function submit() {
    const q = textarea.value.trim();
    if (!q || state.loading) return;
    textarea.value = "";
    autosize();

    // Coalesce streamed re-renders to at most one per animation frame. Each
    // render rebuilds the whole markdown subtree; a fast stream (e.g. Claude
    // bursts many chunks per frame) otherwise flickers and stutters.
    let pending = null;
    let frame = 0;
    function flush(el) {
      frame = 0;
      if (pending == null) return;
      renderModelInto(el, pending);
      pending = null;
    }
    GA.threadTurn
      .run(thread, q, {
        appendUser: (text) => appendMessage("user", text),
        beginModel: () => {
          const el = appendMessage("model", "");
          el.classList.add("ga-msg-streaming");
          return el;
        },
        renderModel: (el, text) => {
          pending = text;
          if (!frame) frame = requestAnimationFrame(() => flush(el));
        },
        endModel: (el) => {
          if (frame) cancelAnimationFrame(frame);
          flush(el); // guarantee the final text is rendered
          el.classList.remove("ga-msg-streaming");
        },
        setLoading: setLoading,
        ask: handlers.ask,
        persist: handlers.persist,
      })
      .then(() => handlers.onResize && handlers.onResize());
  }

  // public API used by the gutter / controller
  return {
    id: thread.id,
    thread,
    el: root,
    focusInput() {
      textarea.focus();
    },
    setActive(active) {
      root.classList.toggle("ga-active", !!active);
    },
    setDimmed(dim) {
      root.classList.toggle("ga-dimmed", !!dim);
    },
    setOrphan(orphan) {
      root.classList.toggle("ga-orphan", !!orphan);
      let badge = root.querySelector(".ga-orphan-badge");
      if (orphan && !badge) {
        badge = GA.el("div", { class: "ga-orphan-badge", text: "anchor lost" });
        header.appendChild(badge);
      } else if (!orphan && badge) {
        badge.remove();
      }
    },
    naturalHeight() {
      const prev = root.style.maxHeight;
      root.style.maxHeight = "none";
      const h = root.offsetHeight;
      root.style.maxHeight = prev;
      return h;
    },
    setMaxHeight(px) {
      messagesEl.style.maxHeight = px == null ? "" : Math.max(40, px) + "px";
    },
    destroy() {
      root.remove();
    },
  };
};
