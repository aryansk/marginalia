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
      title: "Ask about “%s”",
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

// Open the extension's options page on request from the panel's gear button.
// A SEPARATE, ungated listener (not the gemini-gated token router above) so it
// works on every supported site. Fire-and-forget, and ALWAYS returns undefined:
// returning a value/Promise from a non-matching listener would hijack another
// handler's sendResponse channel.
browser.runtime.onMessage.addListener(function (msg) {
  if (!msg || msg.type !== P.MSG_OPEN_OPTIONS) return;
  Promise.resolve(browser.runtime.openOptionsPage()).catch(function () {});
});

// Heartbeat cadence while an ask is streaming. Any port message resets Chrome's
// MV3 service-worker idle timer (30s), so 20s keeps the worker alive through
// long silent "thinking" periods; the content side uses the same pings to feed
// its dead-worker watchdog.
const PING_INTERVAL_MS = 20000;

browser.runtime.onConnect.addListener(function (port) {
  if (port.name !== P.PORT_ASK) return;

  // One controller per ask port: the content side disconnecting (stop button,
  // conversation switch, tab close) aborts the in-flight fetch/stream.
  const aborter = new AbortController();
  let heartbeat = null;
  port.onDisconnect.addListener(function () {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    try {
      aborter.abort();
    } catch (e) {}
  });

  port.onMessage.addListener(async function (msg) {
    if (!msg || msg.type !== P.MSG_ASK) return;
    heartbeat = setInterval(function () {
      try {
        port.postMessage({ type: P.MSG_PING });
      } catch (e) {}
    }, PING_INTERVAL_MS);
    try {
      const settings = await getSettings();
      const client = GA.clientFor(msg.provider, settings);
      // Post only what changed per chunk (shared/stream-delta.js) — the full
      // answer-so-far would cross the port O(n²) over a long reply.
      let sent = "";
      const text = await client.ask(
        { prompt: msg.prompt, tokens: msg.tokens, settings, signal: aborter.signal },
        function (t) {
          const d = GA.streamDelta.next(sent, t);
          if (!d) return;
          sent = t;
          try {
            port.postMessage(
              d.reset
                ? { type: P.MSG_CHUNK, reset: true, text: d.text }
                : { type: P.MSG_CHUNK, delta: d.delta },
            );
          } catch (e) {}
        },
      );
      port.postMessage({ type: P.MSG_DONE, text });
    } catch (e) {
      if (!aborter.signal.aborted) {
        try {
          port.postMessage({
            type: P.MSG_ERROR,
            message: e && e.message ? e.message : String(e),
            code: (e && e.code) || undefined,
          });
        } catch (e2) {}
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    }
  });
});
