// reanchorer.js — keeps orphaned boxes anchored as Gemini re-renders and as the
// user scrolls (its virtual scroller doesn't always fire mutation events). Drives
// an injected context: { reanchor(), hasOrphans() }.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.reanchorer = (function () {
  function observe(ctx) {
    let pending = false;
    const obs = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        ctx.reanchor();
        GA.gutter.scheduleLayout();
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });

    let scrollRaf = false;
    window.addEventListener(
      "scroll",
      function () {
        if (scrollRaf) return;
        scrollRaf = true;
        requestAnimationFrame(function () {
          scrollRaf = false;
          if (ctx.hasOrphans()) ctx.reanchor();
        });
      },
      true
    );
  }

  return { observe };
})();
