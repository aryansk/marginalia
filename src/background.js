// background.js — context-menu registration + the ask message router.
// Network calls live here (not in the content script) because Firefox MV3
// subjects content-script fetch to the page's CSP; background scripts use the
// extension's host permissions instead and get the session cookies for free.
// The message/port string contract comes from shared/protocol.js.
var GA = (typeof GA !== "undefined" && GA) || {};
const P = GA.protocol;

function setupMenus() {
  // Promise.resolve() so this works on Chrome too, where contextMenus.removeAll
  // may invoke a callback rather than return a promise.
  Promise.resolve(browser.contextMenus.removeAll()).then(function () {
    browser.contextMenus.create({
      id: P.CONTEXT_MENU_ID,
      title: 'Ask about “%s”',
      contexts: ["selection"],
      documentUrlPatterns: [
        "https://gemini.google.com/*",
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://claude.ai/*",
      ],
    });
  });
}

browser.runtime.onInstalled.addListener(setupMenus);
browser.runtime.onStartup.addListener(setupMenus);
setupMenus();

browser.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === P.CONTEXT_MENU_ID && tab && tab.id != null) {
    browser.tabs.sendMessage(tab.id, { type: P.MSG_OPEN_FROM_CONTEXT }).catch(function () {});
  }
});

// Read Gemini's page tokens from the MAIN world. This is privileged and not
// subject to the page's CSP, so it works where injecting a <script> would be
// blocked. Used as a fallback when the content script can't scrape them.
browser.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.type !== P.MSG_READ_TOKENS || !sender.tab) return;
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
  if (port.name !== P.PORT_ASK) return;
  port.onMessage.addListener(async function (msg) {
    if (!msg || msg.type !== P.MSG_ASK) return;
    try {
      const client = GA.clientFor(msg.provider);
      const text = await client.ask({ prompt: msg.prompt, tokens: msg.tokens }, function (t) {
        try {
          port.postMessage({ type: P.MSG_CHUNK, text: t });
        } catch (e) {}
      });
      port.postMessage({ type: P.MSG_DONE, text });
    } catch (e) {
      try {
        port.postMessage({ type: P.MSG_ERROR, message: e && e.message ? e.message : String(e) });
      } catch (e2) {}
    }
  });
});
