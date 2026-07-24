// @vitest-environment jsdom
// The instant relayout path (stream growth) and the animate-flag lifecycle:
// a stream-driven pass must never inherit an eased transform (rubber-banding
// the box against its own growth), and an animate request whose pass skipped
// (inputs unchanged = zero visual delta) is moot — it must not leak onto a
// later unrelated relayout.
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

function makeGA() {
  const GA = loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/core/layout-engine.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/gutter.js",
  ]);
  GA.frame = { schedule: vi.fn() }; // never runs — relayouts happen only when called directly
  GA.panel = { toggle: () => {} };
  GA.supportsCssAnchor = () => false;
  GA.selection = {
    anchorEl: () => null, // lone orphan: parks low, still placed by the write phase
    setActiveHighlight: () => {},
    ensureAnchorName: () => {},
    setHighlightState: () => {},
    setHighlightHover: () => {},
  };
  let h = 100;
  const box = {
    el: document.createElement("div"),
    naturalHeight: () => h,
    chromeHeight: () => 40,
    isCompact: () => false,
    setMaxHeight: () => {},
    invalidateHeight: () => {},
    setActive: () => {},
    setOrphan: () => {},
    setHeight: (v) => (h = v),
  };
  GA.gutter.add("t1", box); // init()s the gutter; arms animateNext via add()
  GA.gutter.relayout(); // consume the add-time flag: a clean baseline signature
  const container = document.querySelector(".ga-gutter");
  return { GA, box, container };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("relayout({instant:true}) — the stream-growth path", () => {
  it("suppresses a pending eased shift (no ga-animate)", () => {
    const { GA, box, container } = makeGA();
    box.setHeight(140);
    GA.gutter.scheduleLayout({ animate: true }); // flag armed; stubbed frame never runs it
    GA.gutter.relayout({ instant: true }); // the stream-flush path
    expect(container.classList.contains("ga-animate")).toBe(false);
  });
});

describe("animateNext lifecycle", () => {
  it("a skipped relayout (inputs unchanged) consumes the flag instead of leaking it", () => {
    const { GA, box, container } = makeGA();
    GA.gutter.scheduleLayout({ animate: true }); // deliberate shift requested…
    GA.gutter.relayout(); // …but nothing changed: the skip must swallow it
    box.setHeight(140); // now something changes
    GA.gutter.relayout(); // plain stream/mutation pass
    expect(container.classList.contains("ga-animate")).toBe(false); // no inherited easing
  });

  it("control: an eased shift still animates when inputs actually changed", () => {
    const { GA, box, container } = makeGA();
    box.setHeight(200);
    GA.gutter.scheduleLayout({ animate: true });
    GA.gutter.relayout();
    expect(container.classList.contains("ga-animate")).toBe(true);
  });
});
