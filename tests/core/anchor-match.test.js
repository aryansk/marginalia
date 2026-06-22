import { describe, it, expect } from "vitest";
import anchorMatch from "../../src/core/anchor-match.js";

const { bestMatch, commonPrefixLen, commonSuffixLen } = anchorMatch;

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

  it("falls back to the first occurrence with no prefix/suffix", () => {
    const full = "page and page";
    expect(bestMatch(full, { exact: "page" })).toBe(0);
  });

  it("returns -1 when not found or exact is empty", () => {
    expect(bestMatch("nothing here", { exact: "zzz" })).toBe(-1);
    expect(bestMatch("abc", { exact: "" })).toBe(-1);
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
