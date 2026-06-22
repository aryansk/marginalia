import { describe, it, expect } from "vitest";
import layout from "../../src/core/layout-engine.js";

const { computeLayout, computeGutterBox, DEFAULTS } = layout;
const VP = { height: 800 };

function run(items, extra = {}) {
  return computeLayout(Object.assign({ items, viewport: VP }, extra));
}

describe("computeGutterBox", () => {
  it("uses the width fraction, clamped to [MIN, MAX], right-aligned", () => {
    expect(computeGutterBox(1000)).toEqual({ width: 320, left: 1000 - 320 - DEFAULTS.MARGIN });
    expect(computeGutterBox(3000).width).toBe(DEFAULTS.MAX_WIDTH); // clamped up-bound
    expect(computeGutterBox(700).width).toBe(DEFAULTS.MIN_WIDTH); // clamped low-bound
  });
});

describe("computeLayout — basics", () => {
  it("returns nothing for zero items", () => {
    expect(run([])).toEqual({ placements: [], drawered: [], clusterCount: 0 });
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

  it("clamps an anchor below the viewport into view", () => {
    const { placements } = run([{ id: "a", order: 0, anchorTop: 100000, naturalHeight: 200 }]);
    expect(placements[0].top).toBe(VP.height - 200 - DEFAULTS.GAP);
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
