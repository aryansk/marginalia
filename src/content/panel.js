// panel.js — the all-threads overview (Figma's comment sidebar, sized to our
// world): every thread in this conversation with open/resolved filters,
// click-to-jump for anchored threads, open-in-modal for the rest (orphans
// included), and reopen for resolved ones. Opened from the gutter's list
// button or Alt+Shift+A.
//
// The "All chats" tab (cross-conversation search + synthesis) lives in
// panel-global.js; this shell owns the chrome — tabs, the shared search row,
// the dialog lifecycle — and delegates that tab's body/footer to a per-open
// GA.panelGlobal instance.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.panel = (function () {
  let dlg = null; // current dialog handle (GA.dialog) — close() targets it
  let filter = "open"; // "open" | "resolved" | "all" | "global" — persists across opens
  // Per-open view state shared by the build/render helpers below:
  // { query, body, count, searchInput, clearBtn, typeSelect, footer, chats }.
  // Set in open(), nulled when the dialog closes, so a query never leaks into
  // the next open — unlike the deliberately persistent `filter`.
  let view = null;

  // ---- export for NotebookLM (T-012) ---------------------------------------
  // Decode + self-heal live in GA.convoRepair.loadDecoded (the system's sole
  // decompress site); this click handler only hands the decoded record plus
  // this conversation's threads to the pure Markdown builder and delivers via
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
      const decoded = await GA.convoRepair.loadDecoded(GA.getSessionId());
      if (!decoded) {
        // Friendly degrade — never a broken or empty download. (Capture only
        // runs on annotated conversations, hence the nudge.)
        GA.toast("No transcript captured yet — it fills in as you annotate this conversation.");
        return;
      }
      const md = GA.core.transcript.build(decoded, GA.threadController.threads());
      deliverDownload(md, exportFilename(decoded.title, decoded.provider));
      // Best-effort clipboard in its OWN catch — a denied clipboard must not
      // undo the already-successful download.
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(md);
          copied = true;
        }
      } catch (e) {}
      GA.toast(
        copied ? "Transcript downloaded and copied to clipboard." : "Transcript downloaded.",
      );
    } catch (e) {
      GA.warn("export failed", e);
      GA.toast("Export failed — couldn't build the transcript.");
    }
  }

  // ---- open-panel view (all helpers below read the module-level `view`) ----

  // Jump to a thread: anchored ones scroll into view in the margin; orphans
  // (and the no-gutter narrow viewport) open the modal instead.
  function goToThread(t) {
    close();
    const anchor = GA.selection.anchorEl(t.id);
    if (anchor && GA.gutter.mode() !== "hidden") {
      anchor.scrollIntoView({ block: "center", behavior: "smooth" });
      GA.gutter.setActive(t.id);
    } else {
      GA.threadController.expandThreadById(t.id);
    }
  }

  function renderThreadRow(t) {
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
            text: GA.truncate(t.selector && t.selector.exact, GA.config.PANEL_SNIPPET_CHARS),
          }),
          GA.el("div", { class: "ga-panel-question", text: GA.recordQuestionText(t) }),
        ]),
        GA.el("div", { class: "ga-panel-row-meta" }, [
          t.kind === "label" ? GA.labelGlyph({ on: true }) : null,
          !anchored && !t.resolved ? GA.detachedBadge("ga-panel-badge") : null,
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
                GA.icons.make("reopen"),
              )
            : null,
          GA.el("span", { class: "ga-panel-jump" }, GA.icons.make("jump")),
        ]),
      ],
    );
    row.addEventListener("click", () => goToThread(t));
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        goToThread(t);
      }
    });
    return row;
  }

  function renderList() {
    view.body.textContent = "";
    if (filter === "global") {
      view.chats.render(view.body);
      return;
    }
    const inTab = GA.threadController.threads().filter((t) => {
      if (filter === "open") return !t.resolved;
      if (filter === "resolved") return !!t.resolved;
      return true;
    });
    const threads = inTab.filter((t) => GA.core.threadSearch.matches(t, view.query));
    setCount(threads.length, inTab.length);
    if (!threads.length) {
      view.body.appendChild(
        GA.el("div", {
          class: "ga-modal-empty",
          text: view.query ? "No threads match your search." : "No threads here.",
        }),
      );
      return;
    }
    threads.forEach((t) => view.body.appendChild(renderThreadRow(t)));
  }

  // The "N of M" live search counter — shown only while a query is active.
  function setCount(shown, total) {
    if (view.query) {
      view.count.textContent = shown + " of " + total;
      view.count.classList.add("ga-panel-count-on");
    } else {
      view.count.textContent = "";
      view.count.classList.remove("ga-panel-count-on");
    }
  }

  function clearQuery() {
    view.query = "";
    view.searchInput.value = "";
    view.clearBtn.classList.remove("ga-panel-search-clear-on");
    renderList();
  }

  function buildTabs() {
    const tabs = GA.el("div", { class: "ga-panel-tabs" });
    [
      ["open", "Open"],
      ["resolved", "Resolved"],
      ["all", "All"],
      ["global", "All chats"],
    ].forEach(([key, label]) => {
      tabs.appendChild(
        GA.el("button", {
          class: "ga-panel-tab" + (filter === key ? " ga-panel-tab-on" : ""),
          text: label,
          // Active-tab bookkeeping keys off this, never off the rendered label
          // text (which is presentation and free to change).
          "data-filter": key,
          "aria-pressed": filter === key ? "true" : "false",
          onclick: function () {
            filter = key;
            updateChrome();
            renderList();
            Array.from(tabs.children).forEach((b) => {
              const on = b.dataset.filter === key;
              b.classList.toggle("ga-panel-tab-on", on);
              b.setAttribute("aria-pressed", on ? "true" : "false");
            });
          },
        }),
      );
    });
    return tabs;
  }

  // Search-row chrome that depends on the active tab: the type dropdown only
  // exists on All chats, and the search placeholder follows the mode.
  function updateChrome() {
    const global = filter === "global";
    view.typeSelect.classList.toggle("ga-panel-type-on", global);
    view.searchInput.placeholder = !global
      ? "Search threads…"
      : view.chats.state.type === "labels"
        ? "Search labels…"
        : "Search all threads…";
    view.chats.updateFooter();
  }

  function buildSearch() {
    view.typeSelect = GA.el(
      "select",
      { class: "ga-panel-type", "aria-label": "What to search across all chats" },
      [
        GA.el("option", { value: "threads", text: "Threads" }),
        GA.el("option", { value: "labels", text: "Labels" }),
      ],
    );
    view.typeSelect.addEventListener("change", function () {
      view.chats.setType(this.value);
      updateChrome();
      renderList();
    });
    view.searchInput = GA.el("input", {
      class: "ga-panel-search-input",
      type: "text",
      placeholder: "Search threads…",
      "aria-label": "Search threads by highlight or message text",
      oninput: function () {
        view.query = this.value.trim();
        view.clearBtn.classList.toggle("ga-panel-search-clear-on", !!this.value);
        renderList();
      },
    });
    view.clearBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn ga-panel-search-clear",
        type: "button",
        title: "Clear search",
        "aria-label": "Clear search",
        onclick: function () {
          clearQuery();
          view.searchInput.focus();
        },
      },
      GA.icons.make("close"),
    );
    view.count = GA.el("div", { class: "ga-panel-count", "aria-live": "polite" });
    return GA.el("div", { class: "ga-panel-search" }, [
      view.typeSelect,
      view.searchInput,
      view.clearBtn,
      view.count,
    ]);
  }

  // Coordinated header order (T-006 gear, T-012 export): closeBtn stays last
  // — it takes the dialog's initial focus.
  function buildHeader() {
    const title = GA.el("div", { class: "ga-modal-title", text: "Comment threads" });
    const closeBtn = GA.el(
      "button",
      { class: "ga-iconbtn", title: "Close (Esc)", "aria-label": "Close", onclick: close },
      GA.icons.make("close"),
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
      GA.icons.make("gear"),
    );
    const exportBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn",
        title: "Export for NotebookLM",
        "aria-label": "Export conversation for NotebookLM",
        onclick: exportConversation,
      },
      GA.icons.make("download"),
    );
    const header = GA.el("div", { class: "ga-modal-header" }, [
      title,
      buildTabs(),
      buildSearch(),
      exportBtn,
      gearBtn,
      closeBtn,
    ]);
    return { header: header, closeBtn: closeBtn };
  }

  // The All-chats instance's window into this shell: chrome state (active
  // tab, query, count display) plus the shared blob-download delivery.
  function makeChatsCtx() {
    return {
      isActive: () => filter === "global",
      query: () => view.query,
      setCount: setCount,
      // Unconditional clear — the labels picker has no meaningful "N of M"
      // even while a query is active.
      clearCount: () => {
        view.count.textContent = "";
        view.count.classList.remove("ga-panel-count-on");
      },
      requestRender: renderList,
      download: (md, base) => deliverDownload(md, exportFilename(base, GA.provider)),
    };
  }

  function open() {
    close();
    view = {
      query: "",
      body: null,
      count: null,
      searchInput: null,
      clearBtn: null,
      typeSelect: null,
      chats: null,
    };
    view.chats = GA.panelGlobal.create(makeChatsCtx());
    const built = buildHeader();
    view.body = GA.el("div", { class: "ga-modal-body ga-panel-body" });
    const footer = view.chats.buildFooter();
    updateChrome();
    renderList();

    const panelEl = GA.el("div", { class: "ga-modal ga-panel" }, [built.header, view.body, footer]);
    dlg = GA.dialog.open({
      label: "All comment threads",
      content: panelEl,
      initialFocus: built.closeBtn,
      // Escape inside a non-empty search box clears the query and keeps the
      // panel open; otherwise the dialog closes as usual. The veto must live
      // here (GA.dialog's keydown is capture-phase) so it fires before the
      // input's own handlers.
      onEscape: function () {
        if (document.activeElement === view.searchInput && view.searchInput.value.trim()) {
          clearQuery();
          return true; // vetoed — keep the panel open
        }
        return false;
      },
      onClose: function () {
        if (view && view.chats) view.chats.onClose(); // aborts any in-flight synthesis
        dlg = null;
        view = null;
      },
    });
  }

  function close() {
    if (dlg) dlg.close();
  }

  function toggle() {
    if (dlg) close();
    else open();
  }

  return { open, close, toggle };
})();
