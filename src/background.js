// background.js — context-menu registration + the ask message router.
// Network calls live here (not in the content script) because Firefox MV3
// subjects content-script fetch to the page's CSP; background scripts use the
// extension's host permissions instead and get the session cookies for free.
var GA = GA || {};

function setupMenus() {
  browser.contextMenus.removeAll().then(function () {
    browser.contextMenus.create({
      id: "ga-ask",
      title: 'Ask Gemini about “%s”',
      contexts: ["selection"],
      documentUrlPatterns: ["https://gemini.google.com/*"],
    });
  });
}

browser.runtime.onInstalled.addListener(setupMenus);
browser.runtime.onStartup.addListener(setupMenus);
setupMenus();

browser.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === "ga-ask" && tab && tab.id != null) {
    browser.tabs.sendMessage(tab.id, { type: "ga-open-from-context" }).catch(function () {});
  }
});

// Read Gemini's page tokens from the MAIN world. This is privileged and not
// subject to the page's CSP, so it works where injecting a <script> would be
// blocked. Used as a fallback when the content script can't scrape them.
browser.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.type !== "ga-read-tokens" || !sender.tab) return;
  return browser.scripting
    .executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: function () {
        var w = window.WIZ_global_data || {};
        return { at: w.SNlM0e || null, bl: w.cfb2h || null, sid: w.FdrFje || null };
      },
    })
    .then(function (res) {
      return (res && res[0] && res[0].result) || { at: null, bl: null, sid: null };
    })
    .catch(function () {
      return { at: null, bl: null, sid: null };
    });
});

browser.runtime.onConnect.addListener(function (port) {
  if (port.name !== "ga-ask") return;
  port.onMessage.addListener(async function (msg) {
    if (!msg || msg.type !== "ask") return;
    try {
      const text = await GA.client.ask({ prompt: msg.prompt, tokens: msg.tokens }, function (t) {
        try {
          port.postMessage({ type: "chunk", text: t });
        } catch (e) {}
      });
      port.postMessage({ type: "done", text });
    } catch (e) {
      try {
        port.postMessage({ type: "error", message: e && e.message ? e.message : String(e) });
      } catch (e2) {}
    }
  });
});
