// panel.js — the all-threads overview (Figma's comment sidebar, sized to our
// world): every thread in this conversation with open/resolved filters,
// click-to-jump for anchored threads, open-in-modal for the rest (orphans
// included), and reopen for resolved ones. Opened from the gutter's list
// button or Alt+Shift+A.
//
// The "All chats" tab widens the lens across EVERY stored conversation:
// search threads or pick labels (namespace-grouped), curate a selection, then
// prompt the active provider over the bundled items (core/bundle-prompt) with
// the output streaming into the panel — exportable as Markdown or carried
// into a fresh chat via clipboard.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.panel = (function () {
  let dlg = null; // current dialog handle (GA.dialog) — close() targets it
  let filter = "open"; // "open" | "resolved" | "all" | "global" — persists across opens
  // Per-open view state shared by the build/render helpers below:
  // { query, body, count, searchInput, clearBtn, typeSelect, footer, …, g }.
  // Set in open(), nulled when the dialog closes, so a query never leaks into
  // the next open — unlike the deliberately persistent `filter`.
  let view = null;

  // Per-open state of the All-chats tab. Buckets and convo records are cached
  // for the duration of one panel open (fetched lazily on first entry);
  // nothing here outlives the dialog, so stale storage is re-read next open.
  function makeGlobalState() {
    return {
      type: "threads", // "threads" | "labels" — the search-type dropdown
      buckets: null, // null until the first listThreadBuckets resolves
      loading: null,
      rawConvos: new Map(), // session -> Promise<raw ga:convo record|null>
      decoded: new Map(), // session -> Promise<decoded convo|null> (fallback only)
      titles: new Map(), // session -> Promise<display title>
      sel: new Map(), // threads mode: record id -> { session, record }
      selLabels: new Set(), // labels mode: picked labels
      excluded: new Set(), // labels mode: curated-out record ids
      askHandle: null, // in-flight synthesis ask (stop/abort)
      cancelStream: null, // drop pending stream frames on close
      instruction: "",
      output: "", // settled model output (enables the action buttons)
      sources: [], // provenance for the downloaded doc
    };
  }

  function firstQuestion(thread) {
    const m = (thread.messages || []).find((x) => x.role === "user");
    return m ? m.text : "";
  }

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

  function renderRow(t) {
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
          GA.el("div", {
            class: "ga-panel-question",
            text:
              t.kind === "label"
                ? "Label" + (t.labels && t.labels.length ? ": " + t.labels.join(", ") : "")
                : GA.truncate(firstQuestion(t), GA.config.PANEL_QUESTION_CHARS) ||
                  "No messages yet.",
          }),
        ]),
        GA.el("div", { class: "ga-panel-row-meta" }, [
          t.kind === "label"
            ? GA.el(
                "span",
                { class: "ga-label-glyph ga-label-glyph-on", title: "Label" },
                GA.icons.make("tag"),
              )
            : null,
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
      renderGlobal();
      return;
    }
    const inTab = GA.threadController.threads().filter((t) => {
      if (filter === "open") return !t.resolved;
      if (filter === "resolved") return !!t.resolved;
      return true;
    });
    const threads = inTab.filter((t) => GA.core.threadSearch.matches(t, view.query));
    if (view.query) {
      view.count.textContent = threads.length + " of " + inTab.length;
      view.count.classList.add("ga-panel-count-on");
    } else {
      view.count.textContent = "";
      view.count.classList.remove("ga-panel-count-on");
    }
    if (!threads.length) {
      view.body.appendChild(
        GA.el("div", {
          class: "ga-modal-empty",
          text: view.query ? "No threads match your search." : "No threads here.",
        }),
      );
      return;
    }
    threads.forEach((t) => view.body.appendChild(renderRow(t)));
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
      : view.g.type === "labels"
        ? "Search labels…"
        : "Search all threads…";
    updateFooter();
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
      view.g.type = this.value;
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

  // ---- All chats (cross-conversation search + synthesis) -------------------

  function ensureBuckets() {
    const g = view.g;
    if (g.loading) return;
    g.loading = GA.store
      .listThreadBuckets()
      .catch((e) => {
        GA.warn("bucket listing failed", e);
        return [];
      })
      .then((buckets) => {
        // The dialog may have closed (or reopened with fresh state) meanwhile.
        if (view && view.g === g) {
          g.buckets = buckets;
          renderList();
        }
      });
  }

  // Per-open memos. Raw records are cheap (blobs stay compressed and are only
  // sliced per-fingerprint by bundle-prompt); the whole-conversation decode is
  // the fingerprint-miss fallback and runs at most once per session per open.
  function rawConvoFor(session) {
    const g = view.g;
    if (!g.rawConvos.has(session)) {
      g.rawConvos.set(
        session,
        GA.store.loadConvo(session).catch(() => null),
      );
    }
    return g.rawConvos.get(session);
  }

  function decodedFor(session) {
    const g = view.g;
    if (!g.decoded.has(session)) {
      g.decoded.set(
        session,
        GA.convoRepair.loadDecoded(session).catch(() => null),
      );
    }
    return g.decoded.get(session);
  }

  function titleFor(session) {
    const g = view.g;
    if (!g.titles.has(session)) {
      g.titles.set(
        session,
        rawConvoFor(session).then((raw) => {
          if (raw && raw.title) return String(raw.title);
          const provider = String(session).split(":")[0];
          return GA.core.sites.providerLabel(provider) || provider;
        }),
      );
    }
    return g.titles.get(session);
  }

  // The curated selection, by mode: explicit picks (threads) or every
  // label-matched item minus explicit unchecks (labels).
  function selectedItems() {
    const g = view.g;
    if (g.type === "threads") return Array.from(g.sel.values());
    return GA.core.globalSearch
      .filterByLabels(g.buckets || [], Array.from(g.selLabels))
      .filter((it) => !g.excluded.has(it.record.id));
  }

  function convoBadge(session) {
    const el = GA.el("span", {
      class: "ga-panel-badge ga-tag ga-panel-row-convo",
      text: String(session).split(":")[0],
    });
    titleFor(session).then((t) => {
      if (t && el.isConnected) {
        el.textContent = GA.truncate(t, GA.config.PANEL_SNIPPET_CHARS);
        el.title = t;
      }
    });
    return el;
  }

  // Checkbox row shared by both modes. Clicking anywhere toggles; the checkbox
  // itself stays keyboard/screen-reader reachable.
  function selectRow(opts) {
    const box = GA.el("input", {
      type: "checkbox",
      class: "ga-panel-check",
      "aria-label": opts.label,
    });
    box.checked = !!opts.checked;
    box.addEventListener("click", (e) => e.stopPropagation());
    box.addEventListener("change", () => opts.onToggle(box.checked));
    const row = GA.el("div", { class: "ga-panel-row ga-panel-row-select" }, [
      box,
      GA.el("div", { class: "ga-panel-row-main" }, opts.main),
      GA.el("div", { class: "ga-panel-row-meta" }, opts.meta || []),
    ]);
    row.addEventListener("click", function (e) {
      if (e.target === box) return;
      box.checked = !box.checked;
      opts.onToggle(box.checked);
    });
    return row;
  }

  function itemRow(hit, checked, onToggle) {
    const t = hit.record;
    const isLabel = t.kind === "label";
    const main = [
      GA.el("div", { class: "ga-panel-snippet" }, [
        isLabel
          ? GA.el("span", { class: "ga-label-glyph ga-label-glyph-on" }, GA.icons.make("tag"))
          : null,
        GA.el("span", {
          text: GA.truncate(t.selector && t.selector.exact, GA.config.PANEL_SNIPPET_CHARS),
        }),
      ]),
      GA.el("div", {
        class: "ga-panel-question",
        text: isLabel
          ? "Labeled answer" + (t.labels && t.labels.length ? ": " + t.labels.join(", ") : "")
          : GA.truncate(firstQuestion(t), GA.config.PANEL_QUESTION_CHARS) || "No messages yet.",
      }),
    ];
    return selectRow({
      checked,
      onToggle,
      label: (isLabel ? "Labeled answer: " : "Thread: ") + (t.selector && t.selector.exact),
      main,
      meta: [convoBadge(hit.session)],
    });
  }

  function renderGlobal() {
    const g = view.g;
    updateFooter();
    if (!g.buckets) {
      view.body.appendChild(GA.el("div", { class: "ga-modal-empty", text: "Loading…" }));
      ensureBuckets();
      return;
    }
    if (g.type === "threads") renderGlobalThreads(g);
    else renderGlobalLabels(g);
  }

  function renderGlobalThreads(g) {
    const hits = GA.core.globalSearch.searchThreads(g.buckets, view.query);
    const total = GA.core.globalSearch.searchThreads(g.buckets, "").length;
    if (view.query) {
      view.count.textContent = hits.length + " of " + total;
      view.count.classList.add("ga-panel-count-on");
    } else {
      view.count.textContent = "";
      view.count.classList.remove("ga-panel-count-on");
    }
    if (!hits.length) {
      view.body.appendChild(
        GA.el("div", {
          class: "ga-modal-empty",
          text: view.query
            ? "No threads match your search."
            : "No threads in any conversation yet.",
        }),
      );
      return;
    }
    hits.forEach((hit) => {
      view.body.appendChild(
        itemRow(hit, g.sel.has(hit.record.id), (on) => {
          if (on) g.sel.set(hit.record.id, hit);
          else g.sel.delete(hit.record.id);
          updateFooter();
        }),
      );
    });
  }

  function renderGlobalLabels(g) {
    view.count.textContent = "";
    view.count.classList.remove("ga-panel-count-on");
    const labels = GA.core.globalSearch
      .collectLabels(g.buckets)
      .filter((l) => GA.core.labels.searchMatch(l, view.query));
    if (!labels.length) {
      view.body.appendChild(
        GA.el("div", {
          class: "ga-modal-empty",
          text: view.query
            ? "No labels match your search."
            : 'No labels yet — type /label "name" in any thread.',
        }),
      );
      return;
    }
    GA.core.labels.groupByNamespace(labels).forEach((group) => {
      view.body.appendChild(GA.el("div", { class: "ga-panel-group", text: group.ns || "labels" }));
      group.labels.forEach((l) => {
        view.body.appendChild(
          selectRow({
            checked: g.selLabels.has(l),
            label: "Label " + l,
            main: [GA.el("span", { class: "ga-label-pill", text: l })],
            onToggle: (on) => {
              if (on) g.selLabels.add(l);
              else g.selLabels.delete(l);
              renderList(); // matched items below follow the picker
            },
          }),
        );
      });
    });
    if (g.selLabels.size) {
      const matched = GA.core.globalSearch.filterByLabels(g.buckets, Array.from(g.selLabels));
      view.body.appendChild(
        GA.el("div", { class: "ga-panel-group", text: "Matched items — curate the bundle" }),
      );
      if (!matched.length) {
        view.body.appendChild(
          GA.el("div", { class: "ga-modal-empty", text: "Nothing carries the selected labels." }),
        );
      }
      matched.forEach((hit) => {
        view.body.appendChild(
          itemRow(hit, !g.excluded.has(hit.record.id), (on) => {
            if (on) g.excluded.delete(hit.record.id);
            else g.excluded.add(hit.record.id);
            updateFooter();
          }),
        );
      });
    }
  }

  // ---- synthesis footer (prompt bar, streamed output, output actions) ------

  function buildFooter() {
    view.selCount = GA.el("div", { class: "ga-panel-selcount", "aria-live": "polite" });
    view.outputEl = GA.el("div", { class: "ga-panel-output", role: "log", "aria-label": "Output" });
    const startBtn = GA.el("button", { class: "ga-panel-action", onclick: startConversation }, [
      GA.icons.make("jump"),
      "Start a conversation",
    ]);
    const downloadBtn = GA.el("button", { class: "ga-panel-action", onclick: downloadOutput }, [
      GA.icons.make("download"),
      "Download as md",
    ]);
    view.actionsEl = GA.el("div", { class: "ga-panel-output-actions" }, [startBtn, downloadBtn]);
    view.promptComposer = GA.Composer({
      placeholder: "Summarize, extract patterns… (runs on the selected items)",
      ariaLabel: "Prompt to run across the selected items",
      onSubmit: runSynthesis,
      onStop: () => view.g.askHandle && view.g.askHandle.stop(),
    });
    view.footer = GA.el("div", { class: "ga-panel-foot" }, [
      view.selCount,
      view.outputEl,
      view.actionsEl,
      view.promptComposer.el,
    ]);
    return view.footer;
  }

  function updateFooter() {
    if (!view || !view.footer) return;
    const g = view.g;
    const items = filter === "global" && g.buckets ? selectedItems() : [];
    const busy = !!g.askHandle;
    const show = filter === "global" && (items.length > 0 || busy || !!g.output);
    view.footer.classList.toggle("ga-panel-foot-on", show);
    view.selCount.textContent = items.length
      ? items.length + (items.length === 1 ? " item" : " items") + " selected"
      : "";
    view.actionsEl.classList.toggle("ga-panel-output-actions-on", !!g.output && !busy);
  }

  async function bundleItem(hit) {
    const record = hit.record;
    const title = await titleFor(hit.session);
    if (record.kind !== "label") {
      return {
        kind: "thread",
        title,
        labels: record.labels,
        snippet: record.selector && record.selector.exact,
        content: GA.core.bundlePrompt.threadContent(record),
      };
    }
    // Selective decode first (one blob), whole-conversation decode on a
    // fingerprint miss, stored section text as the never-fail floor.
    let text = await GA.core.bundlePrompt.resolveTurn(await rawConvoFor(hit.session), record);
    if (text == null) {
      const decoded = await decodedFor(hit.session);
      text = decoded ? GA.core.bundlePrompt.resolveFromDecoded(decoded.turns, record) : null;
    }
    if (text == null) text = record.section || (record.selector && record.selector.exact) || "";
    return { kind: "turn", title, labels: record.labels, content: text };
  }

  async function runSynthesis(instruction) {
    const g = view.g;
    const items = selectedItems();
    if (!items.length || g.askHandle) return;
    g.instruction = instruction;
    g.output = "";
    view.promptComposer.setLoading(true);
    view.outputEl.textContent = "";
    view.outputEl.appendChild(GA.el("div", { class: "ga-msg ga-msg-user", text: instruction }));
    const sv = GA.StreamView({
      beginEl: () => {
        const el = GA.el("div", { class: "ga-msg ga-msg-model" });
        view.outputEl.appendChild(el);
        return el;
      },
      isLive: () => !!view && view.g === g,
      afterUpdate: () => {
        view.outputEl.scrollTop = view.outputEl.scrollHeight;
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
    g.cancelStream = () => sv.cancel();
    const el = sv.beginModel();
    let acc = "";
    try {
      const bundle = [];
      for (const it of items) bundle.push(await bundleItem(it));
      const prompt = GA.core.bundlePrompt.compose({
        instruction,
        items: bundle,
        providerLabel: GA.core.sites.providerLabel(GA.provider),
        maxItemChars: GA.config.BUNDLE_ITEM_CHARS,
      });
      g.sources = bundle.map((b) => ({
        kind: b.kind,
        title: b.title,
        labels: b.labels,
        snippet: b.snippet,
      }));
      g.askHandle = GA.askFlow.ask(prompt, (t) => {
        acc = t;
        sv.renderModel(el, t);
      });
      const finalText = (await g.askHandle.result) || acc;
      g.output = finalText;
      sv.renderModel(el, finalText);
    } catch (err) {
      if (err && err.name === "AbortError") {
        g.output = acc; // stopped — keep the partial, it's still usable output
      } else {
        sv.renderError(el, (err && err.message) || "Request failed.");
      }
    } finally {
      g.askHandle = null;
      g.cancelStream = null;
      sv.endModel(el);
      if (view && view.g === g) {
        view.promptComposer.setLoading(false);
        updateFooter();
      }
    }
  }

  // "Start a conversation": there is no create-conversation API on any host —
  // copy the output, open the site's new-chat page, and say so. The clipboard
  // gets its own catch: a denial must not stop the tab from opening.
  async function startConversation() {
    const g = view.g;
    if (!g.output) return;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(g.output);
        copied = true;
      }
    } catch (e) {}
    const url = GA.core.sites.newChatUrl(GA.provider);
    if (url) window.open(url, "_blank");
    GA.toast(
      copied
        ? "Copied — paste into the new chat to start."
        : "Couldn't copy automatically — copy the output, then paste it into the new chat.",
    );
  }

  function downloadOutput() {
    const g = view.g;
    if (!g.output) return;
    const md = GA.core.bundlePrompt.downloadDoc({
      output: g.output,
      instruction: g.instruction,
      sources: g.sources,
      date: new Date().toISOString().slice(0, 10),
    });
    deliverDownload(md, exportFilename("synthesis", GA.provider));
    GA.toast("Synthesis downloaded.");
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

  function open() {
    close();
    view = {
      query: "",
      body: null,
      count: null,
      searchInput: null,
      clearBtn: null,
      typeSelect: null,
      footer: null,
      g: makeGlobalState(),
    };
    const built = buildHeader();
    view.body = GA.el("div", { class: "ga-modal-body ga-panel-body" });
    const footer = buildFooter();
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
        // A synthesis without a surface has nowhere to persist — abort (not
        // stop), and drop any pending stream frame with it.
        const g = view && view.g;
        if (g && g.askHandle) {
          try {
            g.askHandle.abort();
          } catch (e) {
            /* the ask may have settled and closed its handle — nothing to do */
          }
        }
        if (g && g.cancelStream) g.cancelStream();
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
