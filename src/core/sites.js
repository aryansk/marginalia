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
      // /gem/<gemId>/<chatId> — a conversation inside a Gem; the bare Gem lobby
      // (/gem/<gemId>) is deliberately NOT a session (it's a new-chat page).
      sessionRes: [/\/app\/([^/?#]+)/, /\/gem\/([^/?#]+\/[^/?#]+)/],
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
      // /c/<conversation-uuid> — also matches project chats /g/g-…/c/<id>.
      sessionRes: [/\/c\/([^/?#]+)/],
      responseSelectors: [
        '[data-message-author-role="assistant"]',
        "div.markdown",
        ".agent-turn",
      ],
    },
    claude: {
      hosts: ["claude.ai"],
      // /chat/<conversation-uuid> — unanchored, so project-scoped chats
      // (/project/<projectId>/chat/<id>) resolve to the same chat id.
      sessionRes: [/\/chat\/([^/?#]+)/],
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
  // Each site lists its route patterns in order; the first match wins.
  function sessionIdFromPath(provider, pathname) {
    const def = PROVIDERS[provider];
    if (!def) return null;
    const path = String(pathname || "");
    for (const re of def.sessionRes) {
      const m = path.match(re);
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
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
