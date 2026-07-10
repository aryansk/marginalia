// @vitest-environment jsdom
//
// The cascade, exercised against the real captured Gemini conversation.
//
// The reported bug: a word selected in a model answer re-anchored, after
// reload, onto an EARLIER user question that contained the same word. In this
// fixture "replication" appears in the first question and in three later
// answers, and the first whole-page occurrence is inside the question.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadGA } from "../helpers/loadGA.js";

const HTML = readFileSync(
  resolve(__dirname, "../fixtures/gemini-conversation.html"),
  "utf8",
);

const MODULES = [
  "src/core/sites.js",
  "src/core/anchor-match.js",
  "src/core/turn-id.js",
  "src/content/anchor.js",
  "src/content/turns.js",
  "src/content/selection.js",
];

let GA;

function mount(html = HTML) {
  document.body.innerHTML = html;
  GA = loadGA(MODULES);
  GA.provider = "gemini";
  return GA;
}

// A Range over the nth occurrence of `word` inside `root`, within one text node.
function rangeOverWord(root, word, nth = 0) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  let seen = 0;
  while ((n = w.nextNode())) {
    let from = 0;
    for (;;) {
      const i = n.nodeValue.indexOf(word, from);
      if (i < 0) break;
      if (seen++ === nth) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + word.length);
        return r;
      }
      from = i + 1;
    }
  }
  return null;
}

// Mirror what capture() records, without depending on window.getSelection.
function threadFrom(turnEl, word, nth = 0) {
  const range = rangeOverWord(turnEl, word, nth);
  expect(range, `no range for "${word}"`).not.toBeNull();
  return {
    id: "t1",
    selector: GA.anchor.fromRange(range, turnEl),
    anchor: { v: 2, role: GA.turns.roleOf(turnEl), turn: GA.turns.fingerprintOf(turnEl) },
    section: turnEl.textContent.replace(/\s+/g, " ").trim().slice(0, 4000),
  };
}

const turns = () => GA.turns.findTurns();
const modelTurns = () => turns().filter((t) => t.role === "model");
const text = (el) => GA.turns.textOf(el).replace(/\s+/g, " ");

describe("the reported bug", () => {
  beforeEach(() => mount());

  it("the fixture reproduces the setup: word in an early question and later answers", () => {
    const all = turns();
    expect(all[0].role).toBe("user");
    expect(text(all[0].el).toLowerCase()).toContain("replication");
    expect(modelTurns().filter((t) => /replication/i.test(text(t.el))).length).toBeGreaterThan(1);
  });

  it("re-anchors into the SAME answer after the page is rebuilt", () => {
    const answer = modelTurns()[2].el; // the ClickHouse answer
    const thread = threadFrom(answer, "replication");

    mountAgain();
    const hit = GA.selection.locateThread(thread);

    expect(hit).not.toBeNull();
    expect(hit.turnEl.tagName.toLowerCase()).toBe("model-response");
    expect(hit.turnEl).toBe(modelTurns()[2].el);
    expect(hit.range.toString()).toBe("replication");
  });

  it("never lands on the question, even though it holds the first occurrence", () => {
    const answer = modelTurns()[2].el;
    const thread = threadFrom(answer, "replication");
    mountAgain();

    const hit = GA.selection.locateThread(thread);
    const question = turns()[0].el;
    expect(question.contains(hit.range.startContainer)).toBe(false);
    expect(GA.turns.roleOf(hit.turnEl)).toBe("model");
  });

  it("picks the right occurrence within the answer, not merely the right answer", () => {
    const answer = modelTurns()[2].el;
    const thread = threadFrom(answer, "replication", 3); // the 4th one
    expect(thread.selector.occurrence).toBe(3);
    mountAgain();

    const hit = GA.selection.locateThread(thread);
    // Compare against the range we would build over the 4th occurrence in the
    // freshly rendered answer — same node, same offset, or it found another one.
    const expected = rangeOverWord(modelTurns()[2].el, "replication", 3);
    expect(hit.range.startContainer).toBe(expected.startContainer);
    expect(hit.range.startOffset).toBe(expected.startOffset);

    // And it is genuinely a different spot from the first occurrence.
    const first = rangeOverWord(modelTurns()[2].el, "replication", 0);
    expect(hit.range.startOffset === first.startOffset && hit.range.startContainer === first.startContainer).toBe(false);
  });
});

describe("role is a hard gate", () => {
  beforeEach(() => mount());

  it("a thread born in an answer is never offered a question", () => {
    const question = turns()[0].el;
    const quoted = threadFrom(question, "replication");

    // WITHOUT a role, the quote+section resolve straight back to the question.
    // This is the control: it proves the fixture and the locate path work.
    const noRole = { ...quoted };
    delete noRole.anchor;
    mountAgain();
    const control = GA.selection.locateThread(noRole);
    expect(control).not.toBeNull();
    expect(control.turnEl.tagName.toLowerCase()).toBe("user-query");

    // WITH role=model and no fingerprint, only the gate can decide. The very
    // same selector must now never resolve into that question.
    const gated = { ...quoted, anchor: { v: 2, role: "model", turn: null } };
    const hit = GA.selection.locateThread(gated);
    if (hit) {
      expect(GA.turns.roleOf(hit.turnEl)).toBe("model");
      expect(hit.turnEl.tagName.toLowerCase()).not.toBe("user-query");
    } else {
      expect(hit).toBeNull(); // refused rather than reached for the question
    }
    // Either way: it did not land where the control landed.
    expect(hit && hit.turnEl === control.turnEl).toBeFalsy();
  });

  it("a thread born in a question re-anchors into that question", () => {
    const question = turns()[0].el;
    const thread = threadFrom(question, "replication");
    mountAgain();

    const hit = GA.selection.locateThread(thread);
    expect(hit).not.toBeNull();
    expect(hit.turnEl.tagName.toLowerCase()).toBe("user-query");
  });
});

describe("violated signals orphan — the search never widens", () => {
  beforeEach(() => mount());

  it("quote absent from its own turn -> orphan, even though another answer has it", () => {
    const answer = modelTurns()[2].el;
    // A word that lives in a DIFFERENT model turn, not in this one.
    const other = modelTurns()[0].el;
    const word = distinctiveWordIn(other, answer);
    const thread = threadFrom(other, word);
    // Claim it belongs to the ClickHouse answer, where the word does not occur.
    thread.anchor.turn = GA.turns.fingerprintOf(answer);

    mountAgain();
    const target = modelTurns()[2].el;
    expect(GA.anchor.textOf(target)).not.toContain(word); // premise
    expect(GA.anchor.textOf(modelTurns()[0].el)).toContain(word); // a widening impl would find it here

    expect(GA.selection.locateThread(thread)).toBeNull();
  });

  it("two identical turns -> orphan rather than guess", () => {
    const answer = modelTurns()[2].el;
    const thread = threadFrom(answer, "replication");

    mountAgain();
    const target = modelTurns()[2].el;
    target.parentNode.insertBefore(target.cloneNode(true), target); // duplicate message

    expect(GA.selection.locateThread(thread)).toBeNull();
  });
});

describe("unavailable signals degrade — and retry", () => {
  beforeEach(() => mount());

  it("nothing hydrated -> orphan, not a whole-page guess", () => {
    const answer = modelTurns()[2].el;
    const thread = threadFrom(answer, "replication");

    document.body.innerHTML = "<div>replication appears here, unowned</div>";
    expect(GA.turns.findTurns()).toEqual([]);
    expect(GA.selection.locateThread(thread)).toBeNull();
  });

  it("only questions hydrated -> orphan; the answer arrives later and it anchors", () => {
    const answer = modelTurns()[2].el;
    const thread = threadFrom(answer, "replication");
    const answerHTML = answer.outerHTML;

    // Partial hydration: Gemini mounts turns lazily inside <infinite-scroller>.
    mountAgain();
    document.querySelectorAll("model-response").forEach((e) => e.remove());
    expect(turns().every((t) => t.role === "user")).toBe(true);
    expect(GA.selection.locateThread(thread)).toBeNull(); // orphan, retried later

    // The answer mounts on scroll.
    const holder = document.createElement("div");
    holder.innerHTML = answerHTML;
    document.body.appendChild(holder.firstChild);

    const hit = GA.selection.locateThread(thread);
    expect(hit).not.toBeNull();
    expect(hit.turnEl.tagName.toLowerCase()).toBe("model-response");
  });
});

describe("legacy threads (no turn identity)", () => {
  beforeEach(() => mount());

  it("fuzzy-matches its turn via the stored section text", () => {
    const answer = modelTurns()[2].el;
    const thread = threadFrom(answer, "replication");
    delete thread.anchor; // created before turn identity existed

    mountAgain();
    const hit = GA.selection.locateThread(thread);
    expect(hit).not.toBeNull();
    expect(hit.turnEl).toBe(modelTurns()[2].el);
  });

  it("gains its role and fingerprint on the first successful anchor (backfill)", () => {
    const answer = modelTurns()[2].el;
    const thread = threadFrom(answer, "replication");
    delete thread.anchor;

    mountAgain();
    const spans = GA.selection.highlightThread(thread);
    expect(spans.length).toBeGreaterThan(0);
    expect(thread.anchor).toBeTruthy();
    expect(thread.anchor.role).toBe("model");
    expect(thread.anchor.turn.hash).toBe(GA.turns.fingerprintOf(modelTurns()[2].el).hash);
  });
});

describe("highlightThread", () => {
  beforeEach(() => mount());

  it("wraps the quote inside the answer and nowhere else", () => {
    const answer = modelTurns()[2].el;
    const thread = threadFrom(answer, "replication");
    mountAgain();

    GA.selection.highlightThread(thread);
    const marks = document.querySelectorAll("span.ga-highlight");
    expect(marks.length).toBeGreaterThan(0);
    marks.forEach((m) => {
      expect(GA.turns.turnOf(m).role).toBe("model");
      expect(turns()[0].el.contains(m)).toBe(false); // never in the question
    });
  });

  it("an orphaned thread injects no highlight anywhere", () => {
    const answer = modelTurns()[2].el;
    const thread = threadFrom(answer, "replication");
    mountAgain();
    document.querySelectorAll("model-response").forEach((e) => e.remove());

    expect(GA.selection.highlightThread(thread)).toEqual([]);
    expect(document.querySelectorAll("span.ga-highlight")).toHaveLength(0);
  });
});

// ---- helpers that need GA ----

// Re-render the page from the same HTML: new nodes, identical text. This is
// what a reload looks like to the extension.
function mountAgain() {
  document.body.innerHTML = HTML;
}

// A word present in `inEl` but absent from `notInEl`.
function distinctiveWordIn(inEl, notInEl) {
  const a = GA.anchor.textOf(inEl);
  const b = GA.anchor.textOf(notInEl);
  const words = a.match(/[A-Za-z]{7,}/g) || [];
  for (const w of words) if (!b.includes(w)) return w;
  throw new Error("no distinctive word found in fixture");
}
