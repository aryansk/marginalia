// content.js — the entry point. It just wires the collaborators together; all
// the real work lives in focused modules (thread-controller, triggers,
// navigation, reanchorer, gutter, token-provider, ask-service).
var GA = (typeof GA !== "undefined" && GA) || {};

(function () {
  // Click a highlight -> focus its box; click elsewhere / Esc -> clear focus.
  function setupFocusListeners() {
    document.addEventListener("mousedown", function (e) {
      const t = e.target;
      if (t.closest && (t.closest(".ga-box") || t.closest(".ga-modal"))) return;
      const hl = t.closest && t.closest("span.ga-highlight");
      if (hl && hl.dataset.gaThread) {
        GA.gutter.setActive(hl.dataset.gaThread);
        return;
      }
      GA.gutter.setActive(null);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") GA.gutter.setActive(null);
    });
  }

  (async function init() {
    await GA.loadSettings();
    browser.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes[GA.SETTINGS_KEY]) GA.loadSettings();
    });

    GA.gutter.init();
    const ctrl = GA.threadController;
    GA.triggers.setup(() => ctrl.createFromSelection());
    setupFocusListeners();
    GA.navigation.watch(() => ctrl.onRouteChange());
    GA.reanchorer.observe({ reanchor: ctrl.reanchorOrphans, hasOrphans: ctrl.hasOrphans });

    await ctrl.restoreForSession(GA.getSessionId());
    GA.log("ready; session =", GA.getSessionId());
  })();
})();
