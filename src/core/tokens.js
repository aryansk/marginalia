// tokens.js — pure, GEMINI-SPECIFIC: extract the StreamGenerate session tokens
// from the text of gemini.google.com's inline bootstrap scripts (the "at"
// anti-CSRF token, "bl" build label, and "f.sid" session id the web client
// needs). Other providers do not use this module. Operates on strings (the
// caller collects the <script> text), so it's unit-testable without a DOM.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.tokens = (function () {
  // Match "key":"string" or "key":number (FdrFje / f.sid is sometimes unquoted).
  function grab(text, key) {
    let m = text.match(new RegExp('"' + key + '":"([^"]*)"'));
    if (m) return m[1];
    m = text.match(new RegExp('"' + key + '":(-?\\d+)'));
    return m ? m[1] : null;
  }

  // Scan inline-script texts for the three tokens; stop once all are found.
  function scrapeTokens(scriptTexts) {
    let at = null,
      bl = null,
      sid = null;
    for (const txt of scriptTexts || []) {
      if (!txt) continue;
      if (!at) at = grab(txt, "SNlM0e"); // the "at" anti-CSRF token
      if (!bl) bl = grab(txt, "cfb2h"); // the "bl" build label
      if (!sid) sid = grab(txt, "FdrFje"); // the "f.sid" session id
      if (at && bl && sid) break;
    }
    return { at, bl, sid };
  }

  return { grab, scrapeTokens };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.tokens;
