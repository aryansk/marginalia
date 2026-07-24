import { describe, it, expect, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// GA.perf: debug-gated timing. Off = pure call-through; on = accumulates
// {count,total,max}; exceptions and promise rejections pass through untouched.

function makeGA(debug) {
  const GA = loadGA(["src/shared/settings-schema.js", "src/content/perf.js"]);
  GA.settings = { debug };
  return GA;
}

describe("GA.perf", () => {
  it("debug off: call-through, nothing recorded", () => {
    const GA = makeGA(false);
    expect(GA.perf.time("x", () => 42)).toBe(42);
    expect(GA.perf.snapshot()).toEqual({});
  });

  it("debug on: accumulates count/total/max per name", () => {
    const GA = makeGA(true);
    GA.perf.time("a", () => 1);
    GA.perf.time("a", () => 2);
    GA.perf.time("b", () => 3);
    const s = GA.perf.snapshot();
    expect(s.a.count).toBe(2);
    expect(s.b.count).toBe(1);
    expect(s.a.total).toBeGreaterThanOrEqual(0);
    expect(s.a.max).toBeGreaterThanOrEqual(0);
  });

  it("exceptions propagate and are still recorded", () => {
    const GA = makeGA(true);
    expect(() =>
      GA.perf.time("boom", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(GA.perf.snapshot().boom.count).toBe(1);
  });

  it("async: returns the exact promise result; rejection propagates; settle recorded", async () => {
    const GA = makeGA(true);
    await expect(GA.perf.time("ok", async () => "done")).resolves.toBe("done");
    await expect(
      GA.perf.time("fail", async () => Promise.reject(new Error("nope"))),
    ).rejects.toThrow("nope");
    await Promise.resolve(); // settle branch promises
    const s = GA.perf.snapshot();
    expect(s.ok.count).toBe(1);
    expect(s.fail.count).toBe(1);
  });

  it("reset clears the window", () => {
    const GA = makeGA(true);
    GA.perf.time("a", () => 1);
    GA.perf.reset();
    expect(GA.perf.snapshot()).toEqual({});
  });

  it("summary flushes via console.debug after the window elapses", () => {
    const GA = makeGA(true);
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const origNow = performance.now.bind(performance);
    let offset = 0;
    vi.spyOn(performance, "now").mockImplementation(() => origNow() + offset);
    GA.perf.time("a", () => 1);
    offset = 6000; // jump past the 5s window
    GA.perf.time("a", () => 1);
    expect(spy).toHaveBeenCalledWith("[marginalia perf]", expect.any(Object));
    vi.restoreAllMocks();
  });
});
