// panel-global.js — the panel's "All chats" tab: cross-conversation search
// (threads by text, labels via the namespace-grouped picker), curation of the
// matched items, and the synthesis flow (bundle → askFlow → streamed output →
// Start-a-conversation / Download as md). Extracted from panel.js so the
// panel shell keeps one concern (the per-conversation overview + chrome) and
// this sub-feature owns its own per-open state.
//
// GA.panelGlobal.create(ctx) -> one instance per panel open:
//   { state, buildFooter(), render(bodyEl), updateFooter(), setType(t), onClose() }
// ctx (provided by panel.js, which owns the chrome): { isActive(), query(),
//   setCount(shown, total), clearCount(), requestRender(), download(md, base) }.
//
// Selection model — the one non-obvious thing here: in THREADS mode the
// selection is the explicit `pickedThreads` map. In LABELS mode there is no
// stored positive selection: the live set is COMPUTED in selectedItems() as
// every label-matched item minus `curatedOut` (explicit unchecks). Every
// matched item therefore starts checked, and changing the label pick resets
// the curation.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.panelGlobal = (function () {
  function makeState() {
    return {
      type: "threads", // "threads" | "labels" — the search-type dropdown
      buckets: null, // null until the first listThreadBuckets resolves
      total: 0, // thread count across all buckets (the "N of M" denominator)
      loading: null,
      rawConvos: new Map(), // session -> Promise<raw ga:convo record|null>
      decoded: new Map(), // session -> Promise<decoded convo|null> (fallback only)
      titles: new Map(), // session -> Promise<display title>
      pickedThreads: new Map(), // threads mode: record id -> { session, record }
      pickedLabels: new Set(), // labels mode: the label picker
      curatedOut: new Set(), // labels mode: explicitly unchecked record ids
      askHandle: null, // in-flight synthesis ask (stop/abort)
      cancelStream: null, // drop pending stream frames on close
      instruction: "",
      output: "", // settled model output (enables the action buttons)
      sources: [], // provenance for the downloaded doc
    };
  }

  function create(ctx) {
    const state = makeState();
    // Footer elements, built once per instance in buildFooter().
    const ui = { footer: null, selCount: null, outputEl: null, actionsEl: null, composer: null };
    // Set by onClose(). Async work (bucket listing, bundling, stream frames)
    // can land after the dialog is gone — every late callback checks this
    // instead of touching a torn-down surface.
    let closed = false;

    // ---- data (per-open caches) --------------------------------------------

    function ensureBuckets() {
      if (state.loading) return;
      state.loading = GA.store
        .listThreadBuckets()
        .catch((e) => {
          GA.warn("bucket listing failed", e);
          return [];
        })
        .then((buckets) => {
          if (closed) return;
          state.buckets = buckets;
          // "N of M" denominator — constant per listing, so never per keystroke.
          state.total = GA.core.globalSearch.searchThreads(buckets, "").length;
          ctx.requestRender();
        });
    }

    // Raw records are cheap (blobs stay compressed and are only sliced
    // per-fingerprint by bundle-prompt); the whole-conversation decode is the
    // fingerprint-miss fallback and runs at most once per session per open.
    function rawConvoFor(session) {
      if (!state.rawConvos.has(session)) {
        state.rawConvos.set(
          session,
          GA.store.loadConvo(session).catch(() => null),
        );
      }
      return state.rawConvos.get(session);
    }

    function decodedFor(session) {
      if (!state.decoded.has(session)) {
        state.decoded.set(
          session,
          GA.convoRepair.loadDecoded(session).catch(() => null),
        );
      }
      return state.decoded.get(session);
    }

    function titleFor(session) {
      if (!state.titles.has(session)) {
        state.titles.set(
          session,
          rawConvoFor(session).then((raw) => {
            if (raw && raw.title) return String(raw.title);
            const provider = String(session).split(":")[0];
            return GA.core.sites.providerLabel(provider) || provider;
          }),
        );
      }
      return state.titles.get(session);
    }

    // The curated selection, by mode (see the module header): explicit picks
    // (threads) or every label-matched item minus explicit unchecks (labels).
    function selectedItems() {
      if (state.type === "threads") return Array.from(state.pickedThreads.values());
      return GA.core.globalSearch
        .filterByLabels(state.buckets || [], Array.from(state.pickedLabels))
        .filter((it) => !state.curatedOut.has(it.record.id));
    }

    // ---- rows --------------------------------------------------------------

    function convoBadge(session) {
      const el = GA.el("span", {
        class: "ga-panel-badge ga-tag ga-panel-row-convo",
        text: String(session).split(":")[0],
      });
      titleFor(session).then((t) => {
        if (t && el.isConnected) {
          el.textContent = GA.truncate(t, GA.config.PANEL_BADGE_CHARS);
          el.title = t; // full title on hover
        }
      });
      return el;
    }

    // Checkbox row shared by both modes. Clicking anywhere toggles; the
    // checkbox itself stays keyboard/screen-reader reachable.
    function checkboxRow(opts) {
      const box = GA.el("input", {
        type: "checkbox",
        class: "ga-panel-check",
        "aria-label": opts.label,
      });
      box.checked = !!opts.checked;
      box.addEventListener("change", () => opts.onToggle(box.checked));
      const row = GA.el("div", { class: "ga-panel-row ga-panel-row-select" }, [
        box,
        GA.el("div", { class: "ga-panel-row-main" }, opts.main),
        GA.el("div", { class: "ga-panel-row-meta" }, opts.meta || []),
      ]);
      row.addEventListener("click", function (e) {
        // A direct checkbox click already toggled + fired `change` natively —
        // the row handler must not flip it back.
        if (e.target === box) return;
        box.checked = !box.checked;
        opts.onToggle(box.checked);
      });
      return row;
    }

    function renderHitRow(hit, checked, onToggle) {
      const t = hit.record;
      const isLabel = t.kind === "label";
      const main = [
        GA.el("div", { class: "ga-panel-snippet" }, [
          isLabel ? GA.labelGlyph({ on: true }) : null,
          GA.el("span", {
            text: GA.truncate(t.selector && t.selector.exact, GA.config.PANEL_SNIPPET_CHARS),
          }),
        ]),
        GA.el("div", { class: "ga-panel-question", text: GA.recordQuestionText(t) }),
      ];
      return checkboxRow({
        checked,
        onToggle,
        label: (isLabel ? "Labeled answer: " : "Thread: ") + (t.selector && t.selector.exact),
        main,
        meta: [convoBadge(hit.session)],
      });
    }

    // ---- render ------------------------------------------------------------

    function render(bodyEl) {
      updateFooter();
      if (!state.buckets) {
        bodyEl.appendChild(GA.el("div", { class: "ga-modal-empty", text: "Loading…" }));
        ensureBuckets();
        return;
      }
      if (state.type === "threads") renderThreadResults(bodyEl);
      else {
        ctx.clearCount();
        renderLabelPicker(bodyEl);
        renderMatchedItems(bodyEl);
      }
    }

    function renderThreadResults(bodyEl) {
      const hits = GA.core.globalSearch.searchThreads(state.buckets, ctx.query());
      ctx.setCount(hits.length, state.total);
      if (!hits.length) {
        bodyEl.appendChild(
          GA.el("div", {
            class: "ga-modal-empty",
            text: ctx.query()
              ? "No threads match your search."
              : "No threads in any conversation yet.",
          }),
        );
        return;
      }
      hits.forEach((hit) => {
        bodyEl.appendChild(
          renderHitRow(hit, state.pickedThreads.has(hit.record.id), (on) => {
            if (on) state.pickedThreads.set(hit.record.id, hit);
            else state.pickedThreads.delete(hit.record.id);
            updateFooter();
          }),
        );
      });
    }

    function renderLabelPicker(bodyEl) {
      const labels = GA.core.globalSearch
        .collectLabels(state.buckets)
        .filter((l) => GA.core.labels.searchMatch(l, ctx.query()));
      if (!labels.length) {
        bodyEl.appendChild(
          GA.el("div", {
            class: "ga-modal-empty",
            text: ctx.query()
              ? "No labels match your search."
              : 'No labels yet — type /label "name" in any thread.',
          }),
        );
        return;
      }
      GA.core.labels.groupByNamespace(labels).forEach((group) => {
        bodyEl.appendChild(GA.el("div", { class: "ga-panel-group", text: group.ns || "labels" }));
        group.labels.forEach((l) => {
          bodyEl.appendChild(
            checkboxRow({
              checked: state.pickedLabels.has(l),
              label: "Label " + l,
              main: [GA.labelPill(l)],
              onToggle: (on) => {
                if (on) state.pickedLabels.add(l);
                else state.pickedLabels.delete(l);
                // A new picker composition is a new curation: stale exclusions
                // from a previous pick would silently drop items that LOOK
                // checked-by-default under the new labels.
                state.curatedOut.clear();
                ctx.requestRender(); // matched items below follow the picker
              },
            }),
          );
        });
      });
    }

    function renderMatchedItems(bodyEl) {
      if (!state.pickedLabels.size) return;
      const matched = GA.core.globalSearch.filterByLabels(
        state.buckets,
        Array.from(state.pickedLabels),
      );
      bodyEl.appendChild(
        GA.el("div", { class: "ga-panel-group", text: "Matched items — curate the bundle" }),
      );
      if (!matched.length) {
        bodyEl.appendChild(
          GA.el("div", { class: "ga-modal-empty", text: "Nothing carries the selected labels." }),
        );
      }
      // Subtractive selection: every matched item starts IN; unchecking
      // records the id into curatedOut. The live set is selectedItems().
      matched.forEach((hit) => {
        bodyEl.appendChild(
          renderHitRow(hit, !state.curatedOut.has(hit.record.id), (on) => {
            if (on) state.curatedOut.delete(hit.record.id);
            else state.curatedOut.add(hit.record.id);
            updateFooter();
          }),
        );
      });
    }

    // ---- synthesis footer (prompt bar, streamed output, output actions) ----

    function buildFooter() {
      ui.selCount = GA.el("div", { class: "ga-panel-selcount", "aria-live": "polite" });
      ui.outputEl = GA.el("div", { class: "ga-panel-output", role: "log", "aria-label": "Output" });
      // "Copy & open new chat" states the MECHANISM before the click: the
      // explanation can't follow the user to the new tab, so the label is the
      // only guidance guaranteed to be read.
      const startBtn = GA.el("button", { class: "ga-panel-action", onclick: startConversation }, [
        GA.icons.make("jump"),
        "Copy & open new chat",
      ]);
      const downloadBtn = GA.el("button", { class: "ga-panel-action", onclick: downloadOutput }, [
        GA.icons.make("download"),
        "Download .md",
      ]);
      ui.actionsEl = GA.el("div", { class: "ga-panel-output-actions" }, [startBtn, downloadBtn]);
      ui.composer = GA.Composer({
        placeholder: "Summarize, extract patterns… (runs on the selected items)",
        ariaLabel: "Prompt to run across the selected items",
        onSubmit: runSynthesis,
        onStop: () => state.askHandle && state.askHandle.stop(),
      });
      ui.footer = GA.el("div", { class: "ga-panel-foot" }, [
        ui.selCount,
        ui.outputEl,
        ui.actionsEl,
        ui.composer.el,
      ]);
      return ui.footer;
    }

    function updateFooter() {
      if (closed || !ui.footer) return;
      const loaded = !!state.buckets;
      const items = ctx.isActive() && loaded ? selectedItems() : [];
      const busy = !!state.askHandle;
      // The footer is the feature's front door — visible whenever the tab is
      // (once buckets load), with a hint standing in for the count until
      // something is selected. Hiding it until a selection existed made the
      // whole synthesis flow undiscoverable.
      const show = ctx.isActive() && (loaded || busy || !!state.output);
      ui.footer.classList.toggle("ga-panel-foot-on", show);
      ui.selCount.textContent = items.length
        ? items.length + (items.length === 1 ? " item" : " items") + " selected"
        : "Select threads or labels above, then run a prompt across them.";
      // the hint is a sentence, not a status counter — style it as one
      ui.selCount.classList.toggle("ga-panel-hint", !items.length);
      ui.actionsEl.classList.toggle("ga-panel-output-actions-on", !!state.output && !busy);
    }

    async function toBundleItem(hit) {
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
      // The full resolution ladder (selective decode → whole-convo fallback →
      // section-text floor) lives in core; the thunk keeps the expensive
      // decode lazy so it only runs on a fingerprint miss.
      const text = await GA.core.bundlePrompt.resolveText(
        await rawConvoFor(hit.session),
        () => decodedFor(hit.session),
        record,
      );
      return { kind: "turn", title, labels: record.labels, content: text };
    }

    async function composeBundle(instruction, items) {
      const bundle = [];
      for (const it of items) bundle.push(await toBundleItem(it));
      return {
        prompt: GA.core.bundlePrompt.compose({
          instruction,
          items: bundle,
          providerLabel: GA.core.sites.providerLabel(GA.provider),
          maxItemChars: GA.config.BUNDLE_ITEM_CHARS,
        }),
        sources: bundle.map((b) => ({
          kind: b.kind,
          title: b.title,
          labels: b.labels,
          snippet: b.snippet,
        })),
      };
    }

    function makeOutputStream() {
      return GA.StreamView({
        beginEl: () => {
          const el = GA.el("div", { class: "ga-msg ga-msg-model" });
          ui.outputEl.appendChild(el);
          return el;
        },
        isLive: () => !closed,
        afterUpdate: () => {
          ui.outputEl.scrollTop = ui.outputEl.scrollHeight;
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
    }

    async function runSynthesis(instruction) {
      if (state.askHandle) return;
      const items = selectedItems();
      if (!items.length) {
        // The composer is always visible (discoverability) — a submit with an
        // empty selection must say why nothing happened, not silently no-op.
        GA.toast("Select at least one thread or label above first.");
        return;
      }
      state.instruction = instruction;
      state.output = "";
      ui.composer.setLoading(true);
      // Run LOG, not run replacement: a synthesis is expensive — a new prompt
      // must never silently destroy the previous answer. Prior runs stay
      // above, separated by a divider; the action buttons always operate on
      // the latest settled output.
      if (ui.outputEl.childElementCount)
        ui.outputEl.appendChild(GA.el("div", { class: "ga-panel-run-divider" }));
      ui.outputEl.appendChild(GA.el("div", { class: "ga-msg ga-msg-user", text: instruction }));
      // Bundling can decode transcripts for seconds before the first chunk —
      // say so, or the blinking caret reads as a hang.
      const resolving = GA.el("div", {
        class: "ga-panel-resolving",
        text: "Gathering the selected items…",
      });
      ui.outputEl.appendChild(resolving);
      const sv = makeOutputStream();
      state.cancelStream = () => sv.cancel();
      const el = sv.beginModel();
      let acc = "";
      try {
        const { prompt, sources } = await composeBundle(instruction, items);
        // The bundling awaits above can take seconds (transcript decodes). If
        // the dialog closed meanwhile, onClose found no askHandle to abort —
        // bail HERE or the provider request (and Gemini token scrape) would
        // fire for a panel that no longer exists.
        if (closed) return;
        resolving.remove(); // sources gathered — the stream caret takes over
        state.sources = sources;
        state.askHandle = GA.askFlow.ask(prompt, (t) => {
          acc = t;
          sv.renderModel(el, t);
        });
        const finalText = (await state.askHandle.result) || acc;
        state.output = finalText;
        sv.renderModel(el, finalText);
      } catch (err) {
        if (err && err.name === "AbortError") {
          state.output = acc; // stopped — keep the partial, it's still usable output
        } else {
          sv.renderError(el, (err && err.message) || "Request failed.");
          // The prompt cost thought and the run cost seconds — put the text
          // back in the composer so retrying is one Enter, not a retype.
          if (!closed) ui.composer.textarea.value = instruction;
        }
      } finally {
        resolving.remove();
        state.askHandle = null;
        state.cancelStream = null;
        sv.endModel(el);
        if (!closed) {
          ui.composer.setLoading(false);
          updateFooter();
        }
      }
    }

    // "Start a conversation": there is no create-conversation API on any host
    // — copy the output, open the site's new-chat page, and say so. The
    // clipboard gets its own catch: a denial must not stop the tab opening.
    async function startConversation() {
      if (!state.output) return;
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(state.output);
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
      if (!state.output) return;
      const md = GA.core.bundlePrompt.downloadDoc({
        output: state.output,
        instruction: state.instruction,
        sources: state.sources,
        date: new Date().toISOString().slice(0, 10),
      });
      ctx.download(md, "synthesis");
      GA.toast("Synthesis downloaded.");
    }

    function onClose() {
      closed = true;
      // A synthesis without a surface has nowhere to persist — abort (not
      // stop), and drop any pending stream frame with it.
      if (state.askHandle) {
        try {
          state.askHandle.abort();
        } catch (e) {
          /* the ask may have settled and closed its handle — nothing to do */
        }
      }
      if (state.cancelStream) state.cancelStream();
    }

    return {
      state,
      buildFooter,
      render,
      updateFooter,
      setType(t) {
        state.type = t;
      },
      onClose,
    };
  }

  return { create };
})();
