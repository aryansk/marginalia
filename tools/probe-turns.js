// probe-turns.js — paste into the DevTools console on a long AI chat page.
//
// Answers the questions the anchoring fix is built on, from the live DOM
// instead of from inference:
//   1. Which selectors actually match turns, and how many?
//   2. Is `[data-message-author-role]` real here, or dead code?
//   3. Can we tell a user turn from a model turn?
//   4. Do the candidate containers NEST (one real turn matching several ways)?
//   5. Does the page virtualize — are offscreen turns absent from the DOM?
//
// For (5): run it, scroll to the very top of a long conversation, run it again,
// and compare `turnCount`. If the count grows as you scroll, turns are being
// mounted lazily and any document-wide text offset is meaningless.

(() => {
  const CANDIDATES = {
    gemini: [
      "user-query",
      "model-response",
      "message-content",
      ".model-response-text",
      '[data-message-author-role="model"]', // suspected dead code
      ".markdown",
      ".response-container-content",
      ".conversation-container",
    ],
    chatgpt: [
      '[data-message-author-role="user"]',
      '[data-message-author-role="assistant"]',
      "[data-message-id]",
      '[data-testid^="conversation-turn-"]',
      "[data-turn]",
      "div.markdown",
      ".agent-turn",
    ],
    claude: [
      '[data-testid="user-message"]',
      ".font-claude-message",
      ".font-claude-response",
      '[data-testid="assistant-message"]',
      "div.prose",
    ],
  };

  const host = location.hostname;
  const site = host.includes("gemini")
    ? "gemini"
    : host.includes("chatgpt") || host.includes("openai")
      ? "chatgpt"
      : host.includes("claude")
        ? "claude"
        : null;

  if (!site) return console.error("probe-turns: not on a known chat host:", host);

  console.log(`%cprobe-turns — ${site} (${host})`, "font-weight:bold;font-size:13px");

  // 1-3. Which selectors match, and what they look like.
  const rows = CANDIDATES[site].map((sel) => {
    let els = [];
    try {
      els = Array.from(document.querySelectorAll(sel));
    } catch (e) {
      return { selector: sel, count: "INVALID", note: e.message };
    }
    const chars = els.reduce((n, e) => n + (e.textContent || "").length, 0);
    return {
      selector: sel,
      count: els.length,
      totalChars: chars,
      firstText: els[0] ? (els[0].textContent || "").trim().slice(0, 60) : "",
    };
  });
  console.table(rows);

  const dead = rows.filter((r) => r.count === 0).map((r) => r.selector);
  if (dead.length) console.warn("Matches NOTHING on this page:", dead);

  // 4. Nesting — does one real turn match several candidates at once?
  const matched = new Set();
  for (const sel of CANDIDATES[site]) {
    try {
      document.querySelectorAll(sel).forEach((e) => matched.add(e));
    } catch (e) {}
  }
  const all = Array.from(matched);
  const nested = all.filter((e) => all.some((o) => o !== e && o.contains(e)));
  console.log(
    `nesting: ${all.length} matched elements, ${nested.length} of them sit INSIDE another match`,
  );
  if (nested.length) {
    console.warn(
      "Candidates nest. Ranking them as independent turns would see the same turn several times.",
    );
    console.log(
      "outermost-only:",
      all.filter((e) => !all.some((o) => o !== e && o.contains(e))).length,
    );
  }

  // 5. Virtualization + role separation on the best-guess turn containers.
  const TURNS = {
    gemini: ["user-query", "model-response"],
    chatgpt: ['[data-message-author-role="user"]', '[data-message-author-role="assistant"]'],
    claude: ['[data-testid="user-message"]', ".font-claude-response"],
  }[site];

  const userEls = document.querySelectorAll(TURNS[0]);
  const modelEls = document.querySelectorAll(TURNS[1]);
  console.log(
    `role split — user (${TURNS[0]}): ${userEls.length} · model (${TURNS[1]}): ${modelEls.length}`,
  );

  const scroller = document.querySelector("infinite-scroller") || null;
  console.log("infinite-scroller present:", !!scroller);
  console.log(
    `%cturnCount = ${userEls.length + modelEls.length}` +
      " — scroll to the top of a long chat, re-run, and compare.",
    "font-weight:bold",
  );

  return {
    site,
    turnCount: userEls.length + modelEls.length,
    userTurns: userEls.length,
    modelTurns: modelEls.length,
    nestedMatches: nested.length,
    deadSelectors: dead,
    infiniteScroller: !!scroller,
  };
})();
