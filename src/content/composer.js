// composer.js — the ask/stop input row, shared by the modal (and available to
// any surface that needs to send a follow-up). Same classes as the box
// composer (.ga-composer/.ga-input/.ga-send) so every surface looks identical.
//
// GA.Composer({ placeholder, onSubmit(text), onStop(), onResize() }) ->
//   { el, textarea, focus(), setLoading(bool) }
// Enter and Cmd/Ctrl+Enter submit; Shift+Enter inserts a newline.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.Composer = function (opts) {
  let loading = false;

  const textarea = GA.el("textarea", {
    class: "ga-input",
    rows: "1",
    placeholder: opts.placeholder || "Ask a follow-up…",
    "aria-label": opts.placeholder || "Ask a follow-up",
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
  const el = GA.el("div", { class: "ga-composer" }, [textarea, sendBtn]);

  function autosize() {
    const prev = textarea.style.height;
    const next = GA.fitTextarea(textarea);
    textarea.style.height = next;
    if (next !== prev && opts.onResize) opts.onResize();
  }
  textarea.addEventListener("input", autosize);
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!loading) submit();
    }
  });

  function submit() {
    const q = textarea.value.trim();
    if (!q) return;
    textarea.value = "";
    autosize();
    opts.onSubmit && opts.onSubmit(q);
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

  return {
    el,
    textarea,
    focus() {
      textarea.focus();
    },
    setLoading,
  };
};
