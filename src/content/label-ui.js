// label-ui.js — the standalone label chip: the surface for kind:"label"
// records (an LLM turn tagged via /label with no conversation attached).
// Renders as a permanently-compact gutter chip "<tag> <highlight snippet>";
// clicking it unfolds a small in-place editor (label pills with remove,
// add-input, delete-record with confirm). Implements the same box interface
// the gutter drives, with collapse/height controls as no-ops — a chip never
// expands into a conversation.
var GA = (typeof GA !== "undefined" && GA) || {};

// handlers: the controller's thread handlers — persist(record), onDelete(record),
// onFocus(record) are the ones a chip uses.
GA.LabelChip = function (record, handlers) {
  const state = { destroyed: false, editing: false };

  const snippetText = GA.truncate(
    record.selector && record.selector.exact,
    GA.config.SNIPPET_CHARS,
  );
  const root = GA.el("div", {
    class: "ga-box ga-collapsed ga-label-chip",
    tabindex: "0",
    role: "region",
    "aria-label": "Label: " + snippetText,
    dataset: { gaThread: record.id },
  });

  // Cache-clear only — the gutter calls this during its own layout passes, so
  // it must never schedule another layout itself (mutation sites call
  // handlers.onResize explicitly).
  let cachedNaturalHeight = null;
  function invalidateHeight() {
    cachedNaturalHeight = null;
  }

  const glyph = GA.labelGlyph();
  const snippet = GA.el("div", {
    class: "ga-box-snippet",
    title: record.selector && record.selector.exact,
    text: snippetText,
  });
  const count = GA.el("span", { class: "ga-chip-count ga-count" });
  const header = GA.el("div", { class: "ga-box-header" }, [glyph, snippet, count]);
  header.addEventListener("click", function (e) {
    if (e.target.closest(".ga-iconbtn")) return;
    setEditing(!state.editing);
  });

  // ---- editor (unfolds under the header) ----
  const editorEl = GA.el("div", { class: "ga-label-editor" });

  const confirm = GA.confirmPopover({
    prompt: "Delete this label?",
    onYes: () => handlers.onDelete && handlers.onDelete(record),
  });

  function persist() {
    handlers.persist && handlers.persist(record);
  }

  function removeLabel(name) {
    record.labels = (record.labels || []).filter((l) => l !== name);
    persist();
    render();
  }

  function addLabels(text) {
    const parsed = GA.core.labels.parseList(text);
    if (parsed.invalid.length) {
      GA.toast(GA.core.labels.invalidMessage(parsed.invalid[0]));
      return false;
    }
    if (!parsed.labels.length) return true; // empty input — just close
    record.labels = GA.core.labels.merge(record.labels, parsed.labels);
    persist();
    return true;
  }

  function render() {
    count.textContent = (record.labels || []).length > 1 ? String(record.labels.length) : "";
    editorEl.textContent = "";
    if (!state.editing) {
      invalidateHeight();
      handlers.onResize && handlers.onResize();
      return;
    }
    const pills = GA.el(
      "div",
      { class: "ga-label-editor-pills" },
      (record.labels || []).map((l) => GA.labelPill(l, { onRemove: removeLabel })),
    );
    const input = GA.el("input", {
      class: "ga-label-edit",
      type: "text",
      placeholder: "Add label…",
      "aria-label": "Add labels (space-separated; quote names with spaces)",
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (addLabels(input.value)) {
          input.value = "";
          render();
        }
      } else if (e.key === "Escape") {
        e.stopPropagation();
        setEditing(false);
      }
    });
    const delBtn = GA.el(
      "button",
      {
        class: "ga-iconbtn",
        title: "Delete label (Del)",
        "aria-label": "Delete label",
        onclick: function (e) {
          e.stopPropagation();
          confirm.show();
        },
      },
      GA.icons.make("trash"),
    );
    editorEl.appendChild(pills);
    editorEl.appendChild(GA.el("div", { class: "ga-label-editor-row" }, [input, delBtn]));
    invalidateHeight();
    handlers.onResize && handlers.onResize();
  }

  function setEditing(on) {
    state.editing = !!on;
    root.classList.toggle("ga-label-editing", state.editing);
    confirm.hide();
    render();
    if (state.editing) {
      const input = editorEl.querySelector(".ga-label-edit");
      if (input) input.focus();
    }
  }

  root.appendChild(header);
  root.appendChild(editorEl);
  root.appendChild(confirm.el);
  render();

  root.addEventListener("keydown", function (e) {
    const inInput = document.activeElement && document.activeElement.tagName === "INPUT";
    if ((e.key === "Delete" || e.key === "Backspace") && !inInput) {
      e.preventDefault();
      confirm.show();
    } else if (e.key === "Escape") {
      confirm.hide();
    }
  });
  root.addEventListener("mousedown", function () {
    handlers.onFocus && handlers.onFocus(record);
  });
  root.addEventListener("mouseenter", function () {
    GA.selection.setHighlightHover(record.id, true);
  });
  root.addEventListener("mouseleave", function () {
    GA.selection.setHighlightHover(record.id, false);
  });

  // Same public surface the gutter drives on a ThreadBox; a chip is always
  // compact, so the collapse/height controls are deliberate no-ops.
  return {
    id: record.id,
    thread: record,
    el: root,
    focusInput() {
      root.focus();
    },
    setActive(active) {
      root.classList.toggle("ga-active", !!active);
    },
    setDimmed(dim) {
      root.classList.toggle("ga-dimmed", !!dim);
    },
    isCompact() {
      return true;
    },
    setCollapsed() {},
    setMaxHeight() {},
    setOrphan: GA.makeOrphanToggle({ root, header, snippet, onChange: invalidateHeight }),
    naturalHeight() {
      if (cachedNaturalHeight == null) cachedNaturalHeight = root.offsetHeight;
      return cachedNaturalHeight;
    },
    invalidateHeight,
    destroy() {
      state.destroyed = true;
      root.remove();
    },
  };
};
