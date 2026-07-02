import { describe, it, expect } from "vitest";
import streamDelta from "../../src/shared/stream-delta.js";

const { next } = streamDelta;

describe("streamDelta.next", () => {
  it("emits only the appended text when the answer grows", () => {
    expect(next("", "Hel")).toEqual({ delta: "Hel" });
    expect(next("Hel", "Hello")).toEqual({ delta: "lo" });
  });

  it("returns null when nothing changed", () => {
    expect(next("same", "same")).toBeNull();
    expect(next("", "")).toBeNull();
  });

  it("signals a reset when earlier text was rewritten", () => {
    expect(next("Hello wrold", "Hello world")).toEqual({ reset: true, text: "Hello world" });
  });

  it("a shrink is a reset too (revision frames)", () => {
    expect(next("longer text", "long")).toEqual({ reset: true, text: "long" });
  });

  it("reassembly reproduces every full-text step", () => {
    const steps = ["He", "Hell", "Hello ", "Hello world", "Hello, world"]; // incl. one rewrite
    let sent = "";
    let acc = "";
    for (const full of steps) {
      const d = next(sent, full);
      if (!d) continue;
      sent = full;
      if (d.reset) acc = d.text;
      else acc += d.delta;
      expect(acc).toBe(full);
    }
  });

  it("handles null/undefined defensively", () => {
    expect(next(null, "x")).toEqual({ delta: "x" });
    expect(next("x", null)).toEqual({ reset: true, text: "" });
  });
});
