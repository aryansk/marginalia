// navigation.js — detect SPA route changes (these sites never do a full page
// load when you switch conversations). Calls `onChange` whenever the URL
// changes, via patched history methods, popstate, and `checkNow()` — which the
// reanchorer invokes from its mutation frame (an SPA navigation always mutates
// the DOM, so this replaces the old 1s polling fallback).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.navigation = (function () {
  function watch(onChange) {
    let last = location.href;
    function checkNow() {
      if (location.href === last) return;
      last = location.href;
      onChange();
    }

    ["pushState", "replaceState"].forEach(function (m) {
      const orig = history[m];
      history[m] = function () {
        const r = orig.apply(this, arguments);
        window.dispatchEvent(new Event("ga:locationchange"));
        return r;
      };
    });
    window.addEventListener("popstate", checkNow);
    window.addEventListener("ga:locationchange", checkNow);

    return { checkNow };
  }

  return { watch };
})();
