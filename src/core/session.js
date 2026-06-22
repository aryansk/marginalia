// session.js — pure: derive the Gemini conversation id from a URL path.
// Takes the pathname as an argument (no `location`) so it's unit-testable.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.session = (function () {
  // Session id = the <id> segment of /app/<id>. Matches anywhere in the path,
  // so /u/0/app/<id> works too. Query/hash are excluded by the char class.
  function getSessionId(pathname) {
    const m = String(pathname || "").match(/\/app\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  return { getSessionId };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.session;
