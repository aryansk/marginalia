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

  function observe(ctx) {
    // Turns whose text may have changed since we last fingerprinted them.
    // Collected from the observer's records so a streaming answer invalidates
    // only itself — re-fingerprinting every mounted turn on every mutation
    // burst would put that work on the hot path.
    const dirty = new Set();

    function dropStaleFingerprints() {
      if (!dirty.size || !GA.turns) return dirty.clear();
      const seen = new Set();
      dirty.forEach(function (node) {
        const turn = GA.turns.turnOf(node);
        if (turn && !seen.has(turn.el)) {
          seen.add(turn.el);
          GA.turns.invalidate(turn.el);
        }
      });
      dirty.clear();
    }

    function onFrame() {
      perfTime("reanchor.frame", function () {
        dropStaleFingerprints();
        if (ctx.checkNav) ctx.checkNav();
        if (ctx.hasOrphans()) perfTime("reanchor.pass", () => ctx.reanchor());
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
      for (const r of records) if (r.target) dirty.add(r.target);
      GA.frame.schedule("reanchor", onFrame);
    });
    obs.observe(document.body, { childList: true, subtree: true });

    window.addEventListener(
      "scroll",
      function () {
        GA.frame.schedule("reanchor", onFrame);
      },
      true,
    );
  }

  return { observe };
})();
