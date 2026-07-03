// thread-ui.js — one comment box (a single thread anchored to a highlight).
// Header has the snippet + a top-right loading spinner + minimize/expand/
// resolve/delete buttons. Supports multi-turn Q&A, Del/Backspace-to-delete
// with a Yes/No confirm, streaming model output with a Stop button, error
// cards with Retry, per-reply copy, an unread dot, and markdown rendering.
var GA = GA || {};

// handlers: { ask(thread,{onChunk})->Promise<string>, persist(thread),
//             onDelete(thread), onFocus(thread), onExpand(thread),
//             onStop(thread), onResize() }
GA.ThreadBox = function (thread, handlers) {
  const state = { loading: false, collapsed: false, resolved: false, active: false, destroyed: false };

  // Streamed re-renders are coalesced to one per animation frame (a fast stream
  // otherwise flickers) and applied incrementally — only the changed markdown
  // blocks are rebuilt (markdown.makeStreamRenderer). Box-scoped so destroy()
  // can cancel a pending frame.
  const stream = { pending: null, frame: 0, renderer: null, lastText: null, errored: false };

  // Message element -> its markdown body / raw text (for copy) — kept out of
  // the DOM (no expando properties).
  const bodyOf = new WeakMap();
  const textOf = new WeakMap();

  // naturalHeight() is read every relayout for every box; measuring live forces
  // a reflow per box. Cache it and invalidate only when this box's content
  // actually changed (new message, stream growth, collapse, composer resize).
  let cachedNaturalHeight = null;
  function invalidateHeight() {
    cachedNaturalHeight = null;
  }

  const snippetText = GA.truncate(thread.selector && thread.selector.exact, GA.config.SNIPPET_CHARS);
  const root = GA.el("div", {
    class: "ga-box",
    tabindex: "0",
    role: "region",
    "aria-label": "Comment thread: " + snippetText,
    dataset: { gaThread: thread.id },
  });

  // Visually-hidden live region: announces reply lifecycle without re-reading
  // the streamed element (which is rebuilt too often to be a live region).
  const liveRegion = GA.el("div", { class: "ga-sr-only", "aria-live": "polite" });
  function announce(text) {
    liveRegion.textContent = "";
    liveRegion.textContent = text;
  }

  // ---- header ----
  const snippet = GA.el("div", {
    class: "ga-box-snippet",
    title: thread.selector && thread.selector.exact,
    text: snippetText,
  });
  const unreadDot = GA.el("span", { class: "ga-unread-dot", title: "New reply" });
  const chipCount = GA.el("span", { class: "ga-chip-count ga-count" });
  const spinner = GA.el("div", {
    class: "ga-spinner",
    role: "status",
    title: "Waiting for a reply…",
    "aria-label": "Waiting for a reply",
  });
  const minimizeBtn = GA.el(
    "button",
    {
      class: "ga-iconbtn ga-minbtn",
      title: "Minimize",
      "aria-label": "Minimize thread",
      "aria-pressed": "false",
      onclick: function (e) {
        e.stopPropagation();
        setCollapsed(!state.collapsed);
      },
    },
    GA.icons.make("minimize")
  );
  const expandBtn = GA.el(
    "button",
    {
      class: "ga-iconbtn",
      title: "Expand to full view",
      "aria-label": "Expand thread to full view",
      onclick: function (e) {
        e.stopPropagation();
        handlers.onExpand && handlers.onExpand(thread);
      },
    },
    GA.icons.make("expand")
  );
  const resolveBtn = GA.el(
    "button",
    {
      class: "ga-iconbtn ga-resolvebtn",
      title: "Resolve thread",
      "aria-label": "Resolve thread",
      onclick: function (e) {
        e.stopPropagation();
        setResolved(true);
      },
    },
    GA.icons.make("resolve")
  );
  const delBtn = GA.el(
    "button",
    {
      class: "ga-iconbtn",
      title: "Delete thread (Del)",
      "aria-label": "Delete thread",
      onclick: function (e) {
        e.stopPropagation();
        askDelete();
      },
    },
    GA.icons.make("trash")
  );
  const header = GA.el("div", { class: "ga-box-header" }, [
    unreadDot,
    snippet,
    chipCount,
    GA.el("div", { class: "ga-box-actions" }, [spinner, minimizeBtn, expandBtn, resolveBtn, delBtn]),
  ]);
  // A collapsed box is a chip — clicking it (not its buttons) restores it.
  // In the narrow-viewport rail every box is a chip; there's no room to expand
  // in place, so the click opens the modal instead.
  header.addEventListener("click", function (e) {
    if (e.target.closest(".ga-iconbtn")) return;
    if (root.closest(".ga-gutter.ga-rail")) {
      handlers.onExpand && handlers.onExpand(thread);
      return;
    }
    if (!state.collapsed) return;
    setCollapsed(false);
  });

  // ---- messages ----
  // role=log: screen readers announce additions without re-reading the whole
  // area (the streamed element itself is rebuilt too often to be a live region).
  const messagesEl = GA.el("div", { class: "ga-messages", role: "log", "aria-label": "Messages" });

  // Smart auto-scroll: only stick to the bottom while the user IS at the
  // bottom — scrolling up to re-read must not be yanked back down mid-stream.
  const STICK_SLACK_PX = 32;
  let stick = true;
  messagesEl.addEventListener("scroll", function () {
    stick = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < STICK_SLACK_PX;
  });

  // ---- composer ----
  const textarea = GA.el("textarea", {
    class: "ga-input",
    rows: "1",
    placeholder: "Ask a follow-up about the highlighted text…",
    "aria-label": "Ask a follow-up about the highlighted text",
  });
  textarea.addEventListener("input", autosize);
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  // One button, two jobs: Ask normally; Stop while a reply is streaming.
  const sendBtn = GA.el("button", {
    class: "ga-send",
    text: "Ask",
    "aria-label": "Send question",
    onclick: function () {
      if (state.loading) handlers.onStop && handlers.onStop(thread);
      else submit();
    },
  });
  const composer = GA.el("div", { class: "ga-composer" }, [textarea, sendBtn]);

  // ---- resolved footer (replaces the composer while resolved) ----
  const reopenBar = GA.el("div", { class: "ga-reopen-bar" }, [
    GA.el("span", { class: "ga-reopen-note", text: "Resolved" }),
    GA.el(
      "button",
      {
        class: "ga-iconbtn ga-reopen-btn",
        title: "Reopen thread",
        "aria-label": "Reopen thread",
        onclick: function (e) {
          e.stopPropagation();
          setResolved(false);
        },
      },
      GA.icons.make("reopen")
    ),
  ]);

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

  root.appendChild(liveRegion);
  root.appendChild(header);
  root.appendChild(messagesEl);
  root.appendChild(composer);
  root.appendChild(reopenBar);
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
  // Hover linking: hovering the box intensifies its highlight in the page.
  root.addEventListener("mouseenter", function () {
    GA.selection.setHighlightHover(thread.id, true);
  });
  root.addEventListener("mouseleave", function () {
    GA.selection.setHighlightHover(thread.id, false);
  });

  // render any existing history (restored threads)
  (thread.messages || []).forEach((m) => appendMessage(m.role, m.text, m));
  updateChipCount();

  // restore persisted view state (don't persist — nothing changed)
  if (thread.collapsed) setCollapsed(true, false);
  if (thread.resolved) setResolved(true, false);
  if (thread.unread) setUnread(true, false);

  function autosize() {
    if (state.destroyed) return;
    const prev = textarea.style.height;
    textarea.style.height = "auto";
    const next = Math.min(textarea.scrollHeight, GA.config.TEXTAREA_MAX_PX) + "px";
    textarea.style.height = next;
    // Relayout measures every box — only ask for one when the height changed.
    if (next !== prev) {
      invalidateHeight();
      handlers.onResize && handlers.onResize();
    }
  }

  function updateChipCount() {
    const n = (thread.messages || []).length;
    chipCount.textContent = n ? String(n) : "";
  }

  // meta (optional) is the stored message record — error messages render as a
  // retry card instead of a fake model reply.
  function appendMessage(role, text, meta) {
    const el = GA.el("div", { class: "ga-msg ga-msg-" + role });
    if (role === "model") {
      const body = GA.el("div", { class: "ga-msg-body" });
      bodyOf.set(el, body);
      el.appendChild(body);
      if (meta && meta.error) {
        renderErrorInto(el, text);
      } else {
        body.appendChild(GA.markdown.render(text));
        textOf.set(el, text);
        if (text) addCopyAction(el);
      }
    } else {
      el.textContent = text;
    }
    if (state.destroyed) return el; // caller keeps a handle; nothing to show
    messagesEl.appendChild(el);
    invalidateHeight();
    updateChipCount();
    scrollToBottom(role === "user"); // sending your own message re-sticks
    return el;
  }

  function renderModelInto(el, text) {
    if (state.destroyed) return;
    const body = bodyOf.get(el) || el;
    body.textContent = "";
    body.appendChild(GA.markdown.render(text));
    textOf.set(el, text);
    invalidateHeight();
    scrollToBottom();
  }

  // Failure card: message + Retry (the question stays in the thread, so retry
  // never means retyping).
  function renderErrorInto(el, message) {
    if (state.destroyed) return;
    const body = bodyOf.get(el) || el;
    body.textContent = "";
    const retryBtn = GA.el(
      "button",
      {
        class: "ga-retry-btn",
        "aria-label": "Retry question",
        onclick: function (e) {
          e.stopPropagation();
          retryTurn(el);
        },
      },
      [GA.icons.make("retry"), "Retry"]
    );
    body.appendChild(
      GA.el("div", { class: "ga-error-card" }, [
        GA.el("span", { class: "ga-error-icon" }, GA.icons.make("alert")),
        GA.el("span", { class: "ga-error-text", text: message }),
        retryBtn,
      ])
    );
    invalidateHeight();
    scrollToBottom();
  }

  // Hover-revealed copy button on a finished model reply (copies raw markdown).
  function addCopyAction(el) {
    if (el.querySelector(".ga-msg-actions")) return;
    const copyBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn ga-msg-copy",
        title: "Copy reply",
        "aria-label": "Copy reply",
        onclick: function (e) {
          e.stopPropagation();
          GA.copyText(textOf.get(el) || "");
          GA.icons.swap(copyBtn, "check");
          setTimeout(() => !state.destroyed && GA.icons.swap(copyBtn, "copy"), 1500);
        },
      },
      GA.icons.make("copy")
    );
    el.appendChild(GA.el("div", { class: "ga-msg-actions" }, copyBtn));
  }

  function scrollToBottom(force) {
    if (force) stick = true;
    if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setLoading(v) {
    if (state.destroyed) return;
    state.loading = v;
    root.classList.toggle("ga-loading", v);
    textarea.disabled = v;
    // While streaming the send button becomes Stop (never disabled).
    sendBtn.classList.toggle("ga-stop", v);
    sendBtn.textContent = "";
    if (v) {
      sendBtn.appendChild(GA.icons.make("stop"));
      sendBtn.appendChild(document.createTextNode("Stop"));
      sendBtn.setAttribute("aria-label", "Stop generating");
    } else {
      sendBtn.appendChild(document.createTextNode("Ask"));
      sendBtn.setAttribute("aria-label", "Send question");
    }
  }

  function setUnread(v, persist) {
    const on = !!v;
    if (!!thread.unread === on && persist !== false) return;
    thread.unread = on;
    root.classList.toggle("ga-unread", on);
    if (persist !== false) handlers.persist && handlers.persist(thread);
  }

  // Minimized = a compact chip (icon-ish pill with snippet + count); the box
  // restores on click. `persist` is optional so the initial restore doesn't
  // write back unchanged.
  function setCollapsed(v, persist) {
    state.collapsed = !!v;
    root.classList.toggle("ga-collapsed", state.collapsed);
    GA.icons.swap(minimizeBtn, state.collapsed ? "restore" : "minimize");
    minimizeBtn.title = state.collapsed ? "Restore" : "Minimize";
    minimizeBtn.setAttribute("aria-label", state.collapsed ? "Restore thread" : "Minimize thread");
    minimizeBtn.setAttribute("aria-pressed", state.collapsed ? "true" : "false");
    thread.collapsed = state.collapsed;
    if (!state.collapsed) setUnread(false, persist);
    invalidateHeight();
    if (persist !== false) handlers.persist && handlers.persist(thread);
    // A collapse/restore is a discrete jump — worth easing the reflow.
    handlers.onResize && handlers.onResize({ animate: true });
  }

  // Resolved = archived-but-restorable: collapses to a muted chip, fades the
  // highlight, swaps the composer for a Reopen bar. Distinct from delete.
  function setResolved(v, persist) {
    state.resolved = !!v;
    root.classList.toggle("ga-resolved", state.resolved);
    thread.resolved = state.resolved;
    if (state.resolved) thread.resolvedAt = Date.now();
    else delete thread.resolvedAt;
    GA.selection.setHighlightState(thread.id, state.resolved ? "resolved" : state.active ? "active" : null);
    // Resolving tucks the thread away; reopening brings it back expanded.
    setCollapsed(state.resolved, persist);
  }

  function askDelete() {
    confirmEl.classList.add("ga-confirm-show");
  }
  function hideDelete() {
    confirmEl.classList.remove("ga-confirm-show");
  }

  // ---- turn wiring (orchestration lives in thread-turn.js) ----

  function flush(el) {
    stream.frame = 0;
    if (stream.pending == null) return;
    stream.lastText = stream.pending;
    stream.pending = null;
    if (stream.renderer && !state.destroyed && !stream.errored) {
      stream.renderer.update(stream.lastText);
      invalidateHeight();
      scrollToBottom();
    }
  }

  function makeTurnOps() {
    return {
      appendUser: (text) => appendMessage("user", text),
      beginModel: () => {
        const el = appendMessage("model", "");
        el.classList.add("ga-msg-streaming");
        el.setAttribute("aria-busy", "true");
        stream.renderer = GA.markdown.makeStreamRenderer(bodyOf.get(el) || el);
        stream.lastText = null;
        stream.errored = false;
        announce("Reply started");
        return el;
      },
      renderModel: (el, text) => {
        stream.pending = text;
        if (!stream.frame) stream.frame = requestAnimationFrame(() => flush(el));
      },
      renderError: (el, message) => {
        if (stream.frame) cancelAnimationFrame(stream.frame);
        stream.frame = 0;
        stream.pending = null;
        stream.errored = true;
        renderErrorInto(el, message);
        announce("Reply failed: " + message);
      },
      endModel: (el) => {
        if (stream.frame) cancelAnimationFrame(stream.frame);
        stream.frame = 0;
        const finalText = stream.pending != null ? stream.pending : stream.lastText;
        stream.pending = null;
        stream.renderer = null;
        // One clean full rebuild so the displayed result is exactly the
        // one-shot render of the final text (skipped when an error card took
        // over the message).
        if (!stream.errored) {
          if (finalText != null) renderModelInto(el, finalText);
          if (finalText) {
            addCopyAction(el);
            announce("Reply finished");
          }
        }
        el.classList.remove("ga-msg-streaming");
        el.removeAttribute("aria-busy");
        updateChipCount();
        // A reply landing in an unfocused/minimized thread gets an unread dot.
        if (!state.destroyed && !stream.errored && finalText && (state.collapsed || !state.active))
          setUnread(true);
      },
      setLoading: setLoading,
      ask: handlers.ask,
      persist: handlers.persist,
    };
  }

  function submit() {
    const q = textarea.value.trim();
    if (!q || state.loading) return;
    textarea.value = "";
    autosize();
    GA.threadTurn
      .run(thread, q, makeTurnOps())
      .then(() => !state.destroyed && handlers.onResize && handlers.onResize());
  }

  function retryTurn(errorEl) {
    if (state.loading || state.destroyed) return;
    errorEl.remove(); // the error message record is popped by threadTurn.retry
    invalidateHeight();
    GA.threadTurn
      .retry(thread, makeTurnOps())
      .then(() => !state.destroyed && handlers.onResize && handlers.onResize());
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
      state.active = !!active;
      root.classList.toggle("ga-active", state.active);
      if (state.active) setUnread(false);
    },
    setDimmed(dim) {
      root.classList.toggle("ga-dimmed", !!dim);
    },
    isCompact() {
      return state.collapsed;
    },
    setCollapsed(v) {
      setCollapsed(v);
    },
    setResolved(v) {
      setResolved(v);
    },
    // Re-render the whole history from thread.messages — used after a modal
    // session added turns the docked box hasn't seen.
    refreshMessages() {
      if (state.destroyed) return;
      messagesEl.textContent = "";
      (thread.messages || []).forEach((m) => appendMessage(m.role, m.text, m));
      updateChipCount();
      invalidateHeight();
    },
    setOrphan(orphan) {
      root.classList.toggle("ga-orphan", !!orphan);
      let badge = root.querySelector(".ga-orphan-badge");
      if (orphan && !badge) {
        badge = GA.el("div", {
          class: "ga-orphan-badge ga-tag",
          text: "detached",
          title: "The highlighted text no longer exists on the page",
        });
        header.insertBefore(badge, snippet);
        invalidateHeight();
      } else if (!orphan && badge) {
        badge.remove();
        invalidateHeight();
      }
    },
    // Height the box would take unconstrained: current height minus the
    // (possibly clamped) messages viewport plus the messages' full scroll
    // height. Pure reads — no style write/restore, so measuring N boxes in the
    // relayout read phase doesn't force N reflows.
    naturalHeight() {
      if (cachedNaturalHeight == null)
        cachedNaturalHeight = root.offsetHeight - messagesEl.clientHeight + messagesEl.scrollHeight;
      return cachedNaturalHeight;
    },
    invalidateHeight,
    setMaxHeight(px) {
      const next = px == null ? "" : Math.max(40, px) + "px";
      if (messagesEl.style.maxHeight !== next) messagesEl.style.maxHeight = next;
    },
    destroy() {
      state.destroyed = true;
      if (stream.frame) {
        cancelAnimationFrame(stream.frame);
        stream.frame = 0;
      }
      stream.pending = null;
      stream.renderer = null;
      root.remove();
    },
  };
};
