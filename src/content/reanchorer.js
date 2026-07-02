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
  function observe(ctx) {
    function onFrame() {
      if (ctx.checkNav) ctx.checkNav();
      if (ctx.hasOrphans()) ctx.reanchor();
      else GA.gutter.scheduleLayout(); // anchors may have moved even with no orphans
    }

    const obs = new MutationObserver(function () {
      GA.frame.schedule("reanchor", onFrame);
    });
    obs.observe(document.body, { childList: true, subtree: true });

    window.addEventListener(
      "scroll",
      function () {
        GA.frame.schedule("reanchor", onFrame);
      },
      true
    );
  }

  return { observe };
})();
