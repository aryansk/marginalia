import { describe, it, expect, beforeEach } from "vitest";
import sessionBindings from "../../src/core/session-bindings.js";

let b;
beforeEach(() => {
  b = sessionBindings.create();
});

describe("session pinning", () => {
  it("binds a thread to a session and reads it back", () => {
    b.bind("t1", "gemini:abc");
    expect(b.has("t1")).toBe(true);
    expect(b.sessionFor("t1")).toBe("gemini:abc");
  });

  it("normalizes undefined to the draft session (null)", () => {
    b.bind("t1", undefined);
    expect(b.sessionFor("t1")).toBeNull();
  });

  it("sessionFor is undefined for unbound/deleted threads (writes must be dropped)", () => {
    expect(b.sessionFor("nope")).toBeUndefined();
    b.bind("t1", "s");
    b.unbind("t1");
    expect(b.has("t1")).toBe(false);
    expect(b.sessionFor("t1")).toBeUndefined();
  });

  it("a pin survives a session switch (the controller never rebinds on route change)", () => {
    b.bind("t1", "gemini:A");
    // route change to B: no rebinding happens; a late persist still sees A
    expect(b.sessionFor("t1")).toBe("gemini:A");
  });
});

describe("rebindDrafts (draft-bucket birth)", () => {
  it("moves only draft-bound threads to the new session", () => {
    b.bind("draft1", null);
    b.bind("draft2", null);
    b.bind("old", "gemini:A");
    const moved = b.rebindDrafts("gemini:B");
    expect(moved.sort()).toEqual(["draft1", "draft2"]);
    expect(b.sessionFor("draft1")).toBe("gemini:B");
    expect(b.sessionFor("draft2")).toBe("gemini:B");
    expect(b.sessionFor("old")).toBe("gemini:A"); // earlier pin untouched
  });

  it("is a no-op for a null target", () => {
    b.bind("draft1", null);
    expect(b.rebindDrafts(null)).toEqual([]);
    expect(b.sessionFor("draft1")).toBeNull();
  });
});

describe("ask-handle tracking", () => {
  const handle = () => ({ stop() {}, abort() {} });

  it("tracks and untracks handles per thread", () => {
    const h1 = handle();
    const h2 = handle();
    b.bind("t1", "s");
    b.trackAsk("t1", h1);
    b.trackAsk("t1", h2);
    expect(b.handlesFor("t1")).toHaveLength(2);
    b.untrackAsk("t1", h1);
    expect(b.handlesFor("t1")).toEqual([h2]);
    expect(b.handlesFor("t2")).toEqual([]);
  });

  it("drainHandles returns every live handle once and clears tracking", () => {
    const h1 = handle();
    const h2 = handle();
    b.trackAsk("t1", h1);
    b.trackAsk("t2", h2);
    const drained = b.drainHandles();
    expect(drained).toHaveLength(2);
    expect(drained).toContain(h1);
    expect(drained).toContain(h2);
    expect(b.handlesFor("t1")).toEqual([]);
    expect(b.drainHandles()).toEqual([]);
  });

  it("unbind drops the thread's handles", () => {
    b.bind("t1", "s");
    b.trackAsk("t1", handle());
    b.unbind("t1");
    expect(b.handlesFor("t1")).toEqual([]);
  });
});
