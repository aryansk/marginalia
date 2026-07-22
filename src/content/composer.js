// composer.js — the ask/stop input row, shared by the modal (and available to
// any surface that needs to send a follow-up). Same classes as the box
// composer (.ga-composer/.ga-input/.ga-send) so every surface looks identical.
//
// GA.Composer({ placeholder, ariaLabel, onSubmit(text, {md}), onStop(),
//               onResize(), markdownToggle, resizable })
//   -> { el, textarea, focus(), setLoading(bool), draft(), setDraft(text) }
// Enter and Cmd/Ctrl+Enter submit; Shift+Enter inserts a newline — and so
// does plain Enter while the caret sits inside an unclosed ``` fence (code
// lines shouldn't fight the send key; Cmd/Ctrl+Enter always sends).
// markdownToggle adds the MD button: the user chooses PER MESSAGE whether it
// is sent (and rendered) as markdown. resizable adds a drag grip above the
// textarea (modal-sized surfaces only).
var GA = (typeof GA !== "undefined" && GA) || {};

// The MD toggle's last state is the session default: a writer who flips it on
// is probably sending more markdown — new composers open the way the last one
// was left. Resets with the page (deliberately not persisted).
let composerMdDefault = false;

GA.Composer = function (opts) {
  let loading = false;
  let mdOn = opts.markdownToggle ? composerMdDefault : false;
  let manualPx = 0; // grip-set height; while non-zero, autosize stands down

  const textarea = GA.el("textarea", {
    class: "ga-input",
    rows: "1",
    placeholder: opts.placeholder || "Ask a follow-up…",
    "aria-label": opts.ariaLabel || opts.placeholder || "Ask a follow-up",
  });
  const sendBtn = GA.el("button", {
    class: "ga-send",
    text: "Ask",
    "aria-label": "Send question",
    onclick: function () {
      if (loading) opts.onStop && opts.onStop();
      else submit();
    },
  });
  const mdBtn = opts.markdownToggle
    ? GA.el(
        "button",
        {
          class: "ga-iconbtn ga-md-btn" + (mdOn ? " ga-md-on" : ""),
          title: "Send as markdown",
          "aria-label": "Send as markdown",
          "aria-pressed": mdOn ? "true" : "false",
          onclick: function () {
            mdOn = !mdOn;
            composerMdDefault = mdOn;
            mdBtn.classList.toggle("ga-md-on", mdOn);
            mdBtn.setAttribute("aria-pressed", mdOn ? "true" : "false");
          },
        },
        GA.icons.make("markdown"),
      )
    : null;
  const el = GA.el("div", { class: "ga-composer" }, [textarea, mdBtn, sendBtn]);

  function autosize() {
    if (manualPx) return; // the user chose a height — keep it
    const prev = textarea.style.height;
    const next = GA.fitTextarea(textarea);
    textarea.style.height = next;
    if (next !== prev && opts.onResize) opts.onResize();
  }
  textarea.addEventListener("input", autosize);
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      // Plain Enter inside an unclosed ``` fence means "next code line", not
      // send — let the native newline through. Cmd/Ctrl+Enter always sends.
      const insideFence =
        !e.metaKey &&
        !e.ctrlKey &&
        (textarea.value.slice(0, textarea.selectionStart).match(/```/g) || []).length % 2 === 1;
      if (insideFence) return;
      e.preventDefault();
      if (!loading) submit();
    }
  });
  // Composer-local undo: restore text lost to a select-all-delete or the
  // clear-on-send below; re-fit the box after any restore.
  const undo = GA.attachComposerUndo(textarea, { onRestore: autosize });

  // ---- drag-to-resize grip (opts.resizable) --------------------------------
  // Same mouse-event pattern as the modal's edge resize (runs in jsdom).
  // Dragging UP grows the input; double-click returns to auto-grow.
  if (opts.resizable) {
    const grip = GA.el("div", {
      class: "ga-composer-grip",
      title: "Drag to resize the input (double-click resets)",
    });
    grip.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = manualPx || textarea.offsetHeight || parseInt(textarea.style.height, 10) || 0;
      function move(ev) {
        const max = Math.round(window.innerHeight * GA.config.COMPOSER_MANUAL_MAX_FRAC);
        manualPx = Math.max(
          GA.config.COMPOSER_MANUAL_MIN_PX,
          Math.min(max, Math.round(startH + (startY - ev.clientY))),
        );
        el.classList.add("ga-composer-manual");
        textarea.style.height = manualPx + "px";
        opts.onResize && opts.onResize();
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    grip.addEventListener("dblclick", function () {
      manualPx = 0;
      el.classList.remove("ga-composer-manual");
      autosize();
    });
    el.appendChild(grip);
  }

  function submit() {
    const q = textarea.value.trim();
    if (!q) return;
    undo.snapshot(); // remember the sent text so focus + Ctrl+Z brings it back
    textarea.value = "";
    autosize();
    opts.onSubmit && opts.onSubmit(q, { md: mdOn });
  }

  function setLoading(v) {
    loading = !!v;
    textarea.disabled = loading;
    sendBtn.classList.toggle("ga-stop", loading);
    sendBtn.textContent = "";
    if (loading) {
      sendBtn.appendChild(GA.icons.make("stop"));
      sendBtn.appendChild(document.createTextNode("Stop"));
      sendBtn.setAttribute("aria-label", "Stop generating");
    } else {
      sendBtn.appendChild(document.createTextNode("Ask"));
      sendBtn.setAttribute("aria-label", "Send question");
    }
  }

  // Draft handoff (box ⇄ modal): plain value moves, no undo snapshot — a
  // moved draft is still the same draft.
  function draft() {
    return textarea.value;
  }
  function setDraft(text) {
    textarea.value = text == null ? "" : text;
    autosize();
  }

  return {
    el,
    textarea,
    focus() {
      textarea.focus();
    },
    setLoading,
    draft,
    setDraft,
  };
};
