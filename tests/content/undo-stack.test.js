import { describe, it, expect } from "vitest";
import { UndoStack } from "../../src/content/undo-stack.js";

describe("UndoStack", () => {
  it("undo/redo replay a linear history", () => {
    const s = UndoStack(50);
    s.push("a");
    s.push("b");
    expect(s.size()).toBe(2);

    // Undo returns the most-recent snapshot, saving `current` for redo.
    expect(s.undo("c")).toBe("b");
    expect(s.undo("b")).toBe("a");
    // Empty stack → no-op (undefined) so the caller lets the event fall through.
    expect(s.undo("a")).toBe(undefined);

    // Redo walks forward through the states we undid past.
    expect(s.redo("a")).toBe("b");
    expect(s.redo("b")).toBe("c");
    expect(s.redo("c")).toBe(undefined);
  });

  it("a new push discards the redo stack (history forks)", () => {
    const s = UndoStack(50);
    s.push("a");
    expect(s.undo("b")).toBe("a"); // redo now holds "b"
    s.push("x"); // fresh edit forks history
    expect(s.redo("y")).toBe(undefined);
  });

  it("over-cap pushes drop the oldest, keeping the newest cap", () => {
    const s = UndoStack(2);
    s.push("a");
    s.push("b");
    s.push("c"); // "a" evicted
    expect(s.size()).toBe(2);
    expect(s.undo("d")).toBe("c");
    expect(s.undo("c")).toBe("b");
    expect(s.undo("b")).toBe(undefined); // "a" is gone
  });

  it("reset() clears both stacks", () => {
    const s = UndoStack(50);
    s.push("a");
    s.push("b");
    s.reset();
    expect(s.size()).toBe(0);
    expect(s.undo("x")).toBe(undefined);
  });
});
