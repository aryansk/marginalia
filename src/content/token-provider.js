// token-provider.js — obtains the Gemini session tokens, with caching.
// Primary: scrape inline bootstrap scripts (CSP-safe; parsing in core/tokens.js).
// Fallback: ask the background to read window.WIZ_global_data in the MAIN world.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.tokenProvider = (function () {
  let cached = null;

  function scrape() {
    const texts = [];
    document.querySelectorAll("script").forEach((s) => texts.push(s.textContent));
    return GA.core.tokens.scrapeTokens(texts);
  }

  async function get() {
    if (cached && cached.at && Date.now() - cached.ts < GA.config.TOKEN_CACHE_TTL_MS) return cached;
    let t = scrape();
    if (!t.at || !t.bl || !t.sid) {
      const f =
        (await browser.runtime.sendMessage({ type: GA.protocol.MSG_READ_TOKENS }).catch(() => null)) ||
        {};
      t = { at: t.at || f.at, bl: t.bl || f.bl, sid: t.sid || f.sid };
    }
    if (!t.at) throw new Error("Couldn't read your Gemini session token. Are you logged in?");
    cached = { at: t.at, bl: t.bl, sid: t.sid, ts: Date.now() };
    return cached;
  }

  return { get };
})();
