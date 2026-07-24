// @vitest-environment jsdom
// Anchored-mode cue economy (perf phase 5): the light cue sweep is throttled
// to CUE_SWEEP_MS during sustained scroll/stream (the compositor moves the
// boxes; per-frame O(N) rect reads bought nothing a 4Hz refresh doesn't), and
// it yields entirely to a same-frame full relayout, which publishes exact
// counts itself.
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

function makeGA({ anchored }) {
  const GA = loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/core/layout-engine.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/gutter.js",
  ]);
  const tasks = [];
  GA.frame = { schedule: vi.fn((name, fn) => tasks.push({ name, fn })) };
  GA.panel = { toggle: () => {} };
  GA.supportsCssAnchor = () => anchored;
  GA.selection = {
    anchorEl: vi.fn(() => null),
    setActiveHighlight: () => {},
    ensureAnchorName: () => {},
    setHighlightState: () => {},
    setHighlightHover: () => {},
  };
  const fakeBox = () => {
    const el = document.createElement("div");
    return {
      el,
      naturalHeight: () => 100,
      chromeHeight: () => 40,
      isCompact: () => false,
      setMaxHeight: () => {},
      invalidateHeight: () => {},
      setActive: () => {},
      setOrphan: () => {},
    };
  };
  GA.gutter.add("t1", fakeBox()); // init()s the gutter in the chosen mode
  GA.frame.schedule.mockClear();
  tasks.length = 0;
  return { GA, tasks };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function withClock() {
  const origNow = performance.now.bind(performance);
  let offset = 0;
  vi.spyOn(performance, "now").mockImplementation(() => origNow() + offset);
  return (ms) => (offset += ms);
}

describe("anchored mode: throttled cue sweep", () => {
  it("schedules the cues task at most once per throttle window", () => {
    const tick = withClock();
    const { GA } = makeGA({ anchored: true });
    tick(300); // past the initial stamp
    for (let i = 0; i < 20; i++) GA.gutter.onAnchorsMoved(); // a scroll burst
    const cueCalls = () => GA.frame.schedule.mock.calls.filter(([name]) => name === "cues").length;
    expect(cueCalls()).toBe(1); // one sweep, not twenty

    tick(300); // next window
    GA.gutter.onAnchorsMoved();
    expect(cueCalls()).toBe(2);
  });

  it("JS mode is untouched: every onAnchorsMoved schedules the full layout", () => {
    const { GA } = makeGA({ anchored: false });
    GA.gutter.onAnchorsMoved();
    GA.gutter.onAnchorsMoved();
    const layoutCalls = GA.frame.schedule.mock.calls.filter(([name]) => name === "layout");
    expect(layoutCalls.length).toBe(2); // frame task dedupes downstream, not here
  });
});

describe("cue sweep yields to a queued relayout", () => {
  it("updateCuesLight reads no rects when a full relayout is queued this frame", () => {
    const tick = withClock();
    const { GA, tasks } = makeGA({ anchored: true });
    tick(300);
    GA.gutter.onAnchorsMoved(); // queues the cues task
    GA.gutter.scheduleLayout(); // a full relayout is now queued too
    const cueTask = tasks.find((t) => t.name === "cues");
    cueTask.fn();
    expect(GA.selection.anchorEl).not.toHaveBeenCalled(); // yielded — no double read

    // After the relayout runs (flag cleared), the next sweep reads again.
    const layoutTask = tasks.filter((t) => t.name === "layout").pop();
    layoutTask.fn();
    tick(300);
    GA.gutter.onAnchorsMoved();
    tasks
      .filter((t) => t.name === "cues")
      .pop()
      .fn();
    expect(GA.selection.anchorEl).toHaveBeenCalled();
  });
});
