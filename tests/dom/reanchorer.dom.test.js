// @vitest-environment jsdom
// reanchorer.js owns the mutation/scroll sweep: every burst coalesces into ONE
// GA.frame task ("reanchor") whose frame drops stale turn fingerprints (only
// for turns that actually mutated), checks SPA navigation, re-anchors only
// when a thread lost its highlight (otherwise just refreshes anchors), and
// pings settle-watchers. MutationObserver and GA.frame are stubbed so the
// specs drive the observer callback and frame directly.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

class FakeMutationObserver {
  static instances = [];
  constructor(cb) {
    this.cb = cb;
    this.observed = [];
    FakeMutationObserver.instances.push(this);
  }
  observe(target, options) {
    this.observed.push({ target, options });
  }
}

function makeGA() {
  FakeMutationObserver.instances = [];
  const GA = loadGA(["src/content/reanchorer.js"], { MutationObserver: FakeMutationObserver });
  const scheduled = [];
  GA.frame = {
    schedule: vi.fn((name, fn) => scheduled.push({ name, fn })),
  };
  GA.gutter = { onAnchorsMoved: vi.fn() };
  const ctx = {
    reanchor: vi.fn(),
    hasOrphans: vi.fn(() => false),
    checkNav: vi.fn(),
    onSettled: vi.fn(),
  };
  return { GA, ctx, scheduled, observer: () => FakeMutationObserver.instances[0] };
}

// Mutate + run the coalesced frame, like the real rAF would.
function fireMutation(h, records) {
  h.observer().cb(records);
  runFrame(h);
}
function runFrame(h) {
  const last = h.scheduled[h.scheduled.length - 1];
  expect(last.name).toBe("reanchor"); // always the same coalescing key
  last.fn();
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("reanchorer.observe — wiring", () => {
  it("watches the whole document body subtree for child-list changes", () => {
    const h = makeGA();
    h.GA.reanchorer.observe(h.ctx);
    expect(h.observer().observed).toEqual([
      { target: document.body, options: { childList: true, subtree: true } },
    ]);
  });

  it("schedules the SAME named frame task for mutations and scrolls (coalescing key)", () => {
    const h = makeGA();
    h.GA.reanchorer.observe(h.ctx);
    h.observer().cb([{ target: document.body }]);
    window.dispatchEvent(new Event("scroll"));
    expect(h.GA.frame.schedule).toHaveBeenCalledTimes(2);
    expect(h.scheduled.map((s) => s.name)).toEqual(["reanchor", "reanchor"]);
    expect(h.scheduled[0].fn).toBe(h.scheduled[1].fn); // one frame fn, not forks
  });

  it("mutations confined to our own UI schedule nothing (self-wake filter)", () => {
    const h = makeGA();
    h.GA.reanchorer.observe(h.ctx);
    const gutter = document.createElement("div");
    gutter.className = "ga-gutter";
    const inner = document.createElement("div");
    gutter.appendChild(inner);
    document.body.appendChild(gutter);
    h.observer().cb([{ target: inner }, { target: gutter }]);
    expect(h.GA.frame.schedule).not.toHaveBeenCalled();
    // mixed batch: one page mutation is enough to schedule
    h.observer().cb([{ target: inner }, { target: document.body }]);
    expect(h.GA.frame.schedule).toHaveBeenCalledTimes(1);
  });

  it("scrolls originating inside our own UI schedule nothing; page scrolls pass", () => {
    const h = makeGA();
    h.GA.reanchorer.observe(h.ctx);
    const overlay = document.createElement("div");
    overlay.className = "ga-modal-overlay";
    const body = document.createElement("div");
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    body.dispatchEvent(new Event("scroll", { bubbles: true })); // capture sees it
    expect(h.GA.frame.schedule).not.toHaveBeenCalled();
    const pageScroller = document.createElement("div");
    document.body.appendChild(pageScroller);
    pageScroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(h.GA.frame.schedule).toHaveBeenCalledTimes(1);
  });
});

describe("reanchorer — the per-frame sweep", () => {
  it("no orphans: refreshes anchors instead of re-anchoring, checks nav, pings settle", () => {
    const h = makeGA();
    h.GA.reanchorer.observe(h.ctx);
    fireMutation(h, [{ target: document.body }]);
    expect(h.ctx.checkNav).toHaveBeenCalledTimes(1);
    expect(h.ctx.reanchor).not.toHaveBeenCalled();
    expect(h.GA.gutter.onAnchorsMoved).toHaveBeenCalledTimes(1);
    expect(h.ctx.onSettled).toHaveBeenCalledTimes(1);
  });

  it("orphans present: re-anchors and does NOT double-drive the anchor refresh", () => {
    const h = makeGA();
    h.ctx.hasOrphans.mockReturnValue(true);
    h.GA.reanchorer.observe(h.ctx);
    fireMutation(h, [{ target: document.body }]);
    expect(h.ctx.reanchor).toHaveBeenCalledTimes(1);
    // the pass receives the fingerprint-invalidation hint (futile-skip input)
    expect(h.ctx.reanchor).toHaveBeenCalledWith({ textChanged: false });
    expect(h.GA.gutter.onAnchorsMoved).not.toHaveBeenCalled();
    expect(h.ctx.onSettled).toHaveBeenCalledTimes(1);
  });

  it("works without the optional checkNav/onSettled hooks", () => {
    const h = makeGA();
    h.GA.reanchorer.observe({ reanchor: h.ctx.reanchor, hasOrphans: () => false });
    expect(() => fireMutation(h, [{ target: document.body }])).not.toThrow();
    expect(h.GA.gutter.onAnchorsMoved).toHaveBeenCalledTimes(1);
  });
});

describe("reanchorer — stale-fingerprint invalidation", () => {
  it("invalidates ONCE per mutated turn, even when many records hit the same turn", () => {
    const h = makeGA();
    const turnEl = { id: "turn1" };
    const n1 = {};
    const n2 = {};
    h.GA.turns = {
      turnOf: vi.fn((node) => (node === n1 || node === n2 ? { el: turnEl } : null)),
      invalidate: vi.fn(),
    };
    h.GA.reanchorer.observe(h.ctx);
    fireMutation(h, [{ target: n1 }, { target: n2 }, { target: n1 }]);
    expect(h.GA.turns.invalidate).toHaveBeenCalledTimes(1);
    expect(h.GA.turns.invalidate).toHaveBeenCalledWith(turnEl);
  });

  it("distinct mutated turns each get invalidated; nodes outside any turn don't", () => {
    const h = makeGA();
    const t1 = { id: "t1" };
    const t2 = { id: "t2" };
    const in1 = { turn: t1 };
    const in2 = { turn: t2 };
    const outside = {};
    h.GA.turns = {
      turnOf: vi.fn((node) => (node.turn ? { el: node.turn } : null)),
      invalidate: vi.fn(),
    };
    h.GA.reanchorer.observe(h.ctx);
    fireMutation(h, [{ target: in1 }, { target: outside }, { target: in2 }]);
    expect(h.GA.turns.invalidate.mock.calls.map(([el]) => el)).toEqual([t1, t2]);
  });

  it("the dirty set drains: a second frame with no new mutations invalidates nothing more", () => {
    const h = makeGA();
    const turnEl = {};
    h.GA.turns = { turnOf: vi.fn(() => ({ el: turnEl })), invalidate: vi.fn() };
    h.GA.reanchorer.observe(h.ctx);
    fireMutation(h, [{ target: {} }]);
    expect(h.GA.turns.invalidate).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("scroll")); // schedules a fresh frame, no records
    runFrame(h);
    expect(h.GA.turns.invalidate).toHaveBeenCalledTimes(1); // still once
  });

  it("a frame before GA.turns exists just drains the dirty set without throwing", () => {
    const h = makeGA();
    h.GA.turns = undefined;
    h.GA.reanchorer.observe(h.ctx);
    expect(() => fireMutation(h, [{ target: {} }])).not.toThrow();
    // once turns appears, the stale node is NOT retro-invalidated (it drained)
    h.GA.turns = { turnOf: vi.fn(() => null), invalidate: vi.fn() };
    window.dispatchEvent(new Event("scroll"));
    runFrame(h);
    expect(h.GA.turns.turnOf).not.toHaveBeenCalled();
  });

  it("records without a target are ignored (and alone schedule no frame)", () => {
    const h = makeGA();
    h.GA.turns = { turnOf: vi.fn(), invalidate: vi.fn() };
    h.GA.reanchorer.observe(h.ctx);
    h.observer().cb([{ target: null }, {}]);
    expect(h.GA.frame.schedule).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("scroll"));
    runFrame(h);
    expect(h.GA.turns.turnOf).not.toHaveBeenCalled();
  });
});
