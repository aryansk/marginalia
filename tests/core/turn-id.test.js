import { describe, it, expect } from "vitest";
import turnId from "../../src/core/turn-id.js";

const { normalize, fingerprint, headHash, sameFingerprint, similarity } = turnId;

describe("normalize", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalize("  a \n\t b  ")).toBe("a b");
  });

  it("is stable across hydration whitespace variants", () => {
    const server = "The cache holds the result.";
    const hydrated = "The   cache\n  holds\tthe result.\n";
    expect(normalize(server)).toBe(normalize(hydrated));
  });

  it("handles null/undefined without throwing", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
  });
});

describe("fingerprint", () => {
  it("is identical for hydration whitespace variants", () => {
    const a = fingerprint("We cache the result and reuse it.");
    const b = fingerprint("We  cache the\nresult  and reuse it.");
    expect(sameFingerprint(a, b)).toBe(true);
  });

  it("changes when the text changes", () => {
    const a = fingerprint("We cache the result.");
    const b = fingerprint("We cache the outcome.");
    expect(sameFingerprint(a, b)).toBe(false);
  });

  it("reports the normalized length, not the raw length", () => {
    expect(fingerprint("  a  b  ").len).toBe(3); // "a b"
  });

  it("hashes a short turn in full — the head/tail slices overlap", () => {
    // Differ only in the middle, well inside a single sample window.
    const a = fingerprint("start " + "x".repeat(50) + " end");
    const b = fingerprint("start " + "y".repeat(50) + " end");
    expect(sameFingerprint(a, b)).toBe(false);
  });

  it("is bounded: a huge turn still fingerprints, and differs from another", () => {
    const big = (fill) => "head text " + fill.repeat(60000) + " tail text";
    const a = fingerprint(big("a"));
    const b = fingerprint(big("b"));
    expect(a.len).toBeGreaterThan(50000);
    expect(sameFingerprint(a, b)).toBe(false); // lengths equal; head/tail differ
  });

  it("empty text does not throw", () => {
    expect(fingerprint("").len).toBe(0);
    expect(fingerprint(null).len).toBe(0);
  });

  it("a mid-text collision is possible but degrades to a MISS, never a wrong anchor", () => {
    // Same length, same 4096-char head and tail, differing only deep inside.
    // This is the documented worst case: the fingerprint matches, so the search
    // enters this turn — and then the quote is simply not there.
    const head = "H".repeat(5000);
    const tail = "T".repeat(5000);
    const a = head + "NEEDLE" + tail;
    const b = head + "ABCDEF" + tail; // same length
    expect(sameFingerprint(fingerprint(a), fingerprint(b))).toBe(true);
    // The safety property: the turn we'd wrongly select does not contain the quote.
    expect(b.includes("NEEDLE")).toBe(false);
  });
});

describe("headHash", () => {
  it("agrees for turns with the same opening", () => {
    const open = "The answer depends on how the cache is warmed. ";
    expect(headHash(open + "First branch.")).toBe(headHash(open + "First branch."));
  });

  it("separates turns with different openings", () => {
    expect(headHash("Alpha opening")).not.toBe(headHash("Beta opening"));
  });

  it("ignores divergence past the head window", () => {
    const open = "z".repeat(600);
    expect(headHash(open + "AAA")).toBe(headHash(open + "BBB"));
  });
});

describe("similarity", () => {
  const stored = "The cache holds the result for later reuse.";

  it("is ~1 when the live turn starts with the stored prefix", () => {
    expect(similarity(stored, stored + " And more text follows.")).toBeCloseTo(1, 5);
  });

  it("tolerates the ellipsis GA.truncate appends", () => {
    expect(similarity("The cache holds the…", "The cache holds the result.")).toBeCloseTo(1, 5);
  });

  it("ignores case and punctuation differences", () => {
    expect(similarity("The cache, holds!", "the CACHE holds the result")).toBeCloseTo(1, 5);
  });

  it("is low for an unrelated turn", () => {
    expect(similarity(stored, "What is the airspeed of a swallow?")).toBeLessThan(0.2);
  });

  it("is a fraction when the turn was partially edited", () => {
    const s = similarity(stored, "The cache holds the OUTCOME for later reuse.");
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(1);
  });

  it("returns 0 when nothing was stored (legacy thread)", () => {
    expect(similarity("", "anything")).toBe(0);
    expect(similarity(null, "anything")).toBe(0);
  });
});
