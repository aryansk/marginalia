import { describe, it, expect } from "vitest";
import anchorMatch from "../../src/core/anchor-match.js";

const { evaluate, bestMatch, bestMatchInTurn, commonPrefixLen, commonSuffixLen } = anchorMatch;

describe("bestMatch", () => {
  it("finds the only occurrence", () => {
    const full = "an 8 KB page is used";
    expect(bestMatch(full, { exact: "8 KB page" })).toBe(3);
  });

  it("disambiguates repeats using prefix + suffix", () => {
    const full = "use a 4 KB page, then use an 8 KB page here";
    // both contain "page"; prefix/suffix should select the second
    const idx = bestMatch(full, { exact: "page", prefix: "8 KB ", suffix: " here" });
    expect(full.slice(idx - 5, idx)).toBe("8 KB ");
  });

  it("a unique occurrence still matches with no prefix/suffix", () => {
    expect(bestMatch("only one page here", { exact: "page" })).toBe(9);
  });

  it("refuses to guess between repeats when no context matches (-1)", () => {
    // was: fell back to the first occurrence — silently wrong half the time
    expect(bestMatch("page and page", { exact: "page" })).toBe(-1);
    expect(bestMatch("page and page", { exact: "page", prefix: "zz", suffix: "qq" })).toBe(-1);
  });

  it("repeats WITH matching context still resolve", () => {
    const full = "page and page here";
    expect(bestMatch(full, { exact: "page", suffix: " here" })).toBe(9);
  });

  it("returns -1 when not found or exact is empty", () => {
    expect(bestMatch("nothing here", { exact: "zzz" })).toBe(-1);
    expect(bestMatch("abc", { exact: "" })).toBe(-1);
  });
});

describe("evaluate — context that was recorded must reappear", () => {
  // The reported bug, at the string level. A word selected in a model answer;
  // the same word occurs ONCE in an earlier user question.
  const answer = "For performance, we warm the cache and reuse the result.";
  const question = "Why does the cache miss?";
  const selector = { exact: "cache", prefix: "we warm the ", suffix: " and reuse" };

  it("is confident in the turn the selection came from", () => {
    const ev = evaluate(answer, selector);
    expect(ev.confident).toBe(true);
    expect(answer.slice(ev.index, ev.index + 5)).toBe("cache");
  });

  it("is NOT confident in the wrong turn, though 'the ' agrees by accident", () => {
    // "…does the |cache" incidentally reproduces 4+ chars of "…warm the |".
    // Scoring alone cannot reject this — only `confident` can, because the
    // suffix side has no text to reproduce. Callers that are not already scoped
    // to the right turn MUST gate on `confident`, not on a positive score.
    const ev = evaluate(question, selector);
    expect(ev).not.toBeNull();
    expect(ev.score).toBeGreaterThan(0);
    expect(ev.confident).toBe(false);
  });

  it("rejects a unique occurrence when NOT ONE char of recorded context reappears", () => {
    // This is the guard the old `count > 1` check was missing.
    const ev = evaluate("the page rots", { exact: "page", prefix: "cacheX", suffix: "Yreuse" });
    expect(ev).toBeNull();
    expect(bestMatch("the page rots", { exact: "page", prefix: "cacheX", suffix: "Yreuse" })).toBe(
      -1,
    );
  });

  it("still accepts a unique occurrence when NO context was recorded", () => {
    // Nothing to contradict — absence of evidence, not evidence of absence.
    const ev = evaluate("only one page here", { exact: "page" });
    expect(ev.index).toBe(9);
    expect(ev.confident).toBe(false);
  });

  it("refuses a tie between equally-corroborated repeats instead of taking the earliest", () => {
    // Old behavior: strict `>` kept the first. Earliest means the turn above.
    expect(
      evaluate("a page z and a page z", { exact: "page", prefix: "a ", suffix: " z" }),
    ).toBeNull();
  });

  it("reports occurrence count", () => {
    expect(evaluate("page and page here", { exact: "page", suffix: " here" }).count).toBe(2);
  });
});

describe("bestMatchInTurn — occurrence index inside the originating turn", () => {
  const full = "the cache warms, the cache holds, the cache wins";

  it("returns the recorded occurrence even when an earlier one scores better", () => {
    // Context points at the FIRST "cache"; the occurrence index says the third.
    // Inside a turn we already trust, the index is exact and wins.
    const selector = { exact: "cache", prefix: "the ", suffix: " warms" };
    expect(bestMatchInTurn(full, selector, 2)).toBe(full.lastIndexOf("cache"));
  });

  it("falls back to context matching when the index is stale", () => {
    const selector = { exact: "cache", prefix: "holds, the ", suffix: " wins" };
    expect(bestMatchInTurn(full, selector, 99)).toBe(full.lastIndexOf("cache"));
  });

  it("falls back when no occurrence was recorded (legacy thread)", () => {
    const selector = { exact: "cache", prefix: "holds, the ", suffix: " wins" };
    expect(bestMatchInTurn(full, selector, undefined)).toBe(full.lastIndexOf("cache"));
  });

  it("returns -1 for absent text", () => {
    expect(bestMatchInTurn(full, { exact: "zzz" }, 0)).toBe(-1);
  });
});

describe("commonPrefixLen / commonSuffixLen", () => {
  it("counts the shared prefix length", () => {
    expect(commonPrefixLen("abcd", "abxy")).toBe(2);
    expect(commonPrefixLen("", "abc")).toBe(0);
    expect(commonPrefixLen("abc", "abc")).toBe(3);
  });

  it("counts the shared suffix length", () => {
    expect(commonSuffixLen("xxabc", "yyabc")).toBe(3);
    expect(commonSuffixLen("abc", "")).toBe(0);
    expect(commonSuffixLen("abc", "xbc")).toBe(2);
  });
});
