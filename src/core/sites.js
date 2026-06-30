// sites.js — pure site-adapter registry: the single source of truth for "which
// AI am I on, where does its conversation id live in the URL, and which DOM
// containers hold a model answer". No DOM, no network — so it's unit-testable and
// shared by the content script. Subsumes the old core/session.js (Gemini-only).
//
// Adding a site = add an entry here + its selectors, then a backend client under
// src/<provider>/ (see src/gemini, src/chatgpt, src/claude) and a manifest match.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.sites = (function () {
  const PROVIDERS = {
    gemini: {
      hosts: ["gemini.google.com"],
      // /app/<id> — matches anywhere so /u/0/app/<id> works; query/hash excluded.
      sessionRe: /\/app\/([^/?#]+)/,
      responseSelectors: [
        "message-content",
        "model-response",
        ".model-response-text",
        '[data-message-author-role="model"]',
        ".markdown",
        ".response-container-content",
      ],
    },
    chatgpt: {
      hosts: ["chatgpt.com", "chat.openai.com"],
      // /c/<conversation-uuid>
      sessionRe: /\/c\/([^/?#]+)/,
      responseSelectors: [
        '[data-message-author-role="assistant"]',
        "div.markdown",
        ".agent-turn",
      ],
    },
    claude: {
      hosts: ["claude.ai"],
      // /chat/<conversation-uuid>
      sessionRe: /\/chat\/([^/?#]+)/,
      responseSelectors: [
        ".font-claude-message",
        '[data-testid="assistant-message"]',
        "div.prose",
      ],
    },
  };

  // Map a hostname to a provider id. Matches the host exactly or as a subdomain
  // suffix (so www./ accounts subdomains still resolve). Returns null off-site.
  function providerForHost(hostname) {
    const h = String(hostname || "").toLowerCase();
    for (const id in PROVIDERS) {
      if (PROVIDERS[id].hosts.some((host) => h === host || h.endsWith("." + host))) return id;
    }
    return null;
  }

  // The conversation id for `provider` from a URL path (null = no chat open yet).
  function sessionIdFromPath(provider, pathname) {
    const def = PROVIDERS[provider];
    if (!def) return null;
    const m = String(pathname || "").match(def.sessionRe);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // The candidate selectors for that site's model-answer containers (a copy, so
  // callers can't mutate the registry). Empty for an unknown provider.
  function responseSelectors(provider) {
    const def = PROVIDERS[provider];
    return def ? def.responseSelectors.slice() : [];
  }

  return { providerForHost, sessionIdFromPath, responseSelectors, PROVIDERS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.sites;
