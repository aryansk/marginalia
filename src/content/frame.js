// frame.js — a single shared requestAnimationFrame scheduler. Callers register
// named tasks; all tasks scheduled during a frame run together in the next one,
// in a fixed order (nav-detection before re-anchoring before layout), each at
// most once. This replaces the separate rAF gates that gutter and reanchorer
// used to keep, so one scroll/mutation burst costs one coalesced frame.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.frame = (function () {
  const ORDER = ["nav", "reanchor", "layout"];
  const tasks = new Map(); // name -> fn (latest registration wins)
  let rafId = 0;

  function schedule(name, fn) {
    tasks.set(name, fn);
    if (!rafId) rafId = requestAnimationFrame(run);
  }

  function run() {
    rafId = 0;
    const pending = new Map(tasks);
    tasks.clear();
    ORDER.forEach(function (name) {
      const fn = pending.get(name);
      if (fn) {
        pending.delete(name);
        fn();
      }
    });
    pending.forEach(function (fn) {
      fn();
    });
  }

  return { schedule };
})();
