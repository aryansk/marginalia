import { describe, it, expect } from "vitest";
import layout from "../../src/core/layout-engine.js";

const { computeLayout, computeGutterBox, DEFAULTS } = layout;
const VP = { height: 800 };

function run(items, extra = {}) {
  return computeLayout(Object.assign({ items, viewport: VP }, extra));
}

describe("computeGutterBox", () => {
  it("uses the width fraction, clamped to [MIN, MAX], right-aligned (full mode)", () => {
    const w1100 = Math.floor(1100 * DEFAULTS.WIDTH_FRACTION);
    expect(computeGutterBox(1100)).toEqual({
      width: w1100,
      left: 1100 - w1100 - DEFAULTS.MARGIN,
      mode: "full",
    });
    expect(computeGutterBox(3000).width).toBe(DEFAULTS.MAX_WIDTH); // clamped up-bound
    expect(computeGutterBox(3000).mode).toBe("full");
  });

  it("switches to a chip rail on narrow viewports and hides on very narrow ones", () => {
    const rail = computeGutterBox(900);
    expect(rail.mode).toBe("rail");
    expect(rail.width).toBe(DEFAULTS.RAIL_WIDTH);
    expect(rail.left).toBe(900 - DEFAULTS.RAIL_WIDTH - DEFAULTS.MARGIN);
    expect(computeGutterBox(1024).mode).toBe("full"); // breakpoint is exclusive
    expect(computeGutterBox(599).mode).toBe("hidden");
    expect(computeGutterBox(599).width).toBe(0);
  });
});

describe("computeLayout — basics", () => {
  it("returns nothing for zero items", () => {
    expect(run([])).toEqual({
      placements: [],
      drawered: [],
      clusterCount: 0,
      offAbove: [],
      offBelow: [],
    });
  });

  it("places a single tethered box at its anchor level", () => {
    const { placements } = run([{ id: "a", order: 0, anchorTop: 100, naturalHeight: 200 }]);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ id: "a", top: 100, height: 200 });
    expect(placements[0].maxHeight).toBe(200 - DEFAULTS.CHROME); // message-area cap
  });

  it("keeps natural heights and anchor order when everything fits", () => {
    const { placements } = run([
      { id: "b", order: 1, anchorTop: 400, naturalHeight: 150 },
      { id: "a", order: 0, anchorTop: 50, naturalHeight: 150 },
    ]);
    expect(placements.map((p) => p.id)).toEqual(["a", "b"]); // sorted by top
    expect(placements[0].top).toBe(50);
    expect(placements[1].top).toBe(400);
  });

  it("pushes a colliding box down by a gap", () => {
    const { placements } = run([
      { id: "a", order: 0, anchorTop: 100, naturalHeight: 200 },
      { id: "b", order: 1, anchorTop: 100, naturalHeight: 200 },
    ]);
    const [a, b] = placements;
    expect(b.top).toBe(a.top + a.height + DEFAULTS.GAP);
  });

  it("keeps a box tethered near the bottom edge (anchor still in view)", () => {
    const anchorTop = VP.height - 5; // just inside the bottom of the viewport
    const { placements, offBelow } = run([{ id: "a", order: 0, anchorTop, naturalHeight: 200 }]);
    expect(offBelow).toEqual([]);
    expect(placements[0].top).toBe(VP.height - 200 - DEFAULTS.BOTTOM_GAP); // lifted so it stays visible
  });
});

describe("computeLayout — off-screen (anchor scrolled out of view)", () => {
  it("does not place a box whose anchor scrolled above the top; reports it in offAbove", () => {
    const res = run([{ id: "a", order: 0, anchorTop: -50, naturalHeight: 200 }]);
    expect(res.placements).toEqual([]);
    expect(res.offAbove).toEqual(["a"]);
    expect(res.offBelow).toEqual([]);
  });

  it("does not place a box whose anchor scrolled below the bottom; reports it in offBelow", () => {
    const res = run([{ id: "a", order: 0, anchorTop: VP.height + 50, naturalHeight: 200 }]);
    expect(res.placements).toEqual([]);
    expect(res.offAbove).toEqual([]);
    expect(res.offBelow).toEqual(["a"]);
  });

  it("splits a mixed set into placed / above / below", () => {
    const res = run([
      { id: "up", order: 0, anchorTop: -100, naturalHeight: 150 },
      { id: "mid", order: 1, anchorTop: 300, naturalHeight: 150 },
      { id: "down", order: 2, anchorTop: VP.height + 200, naturalHeight: 150 },
    ]);
    expect(res.placements.map((p) => p.id)).toEqual(["mid"]);
    expect(res.offAbove).toEqual(["up"]);
    expect(res.offBelow).toEqual(["down"]);
  });

  it("treats the viewport edges as in-view (0 and height are placed, not off-screen)", () => {
    const res = run([
      { id: "top", order: 0, anchorTop: 0, naturalHeight: 150 },
      { id: "bot", order: 1, anchorTop: VP.height, naturalHeight: 150 },
    ]);
    expect(res.offAbove).toEqual([]);
    expect(res.offBelow).toEqual([]);
    expect(res.placements.map((p) => p.id).sort()).toEqual(["bot", "top"]);
  });

  it("does not count DOM-gone orphans (anchorTop null) as above/below", () => {
    const res = run([
      { id: "t", order: 0, anchorTop: 100, naturalHeight: 150 },
      { id: "o1", order: 1, anchorTop: null, naturalHeight: 150 },
      { id: "o2", order: 2, anchorTop: null, naturalHeight: 150 },
    ]);
    expect(res.clusterCount).toBe(2); // orphan drawer, unchanged
    expect(res.offAbove).toEqual([]);
    expect(res.offBelow).toEqual([]);
  });
});

describe("computeLayout — height sharing on overflow", () => {
  it("water-fills so the total fits the viewport", () => {
    const { placements } = run([
      { id: "a", order: 0, anchorTop: 50, naturalHeight: 700 },
      { id: "b", order: 1, anchorTop: 400, naturalHeight: 700 },
    ]);
    const total = placements.reduce((s, p) => s + p.height, 0) + DEFAULTS.GAP * (placements.length + 1);
    expect(total).toBeLessThanOrEqual(VP.height);
    placements.forEach((p) => expect(p.height).toBeGreaterThanOrEqual(DEFAULTS.MIN_BOX_HEIGHT));
  });

  it("gives the active box a larger share when crowded", () => {
    const { placements } = run(
      [
        { id: "a", order: 0, anchorTop: 50, naturalHeight: 700 },
        { id: "b", order: 1, anchorTop: 400, naturalHeight: 700 },
      ],
      { activeId: "a" }
    );
    const a = placements.find((p) => p.id === "a");
    const b = placements.find((p) => p.id === "b");
    expect(a.height).toBeGreaterThan(b.height);
  });
});

describe("computeLayout — orphans", () => {
  const tethered = { id: "t", order: 0, anchorTop: 100, naturalHeight: 150 };
  const orphan = (id, order) => ({ id, order, anchorTop: null, naturalHeight: 150 });

  it("parks a lone orphan in the margin (no cluster)", () => {
    const res = run([tethered, orphan("o1", 1)]);
    expect(res.clusterCount).toBe(0);
    expect(res.drawered).toEqual([]);
    expect(res.placements.map((p) => p.id).sort()).toEqual(["o1", "t"]);
    // the orphan parks at the bottom
    expect(res.placements.find((p) => p.id === "o1").top).toBeGreaterThan(
      res.placements.find((p) => p.id === "t").top
    );
  });

  it("collapses 2+ orphans into the badge and lays out only the tethered", () => {
    const res = run([tethered, orphan("o1", 1), orphan("o2", 2)]);
    expect(res.clusterCount).toBe(2);
    expect(res.drawered.sort()).toEqual(["o1", "o2"]);
    expect(res.placements.map((p) => p.id)).toEqual(["t"]);
  });

  it("returns a re-anchored orphan to the margin (gains anchorTop)", () => {
    const res = run([
      tethered,
      { id: "o1", order: 1, anchorTop: 300, naturalHeight: 150 }, // was orphan, now anchored
      orphan("o2", 2),
    ]);
    // only one true orphan now -> no cluster, all three placed
    expect(res.clusterCount).toBe(0);
    expect(res.placements.map((p) => p.id).sort()).toEqual(["o1", "o2", "t"]);
  });
});

describe("inputsEqual (relayout skip)", () => {
  const layout = require("../../src/core/layout-engine.js");
  const sig = (over) =>
    Object.assign(
      {
        items: [
          { id: "a", order: 0, anchorTop: 100, naturalHeight: 200 },
          { id: "b", order: 1, anchorTop: 300, naturalHeight: 150 },
        ],
        height: 900,
        left: 1000,
        width: 320,
        activeId: null,
        expanded: false,
      },
      over || {}
    );

  it("equal inputs match; null never matches", () => {
    expect(layout.inputsEqual(sig(), sig())).toBe(true);
    expect(layout.inputsEqual(null, sig())).toBe(false);
  });

  it("any moved anchor, resize, focus or set change breaks equality", () => {
    const a = sig();
    expect(layout.inputsEqual(a, sig({ height: 800 }))).toBe(false);
    expect(layout.inputsEqual(a, sig({ activeId: "a" }))).toBe(false);
    expect(layout.inputsEqual(a, sig({ expanded: true }))).toBe(false);
    const moved = sig();
    moved.items = moved.items.map((it) => (it.id === "b" ? { ...it, anchorTop: 301 } : it));
    expect(layout.inputsEqual(a, moved)).toBe(false);
    const grown = sig();
    grown.items = grown.items.map((it) => (it.id === "a" ? { ...it, naturalHeight: 220 } : it));
    expect(layout.inputsEqual(a, grown)).toBe(false);
    const fewer = sig();
    fewer.items = fewer.items.slice(0, 1);
    expect(layout.inputsEqual(a, fewer)).toBe(false);
  });
});

describe("computeLayout — pinned active box (Docs-style alignment)", () => {
  it("pins the focused box exactly at its anchor and pushes the crowd above upward", () => {
    // three tall boxes anchored close together; focusing the middle one must
    // put it AT its anchor, with the earlier box displaced above.
    const items = [
      { id: "a", order: 0, anchorTop: 190, naturalHeight: 200 },
      { id: "b", order: 1, anchorTop: 200, naturalHeight: 200 },
      { id: "c", order: 2, anchorTop: 210, naturalHeight: 200 },
    ];
    const { placements } = run(items, { activeId: "b" });
    const by = Object.fromEntries(placements.map((p) => [p.id, p]));
    expect(by.b.top).toBe(200); // pinned level with its highlight
    expect(by.a.top + by.a.height + DEFAULTS.GAP).toBeLessThanOrEqual(by.b.top); // pushed up, no overlap
    expect(by.c.top).toBeGreaterThanOrEqual(by.b.top + by.b.height + DEFAULTS.GAP); // flows below
  });

  it("a crowded-out earlier box may slide past the top edge rather than displace the pinned one", () => {
    const items = [
      { id: "a", order: 0, anchorTop: 40, naturalHeight: 300 },
      { id: "b", order: 1, anchorTop: 60, naturalHeight: 300 },
    ];
    const { placements } = run(items, { activeId: "b" });
    const by = Object.fromEntries(placements.map((p) => [p.id, p]));
    expect(by.b.top).toBe(60);
    expect(by.a.top).toBeLessThan(DEFAULTS.GAP); // slid off the top, Docs-style
  });

  it("without a focused box the flow is unchanged (top-down)", () => {
    const { placements } = run([
      { id: "a", order: 0, anchorTop: 100, naturalHeight: 200 },
      { id: "b", order: 1, anchorTop: 100, naturalHeight: 200 },
    ]);
    const [a, b] = placements;
    expect(b.top).toBe(a.top + a.height + DEFAULTS.GAP);
  });
});

describe("computeLayout — collapsed chips", () => {
  it("collapsed items keep natural height (no MIN_BOX_HEIGHT floor) when crowded", () => {
    const CHIP = 32;
    const { placements } = run(
      [
        { id: "chip", order: 0, anchorTop: 50, naturalHeight: CHIP, collapsed: true },
        { id: "a", order: 1, anchorTop: 200, naturalHeight: 700 },
        { id: "b", order: 2, anchorTop: 400, naturalHeight: 700 },
      ],
      { activeId: null }
    );
    const chip = placements.find((p) => p.id === "chip");
    expect(chip.height).toBe(CHIP); // not inflated to MIN_BOX_HEIGHT
    expect(chip.maxHeight).toBeNull(); // no message-area cap for a chip
    const total = placements.reduce((s, p) => s + p.height, 0) + DEFAULTS.GAP * (placements.length + 1);
    expect(total).toBeLessThanOrEqual(VP.height);
  });

  it("a collapsed active box gets no active budget", () => {
    const { placements } = run(
      [
        { id: "chip", order: 0, anchorTop: 50, naturalHeight: 32, collapsed: true },
        { id: "a", order: 1, anchorTop: 200, naturalHeight: 700 },
        { id: "b", order: 2, anchorTop: 400, naturalHeight: 700 },
      ],
      { activeId: "chip" }
    );
    expect(placements.find((p) => p.id === "chip").height).toBe(32);
  });
});
