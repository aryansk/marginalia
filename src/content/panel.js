// panel.js — the all-threads overview (Figma's comment sidebar, sized to our
// world): every thread in this conversation with open/resolved filters,
// click-to-jump for anchored threads, open-in-modal for the rest (orphans
// included), and reopen for resolved ones. Opened from the gutter's list
// button or Alt+Shift+A.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.panel = (function () {
  let overlay = null;
  let filter = "open"; // "open" | "resolved" | "all"
  // Set while the panel is open so the capture-phase onKey can decide, on
  // Escape, between clearing the search query and closing the panel. Reset in
  // close(). The `clear` closure lives in open() so it captures its query state.
  let activeSearch = null;

  function firstQuestion(thread) {
    const m = (thread.messages || []).find((x) => x.role === "user");
    return m ? m.text : "";
  }

  // ---- export for NotebookLM (T-012) ---------------------------------------
  // THE system's sole decompress site: capture, store and backup all carry
  // message blobs as opaque compressed strings; only this click handler ever
  // calls GA.core.compress.b64ToText. It loads the RAW convo record, inflates
  // each turn's blob by its "<hash>:<len>" key, hands the decoded record plus
  // this conversation's threads to the pure Markdown builder, and delivers via
  // a blob: download and a best-effort clipboard copy.

  // Download filename: "<sanitized title|provider>-YYYYMMDD.md". Keep only
  // [A-Za-z0-9_ -] so a captured <title> can't smuggle path separators or
  // shell metacharacters into the download attribute.
  function exportFilename(title, provider) {
    let base = String(title || "")
      .replace(/[^\w -]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60)
      .trim()
      .replace(/ /g, "-");
    if (!base) base = String(provider || "conversation");
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return base + "-" + ymd + ".md";
  }

  // Blob + temporary <a download> click. The md string only ever enters the
  // Blob (and the clipboard) — never innerHTML. The object URL is revoked in
  // finally so failure paths can't leak it either; the revoke is deferred one
  // tick because same-tick revocation right after click() is the historically
  // flaky pattern (old Firefox aborted the just-started download).
  function deliverDownload(md, filename) {
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    try {
      const a = GA.el("a", { href: url, download: filename });
      document.body.appendChild(a); // Firefox requires the anchor in the document
      a.click();
      a.remove();
    } finally {
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 0);
    }
  }

  // Whole body guarded: an unhandled rejection inside an onclick is silent,
  // and a failed export must always surface a toast instead.
  async function exportConversation() {
    try {
      const session = GA.getSessionId();
      const raw = session ? await GA.store.loadConvo(session) : null;
      const rawTurns = raw && Array.isArray(raw.turns) ? raw.turns : [];
      if (!rawTurns.length) {
        // Friendly degrade — never a broken or empty download. (Capture only
        // runs on annotated conversations, hence the nudge.)
        GA.toast("No transcript captured yet — it fills in as you annotate this conversation.");
        return;
      }
      const blobs =
        raw.blobs && typeof raw.blobs === "object" && !Array.isArray(raw.blobs) ? raw.blobs : {};
      const corrupt = [];
      const turns = [];
      for (const t of rawTurns) {
        const entry = t && typeof t === "object" ? t : {};
        const key = entry.fp ? entry.fp.hash + ":" + entry.fp.len : null;
        const blob = key != null && blobs[key] != null ? blobs[key] : null;
        let text = ""; // a missing blob degrades to an empty turn, never a throw
        if (blob != null) {
          try {
            text = await GA.core.compress.b64ToText(blob);
          } catch (e) {
            corrupt.push(key); // corrupt blob: degrade AND self-heal below
          }
        }
        turns.push({ role: entry.role, order: entry.order, fp: entry.fp, text: text });
      }
      // Fix F5 — self-heal: a blob that provably fails to inflate carries no
      // recoverable data, and capture skips keys that EXIST, so deleting the
      // entry is exactly what lets the next capture re-compress the message
      // from the live DOM. Best-effort in its own catch — a heal failure must
      // not block the export. Merely-MISSING blobs are never touched (nothing
      // to heal). The record is RE-LOADED right before the write: the
      // decompress loop above awaited for arbitrarily long, and a concurrent
      // capture may have re-written the record — saving our stale snapshot
      // would silently revert its freshly banked turns/blobs. The re-read
      // narrows that race to microtasks (storage.local has no transactions;
      // capture-vs-capture accepts the same residual window). A vanished or
      // malformed fresh record means there is nothing to heal — never write
      // the stale snapshot back.
      if (corrupt.length) {
        try {
          const fresh = await GA.store.loadConvo(session);
          const healable =
            fresh && fresh.blobs && typeof fresh.blobs === "object" && !Array.isArray(fresh.blobs);
          if (healable) {
            corrupt.forEach((k) => delete fresh.blobs[k]);
            await GA.store.saveConvo(session, fresh);
          }
        } catch (e) {
          GA.warn("transcript self-heal failed", e);
        }
      }
      const md = GA.core.transcript.build(
        {
          provider: raw.provider,
          id: raw.id,
          title: raw.title,
          url: raw.url,
          capturedAt: raw.capturedAt,
          turns: turns,
        },
        GA.threadController.threads()
      );
      deliverDownload(md, exportFilename(raw.title, raw.provider));
      // Best-effort clipboard in its OWN catch — a denied clipboard must not
      // undo the already-successful download.
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(md);
          copied = true;
        }
      } catch (e) {}
      GA.toast(copied ? "Transcript downloaded and copied to clipboard." : "Transcript downloaded.");
    } catch (e) {
      GA.warn("export failed", e);
      GA.toast("Export failed — couldn't build the transcript.");
    }
  }

  function open() {
    close();
    // Query state is local to open() so it resets every time the panel is
    // reopened — unlike the module-scoped, persistent `filter`.
    let query = "";
    overlay = GA.el("div", {
      class: "ga-modal-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "All comment threads",
    });

    const title = GA.el("div", { class: "ga-modal-title", text: "Comment threads" });
    const closeBtn = GA.el(
      "button",
      { class: "ga-iconbtn", title: "Close (Esc)", "aria-label": "Close", onclick: close },
      GA.icons.make("close")
    );
    // Content scripts can't call openOptionsPage directly — ask the background
    // (via MSG_OPEN_OPTIONS) to open it. Catch-guarded: a dead worker just no-ops.
    const gearBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn",
        title: "Settings",
        "aria-label": "Settings",
        onclick: function () {
          browser.runtime.sendMessage({ type: GA.protocol.MSG_OPEN_OPTIONS }).catch(function () {});
        },
      },
      GA.icons.make("gear")
    );
    const exportBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn",
        title: "Export for NotebookLM",
        "aria-label": "Export conversation for NotebookLM",
        onclick: exportConversation,
      },
      GA.icons.make("download")
    );
    const tabs = GA.el("div", { class: "ga-panel-tabs" });
    [
      ["open", "Open"],
      ["resolved", "Resolved"],
      ["all", "All"],
    ].forEach(([key, label]) => {
      tabs.appendChild(
        GA.el("button", {
          class: "ga-panel-tab" + (filter === key ? " ga-panel-tab-on" : ""),
          text: label,
          "aria-pressed": filter === key ? "true" : "false",
          onclick: function () {
            filter = key;
            renderList();
            Array.from(tabs.children).forEach((b) => {
              const on = b.textContent === label;
              b.classList.toggle("ga-panel-tab-on", on);
              b.setAttribute("aria-pressed", on ? "true" : "false");
            });
          },
        })
      );
    });
    const searchInput = GA.el("input", {
      class: "ga-panel-search-input",
      type: "text",
      placeholder: "Search threads…",
      "aria-label": "Search threads by highlight or message text",
      oninput: function () {
        query = this.value.trim();
        clearBtn.classList.toggle("ga-panel-search-clear-on", !!this.value);
        renderList();
      },
    });
    const clearBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn ga-panel-search-clear",
        type: "button",
        title: "Clear search",
        "aria-label": "Clear search",
        onclick: function () {
          clearQuery();
          searchInput.focus();
        },
      },
      GA.icons.make("close")
    );
    const count = GA.el("div", { class: "ga-panel-count", "aria-live": "polite" });
    const search = GA.el("div", { class: "ga-panel-search" }, [searchInput, clearBtn, count]);

    function clearQuery() {
      query = "";
      searchInput.value = "";
      clearBtn.classList.remove("ga-panel-search-clear-on");
      renderList();
    }

    // Coordinated header order (T-006 gear, T-012 export): closeBtn stays last
    // — it takes the initial focus below.
    const header = GA.el("div", { class: "ga-modal-header" }, [title, tabs, search, exportBtn, gearBtn, closeBtn]);
    const body = GA.el("div", { class: "ga-modal-body ga-panel-body" });

    function renderList() {
      body.textContent = "";
      const inTab = GA.threadController.threads().filter((t) => {
        if (filter === "open") return !t.resolved;
        if (filter === "resolved") return !!t.resolved;
        return true;
      });
      const threads = inTab.filter((t) => GA.core.threadSearch.matches(t, query));
      if (query) {
        count.textContent = threads.length + " of " + inTab.length;
        count.classList.add("ga-panel-count-on");
      } else {
        count.textContent = "";
        count.classList.remove("ga-panel-count-on");
      }
      if (!threads.length) {
        body.appendChild(
          GA.el("div", {
            class: "ga-modal-empty",
            text: query ? "No threads match your search." : "No threads here.",
          })
        );
        return;
      }
      threads.forEach((t) => {
        const anchored = !!GA.selection.anchorEl(t.id);
        const row = GA.el(
          "div",
          {
            class: "ga-panel-row" + (t.resolved ? " ga-panel-row-resolved" : ""),
            role: "button",
            tabindex: "0",
            "aria-label": "Thread: " + (t.selector && t.selector.exact),
          },
          [
            GA.el("div", { class: "ga-panel-row-main" }, [
              GA.el("div", {
                class: "ga-panel-snippet",
                text: GA.truncate(t.selector && t.selector.exact, 70),
              }),
              GA.el("div", {
                class: "ga-panel-question",
                text: GA.truncate(firstQuestion(t), 90) || "No messages yet.",
              }),
            ]),
            GA.el("div", { class: "ga-panel-row-meta" }, [
              !anchored && !t.resolved
                ? GA.el("span", {
                    class: "ga-panel-badge ga-tag",
                    text: "detached",
                    title: "The highlighted text no longer exists on the page",
                  })
                : null,
              t.resolved
                ? GA.el(
                    "button",
                    {
                      class: "ga-iconbtn",
                      title: "Reopen",
                      "aria-label": "Reopen thread",
                      onclick: function (e) {
                        e.stopPropagation();
                        const it = GA.gutter.get(t.id);
                        // reopen through the box so state/highlight stay in sync
                        if (it && it.box.setResolved) it.box.setResolved(false);
                        renderList();
                      },
                    },
                    GA.icons.make("reopen")
                  )
                : null,
              GA.el("span", { class: "ga-panel-jump" }, GA.icons.make("jump")),
            ]),
          ]
        );
        function go() {
          close();
          const anchor = GA.selection.anchorEl(t.id);
          if (anchor && GA.gutter.mode() !== "hidden") {
            anchor.scrollIntoView({ block: "center", behavior: "smooth" });
            GA.gutter.setActive(t.id);
          } else {
            GA.threadController.expandThreadById(t.id);
          }
        }
        row.addEventListener("click", go);
        row.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        });
        body.appendChild(row);
      });
    }
    renderList();

    const panelEl = GA.el("div", { class: "ga-modal ga-panel" }, [header, body]);
    overlay.appendChild(panelEl);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    activeSearch = { input: searchInput, clear: clearQuery };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    closeBtn.focus();
  }

  function onKey(e) {
    if (e.key !== "Escape") return;
    // Escape inside a non-empty search box clears the query and keeps the panel
    // open; otherwise it closes the panel. This decision must live here because
    // onKey is a capture-phase listener that fires before the input's handlers.
    if (activeSearch && document.activeElement === activeSearch.input && activeSearch.input.value.trim()) {
      e.stopPropagation();
      activeSearch.clear();
      return;
    }
    e.stopPropagation();
    close();
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    activeSearch = null;
    document.removeEventListener("keydown", onKey, true);
  }

  function toggle() {
    if (overlay) close();
    else open();
  }

  return { open, close, toggle };
})();
