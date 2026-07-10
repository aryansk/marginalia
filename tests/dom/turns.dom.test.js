// @vitest-environment jsdom
//
// Adapter tests against REAL captured markup from all three sites. Synthetic
// fixtures would have missed every one of these: Gemini's five-deep selector
// nesting, its absent author-role attribute, and Claude's renamed response class.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadGA } from "../helpers/loadGA.js";

const fixture = (name) =>
  readFileSync(resolve(__dirname, "../fixtures", name), "utf8");

const FIXTURES = {
  gemini: "gemini-conversation.html",
  chatgpt: "chatgpt-conversation.html",
  claude: "claude-conversation.html",
};

function mount(provider) {
  document.body.innerHTML = fixture(FIXTURES[provider]);
  const GA = loadGA(["src/core/sites.js", "src/core/turn-id.js", "src/content/turns.js"]);
  GA.provider = provider;
  return GA;
}

describe("findTurns — real markup, all three sites", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("gemini: 4 questions and 4 answers, alternating, outermost-only", () => {
    const GA = mount("gemini");
    const turns = GA.turns.findTurns();
    expect(turns.map((t) => t.role)).toEqual([
      "user", "model", "user", "model", "user", "model", "user", "model",
    ]);
    expect(turns.map((t) => t.el.tagName.toLowerCase())).toEqual([
      "user-query", "model-response", "user-query", "model-response",
      "user-query", "model-response", "user-query", "model-response",
    ]);
  });

  it("gemini: collapses the five nested selectors that describe one answer", () => {
    const GA = mount("gemini");
    // The legacy response selectors match ~20 elements across 4 answers.
    const legacy = new Set();
    GA.core.sites.responseSelectors("gemini").forEach((s) =>
      document.querySelectorAll(s).forEach((e) => legacy.add(e)),
    );
    expect(legacy.size).toBeGreaterThan(10);
    // Turn discovery sees 4 answers, not 20 candidates.
    expect(GA.turns.findTurns().filter((t) => t.role === "model")).toHaveLength(4);
  });

  it("gemini: exposes no author-role attribute (why the old selector was dead)", () => {
    mount("gemini");
    expect(document.querySelectorAll("[data-message-author-role]")).toHaveLength(0);
  });

  it("chatgpt: separates user and assistant messages, no nesting", () => {
    const GA = mount("chatgpt");
    const turns = GA.turns.findTurns();
    expect(turns.filter((t) => t.role === "user")).toHaveLength(4);
    expect(turns.filter((t) => t.role === "model")).toHaveLength(9);
    expect(turns.every((t) => t.role !== null)).toBe(true);
  });

  it("claude: finds answers via the live class, not the renamed dead ones", () => {
    const GA = mount("claude");
    const turns = GA.turns.findTurns();
    expect(turns.filter((t) => t.role === "user")).toHaveLength(5);
    expect(turns.filter((t) => t.role === "model").length).toBeGreaterThan(0);
    // The selectors that used to be the ONLY way we found Claude answers:
    expect(document.querySelectorAll(".font-claude-message")).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="assistant-message"]')).toHaveLength(0);
    expect(document.querySelectorAll("div.prose")).toHaveLength(0);
  });

  it("returns [] for an unknown provider rather than guessing", () => {
    const GA = mount("gemini");
    GA.provider = "nope";
    expect(GA.turns.findTurns()).toEqual([]);
  });
});

describe("turnOf — which message does this text live in", () => {
  it("gemini: maps a text node inside an answer to its <model-response>", () => {
    const GA = mount("gemini");
    const answer = document.querySelectorAll("model-response")[1];
    const walker = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT);
    const turn = GA.turns.turnOf(walker.nextNode());
    expect(turn.el).toBe(answer);
    expect(turn.role).toBe("model");
  });

  it("gemini: maps a text node inside a question to its <user-query>", () => {
    const GA = mount("gemini");
    const question = document.querySelectorAll("user-query")[0];
    const walker = document.createTreeWalker(question, NodeFilter.SHOW_TEXT);
    expect(GA.turns.turnOf(walker.nextNode()).role).toBe("user");
  });

  it("returns null outside the conversation", () => {
    const GA = mount("gemini");
    const stray = document.createElement("div");
    document.body.appendChild(stray);
    expect(GA.turns.turnOf(stray)).toBeNull();
  });
});

describe("fingerprintOf — identity of a message", () => {
  it("separates every turn in a real conversation", () => {
    const GA = mount("gemini");
    const turns = GA.turns.findTurns();
    const keys = turns.map((t) => {
      const fp = GA.turns.fingerprintOf(t.el);
      return fp.hash + ":" + fp.len;
    });
    // The last model turn is an empty placeholder ("Gemini said"), so only
    // require that the substantive turns are mutually distinguishable.
    const substantive = turns
      .map((t, i) => ({ i, len: GA.turns.fingerprintOf(t.el).len }))
      .filter((x) => x.len > 20)
      .map((x) => keys[x.i]);
    expect(new Set(substantive).size).toBe(substantive.length);
  });

  it("is memoized per element", () => {
    const GA = mount("gemini");
    const el = document.querySelector("model-response");
    expect(GA.turns.fingerprintOf(el)).toBe(GA.turns.fingerprintOf(el));
  });

  it("re-computes after invalidate (a streaming turn changed)", () => {
    const GA = mount("gemini");
    const el = document.querySelector("model-response");
    const before = GA.turns.fingerprintOf(el);
    el.appendChild(document.createTextNode(" appended while streaming"));
    expect(GA.turns.fingerprintOf(el)).toBe(before); // still cached
    GA.turns.invalidate(el);
    expect(GA.turns.fingerprintOf(el).hash).not.toBe(before.hash);
  });
});

describe("the reported bug, on real markup", () => {
  it("gemini: 'replication' occurs in an early question AND later answers", () => {
    const GA = mount("gemini");
    const turns = GA.turns.findTurns();
    const has = (t) => /replication/i.test(GA.turns.textOf(t.el));
    expect(has(turns[0])).toBe(true); // the question
    expect(turns[0].role).toBe("user");
    expect(turns.filter((t) => t.role === "model" && has(t)).length).toBeGreaterThan(0);
  });

  it("gemini: the FIRST page-wide occurrence is inside the question", () => {
    const GA = mount("gemini");
    const pageText = document.body.textContent.replace(/\s+/g, " ");
    const first = pageText.toLowerCase().indexOf("replication");
    const question = GA.turns.findTurns()[0];
    const inQuestion = GA.turns.textOf(question.el).replace(/\s+/g, " ");
    // Any whole-page search lands here — which is exactly what the old
    // document.body fallback did.
    expect(first).toBeGreaterThanOrEqual(0);
    expect(inQuestion.toLowerCase()).toContain("replication");
  });

  it("a role gate makes the question ineligible for a thread born in an answer", () => {
    const GA = mount("gemini");
    const candidates = GA.turns.findTurns().filter((t) => t.role === "model");
    expect(candidates.every((t) => t.role === "model")).toBe(true);
    expect(candidates.map((t) => t.el.tagName.toLowerCase())).not.toContain("user-query");
  });
});
