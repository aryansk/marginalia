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
        ".markdown",
        ".response-container-content",
      ],
      // Verified against a captured conversation: Gemini renders each turn as a
      // custom Angular element and exposes NO author-role attribute at all.
      // (`[data-message-author-role="model"]` used to sit in the list above and
      // matched exactly zero elements — copied from the ChatGPT adapter.)
      turns: { user: ["user-query"], model: ["model-response"] },
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
      // Verified: every message carries data-message-author-role and a
      // data-message-id holding a server UUID. Turns do not nest.
      turns: {
        user: ['[data-message-author-role="user"]'],
        model: ['[data-message-author-role="assistant"]'],
      },
    },
    claude: {
      hosts: ["claude.ai"],
      // /chat/<conversation-uuid> — unanchored, so project-scoped chats
      // (/project/<projectId>/chat/<id>) resolve to the same chat id.
      sessionRes: [/\/chat\/([^/?#]+)/],
      // `.font-claude-response` is the live class. The three selectors that
      // used to be here — .font-claude-message, [data-testid=assistant-message]
      // and div.prose — matched NOTHING on a captured conversation, so every
      // restore fell through to a whole-page text search. Kept as trailing
      // fallbacks in case an older build still renders them.
      responseSelectors: [
        ".font-claude-response",
        ".font-claude-message",
        '[data-testid="assistant-message"]',
        "div.prose",
      ],
      turns: {
        user: ['[data-testid="user-message"]'],
        model: [".font-claude-response"],
      },
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

  // The site's TURN containers, split by who spoke. A thread remembers the role
  // of the turn it was created in, so a comment written on an answer can never
  // re-anchor onto a question — the single most durable signal we have, since a
  // turn's author never changes even when the site's markup does.
  //
  // These must be the OUTERMOST element per turn: the response selectors above
  // nest (on Gemini one answer matches five of them at once), and treating
  // nested matches as separate turns would read one answer as several.
  function turnSelectors(provider) {
    const def = PROVIDERS[provider];
    if (!def || !def.turns) return { user: [], model: [] };
    return { user: def.turns.user.slice(), model: def.turns.model.slice() };
  }

  // Combined selector for "any turn", for a single querySelectorAll pass.
  function turnSelector(provider) {
    const t = turnSelectors(provider);
    return t.user.concat(t.model).join(", ");
  }

  return {
    providerForHost,
    sessionIdFromPath,
    responseSelectors,
    turnSelectors,
    turnSelector,
    PROVIDERS,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.sites;
