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

    const header = GA.el("div", { class: "ga-modal-header" }, [title, tabs, search, closeBtn]);
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
