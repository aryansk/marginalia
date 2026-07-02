import { describe, it, expect } from "vitest";
import adderPosition from "../../src/core/adder-position.js";

const { position, EDGE, GAP } = adderPosition;
const VIEW = { width: 1200, height: 800 };
const PILL = { width: 110, height: 32 };

describe("adderPosition.position", () => {
  it("places the pill centered below the selection", () => {
    const rect = { top: 100, bottom: 120, left: 300, right: 500 };
    const pos = position(rect, PILL, VIEW);
    expect(pos.placement).toBe("below");
    expect(pos.y).toBe(120 + GAP);
    expect(pos.x).toBe((300 + 500) / 2 - PILL.width / 2);
  });

  it("flips above when too close to the bottom edge", () => {
    const rect = { top: 760, bottom: 780, left: 300, right: 500 };
    const pos = position(rect, PILL, VIEW);
    expect(pos.placement).toBe("above");
    expect(pos.y).toBe(760 - GAP - PILL.height);
  });

  it("clamps horizontally inside the viewport", () => {
    const left = position({ top: 100, bottom: 120, left: 0, right: 10 }, PILL, VIEW);
    expect(left.x).toBe(EDGE);
    const right = position({ top: 100, bottom: 120, left: 1190, right: 1200 }, PILL, VIEW);
    expect(right.x).toBe(VIEW.width - PILL.width - EDGE);
  });

  it("never leaves the viewport vertically even for degenerate rects", () => {
    const pos = position({ top: -50, bottom: -30, left: 100, right: 200 }, PILL, VIEW);
    expect(pos.y).toBeGreaterThanOrEqual(EDGE);
  });
});
