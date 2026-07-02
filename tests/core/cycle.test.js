import { describe, it, expect } from "vitest";
import cycle from "../../src/core/cycle.js";

const { nextId } = cycle;
const ids = ["a", "b", "c"];

describe("cycle.nextId", () => {
  it("moves forward and backward with wraparound", () => {
    expect(nextId(ids, "a", 1)).toBe("b");
    expect(nextId(ids, "c", 1)).toBe("a");
    expect(nextId(ids, "a", -1)).toBe("c");
    expect(nextId(ids, "b", -1)).toBe("a");
  });

  it("starts at the ends when nothing is current", () => {
    expect(nextId(ids, null, 1)).toBe("a");
    expect(nextId(ids, null, -1)).toBe("c");
    expect(nextId(ids, "unknown", 1)).toBe("a");
  });

  it("handles empty lists", () => {
    expect(nextId([], "a", 1)).toBeNull();
    expect(nextId(null, "a", 1)).toBeNull();
  });
});
