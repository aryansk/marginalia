// triggers.js — the two ways to open a comment box on the current selection:
// the context-menu item (relayed from the background) and the configurable
// keyboard shortcut. Calls back into `onTrigger` so it doesn't know about threads.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.triggers = (function () {
  function setup(onTrigger) {
    browser.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === GA.protocol.MSG_OPEN_FROM_CONTEXT) onTrigger();
    });

    document.addEventListener(
      "keydown",
      function (e) {
        const sc = GA.settings.shortcut || {};
        if (
          e.key &&
          e.key.toLowerCase() === sc.key &&
          !!e.ctrlKey === !!sc.ctrl &&
          !!e.shiftKey === !!sc.shift &&
          !!e.altKey === !!sc.alt &&
          !!e.metaKey === !!sc.meta
        ) {
          const txt = String(window.getSelection() || "").trim();
          if (txt) {
            e.preventDefault();
            onTrigger();
          }
        }
      },
      true
    );
  }

  return { setup };
})();
