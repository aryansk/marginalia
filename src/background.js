// background.js — context-menu registration + the ask message router.
// Network calls live here (not in the content script) because Firefox MV3
// subjects content-script fetch to the page's CSP; background scripts use the
// extension's host permissions instead and get the session cookies for free.
// The message/port string contract comes from shared/protocol.js.
var GA = (typeof GA !== "undefined" && GA) || {};
const P = GA.protocol;

// Read the user's settings (incl. optional API keys) so the ask router can pick
// the right backend. Background can't see the content script's GA.settings, so it
// reads storage directly; schema/defaults come from shared/settings-schema.js.
async function getSettings() {
  const defaults = GA.schema.DEFAULT_SETTINGS;
  try {
    const obj = await browser.storage.local.get(GA.schema.SETTINGS_KEY);
    return Object.assign({}, defaults, obj[GA.schema.SETTINGS_KEY] || {});
  } catch (e) {
    return Object.assign({}, defaults);
  }
}

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
// Defense-in-depth: only our own content scripts, running on gemini.google.com
// (the only page that has these tokens), may trigger the MAIN-world read.
function isGeminiTokenSender(sender) {
  return (
    sender &&
    sender.id === browser.runtime.id &&
    sender.tab &&
    typeof sender.tab.url === "string" &&
    sender.tab.url.indexOf("https://gemini.google.com/") === 0
  );
}
browser.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.type !== P.MSG_READ_TOKENS || !isGeminiTokenSender(sender)) return;
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
      const settings = await getSettings();
      const client = GA.clientFor(msg.provider, settings);
      const text = await client.ask({ prompt: msg.prompt, tokens: msg.tokens, settings }, function (t) {
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
