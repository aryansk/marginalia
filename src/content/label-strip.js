// label-strip.js — the thread's label chips + inline editor, shared by the
// docked box and the modal. Same element (.ga-thread-labels), same pills,
// same pill-by-pill editing model (× removes one, add-input merges) — one
// mental model for label editing everywhere.
//
// GA.LabelStrip(thread, { persist(thread), onLabel(thread, labels),
//                         isLive(), onChange() })
//   -> { el, render(), edit() }
// onLabel routes adds through the controller (on an EMPTY thread that
// converts the record to a standalone label, destroying the surface — the
// isLive() guard skips the re-render then). onChange fires after every
// render so the host can sync derived state (ga-has-labels, heights).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.LabelStrip = function (thread, opts) {
  const el = GA.el("div", { class: "ga-thread-labels" });
  let editing = false;

  function removeLabel(name) {
    thread.labels = (thread.labels || []).filter((l) => l !== name);
    opts.persist && opts.persist(thread);
    render();
  }

  function addLabels(text) {
    const parsed = GA.core.labels.parseList(text);
    if (parsed.invalid.length) {
      GA.toast(GA.core.labels.invalidMessage(parsed.invalid[0]));
      return; // stay in the editor — the typed text is still on screen
    }
    if (!parsed.labels.length) {
      editing = false; // empty Enter = done editing
      render();
      return;
    }
    opts.onLabel && opts.onLabel(thread, parsed.labels);
    if (!opts.isLive || opts.isLive()) render();
  }

  function render() {
    const labels = thread.labels || [];
    el.textContent = "";
    if (editing) {
      labels.forEach((l) => el.appendChild(GA.labelPill(l, { onRemove: removeLabel })));
      const input = GA.el("input", {
        class: "ga-label-edit",
        type: "text",
        placeholder: "Add label…",
        "aria-label": "Add labels (space-separated; quote names with spaces)",
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          addLabels(input.value);
        } else if (e.key === "Escape") {
          e.stopPropagation(); // don't bubble into the host's delete/Esc guard
          editing = false;
          render();
        }
      });
      el.appendChild(input);
      input.focus();
    } else if (labels.length) {
      el.appendChild(GA.labelGlyph({ on: true }));
      labels.forEach((l) => el.appendChild(GA.labelPill(l)));
      el.appendChild(
        GA.el(
          "button",
          {
            class: "ga-iconbtn ga-label-editbtn",
            title: "Edit labels",
            "aria-label": "Edit labels",
            onclick: function (e) {
              e.stopPropagation();
              editing = true;
              render();
            },
          },
          GA.icons.make("pencil"),
        ),
      );
    }
    opts.onChange && opts.onChange();
  }

  function edit() {
    editing = true;
    render();
  }

  return { el, render, edit };
};
