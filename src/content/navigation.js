// navigation.js — detect SPA route changes on gemini.google.com (it never does a
// full page load when you switch conversations). Calls `onChange` whenever the
// URL changes, via patched history methods, popstate, and a polling fallback.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.navigation = (function () {
  function watch(onChange) {
    ["pushState", "replaceState"].forEach(function (m) {
      const orig = history[m];
      history[m] = function () {
        const r = orig.apply(this, arguments);
        window.dispatchEvent(new Event("ga:locationchange"));
        return r;
      };
    });
    window.addEventListener("popstate", onChange);
    window.addEventListener("ga:locationchange", onChange);

    let last = location.href;
    setInterval(function () {
      if (location.href !== last) {
        last = location.href;
        onChange();
      }
    }, GA.config.NAV_POLL_MS);
  }

  return { watch };
})();
