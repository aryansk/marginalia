// reanchorer.js — keeps orphaned boxes anchored as Gemini re-renders and as the
// user scrolls (its virtual scroller doesn't always fire mutation events). Drives
// an injected context: { reanchor(), hasOrphans(), checkNav() }.
//
// The MutationObserver fires for every streamed token on these sites, so the
// per-frame work is kept minimal: a URL check (SPA navigations always mutate the
// DOM, which lets navigation.js live without a poll) and a re-anchor pass only
// when some thread has actually lost its highlight. All work is coalesced
// through GA.frame, so a mutation burst or scroll costs one frame of work.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.reanchorer = (function () {
  const perfTime = (name, fn) => (GA.perf ? GA.perf.time(name, fn) : fn());

  // Mutations and scrolls that stay inside our own UI move no page anchors —
  // our stream renders would otherwise re-wake this observer every flush.
  // Highlight spans are NOT filtered: they live inside page turns, and their
  // (rare) mutations legitimately schedule the next frame's cheap pass.
  const EXT_ROOTS = ".ga-gutter, .ga-modal-overlay, .ga-toast, .ga-adder";
  function inExtensionUi(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && el.closest && el.closest(EXT_ROOTS));
  }

  function observe(ctx) {
    // Turns whose text may have changed since we last fingerprinted them.
    // Collected from the observer's records so a streaming answer invalidates
    // only itself — re-fingerprinting every mounted turn on every mutation
    // burst would put that work on the hot path.
    const dirty = new Set();

    // -> whether any turn fingerprint was actually invalidated: the reanchor
    // pass uses it to recognize provably-futile retries (see reanchorOrphans).
    function dropStaleFingerprints() {
      if (!dirty.size || !GA.turns) {
        dirty.clear();
        return false;
      }
      const seen = new Set();
      dirty.forEach(function (node) {
        const turn = GA.turns.turnOf(node);
        if (turn && !seen.has(turn.el)) {
          seen.add(turn.el);
          GA.turns.invalidate(turn.el);
        }
      });
      dirty.clear();
      return seen.size > 0;
    }

    function onFrame() {
      perfTime("reanchor.frame", function () {
        const textChanged = dropStaleFingerprints();
        if (ctx.checkNav) ctx.checkNav();
        if (ctx.hasOrphans()) perfTime("reanchor.pass", () => ctx.reanchor({ textChanged }));
        // Anchors may have moved even with no orphans. Mode-aware: JS mode does a
        // full relayout; CSS-anchored mode (Chrome) lets the compositor follow
        // and only refreshes cues + debounces a settle pass.
        else GA.gutter.onAnchorsMoved();
        // Something on the page just changed — let settle-watchers (transcript
        // capture) know. They debounce on their side; this stays one call.
        if (ctx.onSettled) ctx.onSettled();
      });
    }

    const obs = new MutationObserver(function (records) {
      let page = false;
      for (const r of records) {
        if (!r.target || inExtensionUi(r.target)) continue;
        dirty.add(r.target);
        page = true;
      }
      if (page) GA.frame.schedule("reanchor", onFrame);
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // The single scroll entry point (the gutter's own listener merged here —
    // onFrame calls gutter.onAnchorsMoved). Capture phase because page
    // scrollers are inner divs whose scroll doesn't bubble; passive because
    // nothing here ever preventDefaults.
    window.addEventListener(
      "scroll",
      function (e) {
        if (e.target && e.target.nodeType === 1 && inExtensionUi(e.target)) return;
        GA.frame.schedule("reanchor", onFrame);
      },
      { capture: true, passive: true },
    );
  }

  return { observe };
})();
