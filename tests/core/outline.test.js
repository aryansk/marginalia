import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// outline.js is pure and binds only to GA.core.turnId.
const GA = loadGA(["src/core/turn-id.js", "src/core/outline.js"]);
const O = GA.core.outline;
const fp = (text) => GA.core.turnId.fingerprint(text);

const stored = (role, head, order) => ({ role, fp: fp(head), order, head });
const live = (role, text) => ({ el: { tag: text }, role, fp: fp(text), text });
let seq = 0;
const thread = (over = {}) => ({
  id: "t" + ++seq,
  selector: { exact: "quoted words" },
  anchor: null,
  messages: [],
  createdAt: 1000 + seq,
  ...over,
});
const anchorTo = (role, text) => ({ v: 2, role, turn: fp(text) });

describe("turn helpers shared with transcript.js", () => {
  it("sortedTurns orders by `order`, then array position; missing order sinks", () => {
    const t = [
      { role: "user", text: "c", order: 2 },
      { role: "user", text: "z" },
      { role: "user", text: "a", order: 0 },
      { role: "user", text: "b", order: 1 },
      null,
    ];
    expect(O.sortedTurns({ turns: t }).map((x) => x.text)).toEqual(["a", "b", "c", "z"]);
    expect(O.sortedTurns(null)).toEqual([]);
  });

  it("dedupeTurns collapses consecutive same-role strict-prefix partials, reading head or text", () => {
    const t = [
      { role: "user", text: "Q" },
      { role: "model", head: "Lifetimes are" },
      { role: "model", text: "Lifetimes are how the borrow checker reasons." },
      { role: "model", text: "Lifetimes are" }, // cur is a partial of prev → dropped
      { role: "user", text: "Q" }, // identical repeats survive
      { role: "user", text: "Q" },
    ];
    const kept = O.dedupeTurns(t);
    expect(kept.map((x) => x.text || x.head)).toEqual([
      "Q",
      "Lifetimes are how the borrow checker reasons.",
      "Q",
      "Q",
    ]);
  });

  it("orderedThreads sorts by createdAt then position", () => {
    const a = thread({ createdAt: 5 });
    const b = thread({ createdAt: 1 });
    const c = thread({ createdAt: undefined });
    expect(O.orderedThreads([a, c, b])).toEqual([b, a, c]);
  });

  it("locateThread: fingerprint hit, then role-guarded quote containment, else -1", () => {
    const turns = [
      { role: "user", text: "please explain quoted words" },
      { role: "model", text: "sure: quoted words mean this" },
    ];
    expect(O.locateThread(thread({ anchor: anchorTo("model", turns[1].text) }), turns)).toBe(1);
    // stale fp (partial) → fallback by quote, honouring the recorded role
    expect(O.locateThread(thread({ anchor: anchorTo("model", "sure: quoted") }), turns)).toBe(1);
    expect(O.locateThread(thread({ anchor: null }), turns)).toBe(0); // no role → first container
    expect(O.locateThread(thread({ selector: { exact: "absent" } }), turns)).toBe(-1);
    expect(O.locateThread(thread({ selector: null }), turns)).toBe(-1);
  });
});

describe("rowText", () => {
  it("collapses whitespace and truncates with an ellipsis at the limit", () => {
    expect(O.rowText("  a \n b  ", "user", "chatgpt", 80)).toBe("a b");
    const out = O.rowText("x".repeat(100), "user", "chatgpt", 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("strips the screen-reader prefix on Gemini only", () => {
    expect(O.rowText(" You said  Hello", "user", "gemini", 80)).toBe("Hello");
    expect(O.rowText("Gemini said: Hi", "model", "gemini", 80)).toBe("Hi");
    expect(O.rowText("You said Hello", "user", "chatgpt", 80)).toBe("You said Hello");
  });
});

describe("build: stored ∪ live, grouped into exchanges", () => {
  const S = [
    stored("user", "first question", 0),
    stored("model", "first answer", 1),
    stored("user", "second question", 2),
    stored("model", "second answer", 3),
  ];

  it("stored only → every row unmounted, one per user turn, model key attached", () => {
    const { rows, unanchored } = O.build({ stored: S, live: [], threads: [], limit: 80 });
    expect(rows.map((r) => r.text)).toEqual(["first question", "second question"]);
    expect(rows.every((r) => !r.mounted && r.el === null)).toBe(true);
    expect(rows[0].modelKey).toBe(O.keyOf("model", fp("first answer")));
    expect(unanchored).toEqual([]);
  });

  it("live turns matching the index mount their rows in place and keep stored order", () => {
    const q2 = live("user", "second question");
    const a2 = live("model", "second answer");
    const { rows } = O.build({ stored: S, live: [q2, a2], threads: [], limit: 80 });
    expect(rows.map((r) => r.mounted)).toEqual([false, true]);
    expect(rows[1].el).toBe(q2.el);
  });

  it("live-only turns slot next to their indexed neighbour, or at the end", () => {
    const q3 = live("user", "third question");
    const a3 = live("model", "third answer");
    let out = O.build({ stored: S, live: [live("user", "second question"), q3, a3], limit: 80 });
    expect(out.rows.map((r) => r.text)).toEqual([
      "first question",
      "second question",
      "third question",
    ]);
    // no indexed neighbour at all → appended (the mounted window is the tail)
    out = O.build({ stored: S, live: [q3, a3], limit: 80 });
    expect(out.rows.map((r) => r.text)).toEqual([
      "first question",
      "second question",
      "third question",
    ]);
    // unknown turns mounted BEFORE an indexed one land right before it
    out = O.build({
      stored: S,
      live: [live("user", "zeroth"), live("user", "first question")],
      limit: 80,
    });
    expect(out.rows.map((r) => r.text)).toEqual(["zeroth", "first question", "second question"]);
  });

  it("a live turn whose index entry is a stale partial replaces it", () => {
    const partial = [stored("user", "q", 0), stored("model", "The answer is", 1)];
    const full = live("model", "The answer is forty-two.");
    const { rows } = O.build({ stored: partial, live: [live("user", "q"), full], limit: 80 });
    expect(rows.length).toBe(1);
    expect(rows[0].modelKey).toBe(full.key || O.keyOf("model", full.fp));
  });

  it("nothing at all → no rows; live only → all mounted", () => {
    expect(O.build({}).rows).toEqual([]);
    const { rows } = O.build({ live: [live("user", "hi"), live("model", "hello")], limit: 80 });
    expect(rows.length).toBe(1);
    expect(rows[0].mounted).toBe(true);
  });

  it("a leading model turn opens its own row labelled by role", () => {
    const { rows } = O.build({ live: [live("model", "greeting"), live("user", "q")], limit: 80 });
    expect(rows.map((r) => r.role)).toEqual(["model", "user"]);
    expect(O.ROLE_LABEL[rows[0].role]).toBe("Assistant");
  });

  it("threads nest under the exchange owning their turn — user or model — else unanchored", () => {
    const onAnswer = thread({ anchor: anchorTo("model", "first answer"), createdAt: 2 });
    const onQuestion = thread({ anchor: anchorTo("user", "second question"), createdAt: 1 });
    const byQuote = thread({
      anchor: anchorTo("model", "stale partial fp"),
      selector: { exact: "second answer" },
      createdAt: 3,
    });
    const lost = thread({ selector: { exact: "nowhere" }, createdAt: 4 });
    const { rows, unanchored } = O.build({
      stored: S,
      threads: [lost, byQuote, onAnswer, onQuestion],
      limit: 80,
    });
    expect(rows[0].threads).toEqual([onAnswer]);
    expect(rows[1].threads).toEqual([onQuestion, byQuote]); // createdAt order
    expect(unanchored).toEqual([lost]);
  });

  it("applies the provider prefix strip and limit to row text", () => {
    const { rows } = O.build({
      live: [live("user", "You said " + "y".repeat(200))],
      provider: "gemini",
      limit: 20,
    });
    expect(rows[0].text.startsWith("yyy")).toBe(true);
    expect(rows[0].text.length).toBe(20);
  });
});
