import { describe, it, expect } from "vitest";
import convoMerge from "../../src/core/convo-merge.js";

// Pure merge policy for the convo transcript index (extracted from
// convo-capture.js): key derivation, the shape guard, the stale-partial
// upgrade, and the two provability rules that license a merge. The end-to-end
// behavior against a real store stays covered by the convo-capture specs.

const {
  blobKey,
  turnKey,
  wellFormed,
  upgradeStale,
  subsequence,
  sharedUniquePair,
  isMergeProvable,
} = convoMerge;

// Minimal turn factory — fp is fabricated (hash from text length) because the
// policy only compares identities, never recomputes them.
let hashSeed = 0;
function turn(role, text, head) {
  hashSeed += 1;
  return {
    role,
    text,
    fp: { hash: 1000 + text.length * 31 + hashSeed, len: text.length },
    head: head !== undefined ? head : text.slice(0, 16),
    order: 0,
  };
}
// Same identity, fresh object (a re-mounted copy of an existing turn).
const twin = (t) => ({ role: t.role, fp: { ...t.fp }, head: t.head, order: t.order });

describe("keys and shape guard", () => {
  it("blobKey is hash:len; turnKey prefixes the role", () => {
    const t = { role: "model", fp: { hash: 42, len: 7 } };
    expect(blobKey(t)).toBe("42:7");
    expect(turnKey(t)).toBe("model:42:7");
  });

  it("wellFormed requires role plus a numeric hash AND len", () => {
    expect(wellFormed({ role: "user", fp: { hash: 1, len: 2 } })).toBe(true);
    expect(wellFormed(null)).toBe(false);
    expect(wellFormed({})).toBe(false);
    expect(wellFormed({ role: "user" })).toBe(false);
    expect(wellFormed({ role: "user", fp: { hash: "1", len: 2 } })).toBe(false);
    expect(wellFormed({ fp: { hash: 1, len: 2 } })).toBe(false);
  });
});

describe("subsequence", () => {
  it("holds for an in-order (possibly gapped) embedding, including the empty list", () => {
    expect(subsequence([], ["a", "b"])).toBe(true);
    expect(subsequence(["a", "c"], ["a", "b", "c"])).toBe(true);
    expect(subsequence(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("fails on out-of-order or missing keys", () => {
    expect(subsequence(["c", "a"], ["a", "b", "c"])).toBe(false);
    expect(subsequence(["a", "z"], ["a", "b", "c"])).toBe(false);
  });
});

describe("sharedUniquePair", () => {
  it("true when both sides contain the same adjacent pair exactly once", () => {
    expect(sharedUniquePair(["x", "a", "b"], ["a", "b", "y"])).toBe(true);
  });

  it("false when the sides only share a single key", () => {
    expect(sharedUniquePair(["x", "a", "y"], ["p", "a", "q"])).toBe(false);
  });

  it("a pair repeated on one side is a false anchor and does not license", () => {
    // "continue"-style duplication: the pair (a,b) occurs twice in the stored
    // index, so one occurrence in the snapshot proves nothing about position.
    expect(sharedUniquePair(["a", "b", "z", "a", "b"], ["a", "b", "w"])).toBe(false);
  });
});

describe("upgradeStale", () => {
  it("re-keys a stored partial to the live turn that grew out of it, one-to-one", () => {
    const partial = turn("model", "A monad is");
    const full = turn("model", "A monad is a monoid in the category of endofunctors.");
    full.head = partial.head + " a monoid in the"; // stored head is a prefix
    const up = upgradeStale([partial], [full]);
    expect(up.turns).toEqual([
      { role: "model", fp: full.fp, order: partial.order, head: full.head },
    ]);
    expect(up.replacedKeys).toEqual([blobKey(partial)]);
  });

  it("one live turn is claimed at most once — a second matching partial keeps itself", () => {
    const p1 = turn("model", "Yes", "Yes");
    const p2 = turn("model", "Yes ", "Yes");
    const full = turn("model", "Yes and here is more detail.", "Yes and here is");
    const up = upgradeStale([p1, p2], [full]);
    expect(up.turns[0].fp).toEqual(full.fp); // first partial claims the growth
    expect(up.turns[1]).toBe(p2); // second stays untouched
    expect(up.replacedKeys).toEqual([blobKey(p1)]);
  });

  it("skips entries still mounted verbatim, cross-role growth, and headless legacy entries", () => {
    const mounted = turn("model", "short answer");
    const headless = { role: "model", fp: { hash: 9, len: 4 }, order: 1 }; // legacy: no head
    const crossRole = turn("user", "grew", "grew");
    const grown = turn("model", "grew a lot longer than before", "grew a lot");
    const up = upgradeStale([mounted, headless, crossRole], [twin(mounted), grown]);
    expect(up.turns[0]).toBe(mounted);
    expect(up.turns[1]).toBe(headless);
    expect(up.turns[2]).toBe(crossRole); // same head prefix, wrong role
    expect(up.replacedKeys).toEqual([]);
  });

  it("never claims a live turn some stored entry already matches exactly", () => {
    const partial = turn("model", "Yes", "Yes");
    const full = turn("model", "Yes with elaboration", "Yes with elabora");
    const up = upgradeStale([partial, full], [twin(full)]);
    // full's live twin is already indexed — claiming it for the partial would
    // mint a phantom duplicate through the multiset merge
    expect(up.turns[0]).toBe(partial);
    expect(up.turns[1]).toBe(full);
    expect(up.replacedKeys).toEqual([]);
  });
});

describe("isMergeProvable", () => {
  const A = turn("user", "first question");
  const B = turn("model", "first answer");
  const C = turn("user", "second question");
  const D = turn("model", "second answer");

  it("an empty prior index is always provable (nothing to misplace)", () => {
    expect(isMergeProvable([], [A, B])).toBe(true);
  });

  it("provable when the stored index is an ordered subsequence of the snapshot", () => {
    expect(isMergeProvable([A, B], [A, B, C, D])).toBe(true);
    expect(isMergeProvable([A, C], [A, B, C])).toBe(true); // gapped is fine
  });

  it("provable via a shared unique adjacent pair even when the index is not fully visible", () => {
    // stored [A,B,C]; live window slid up: C unmounted, but the run A,B anchors
    expect(isMergeProvable([A, B, C], [D, A, B])).toBe(true);
  });

  it("unprovable for disjoint windows — even ones sharing a single duplicate key", () => {
    expect(isMergeProvable([A, B], [C, D])).toBe(false);
    // the same "continue" turn appears in both windows: one shared key, no pair
    const cont = turn("user", "continue");
    expect(isMergeProvable([A, cont], [cont, D])).toBe(false);
  });
});
