import { describe, it, expect } from "vitest";
import theme from "../../src/core/theme.js";

const { parseCssColor, relativeLuminance, themeForBackground } = theme;

describe("parseCssColor", () => {
  it("parses rgb()/rgba()/hex forms", () => {
    expect(parseCssColor("rgb(255, 255, 255)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("rgba(30, 31, 34, 0.5)")).toEqual({ r: 30, g: 31, b: 34, a: 0.5 });
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#1e1f22")).toEqual({ r: 30, g: 31, b: 34, a: 1 });
  });

  it("returns null for unparseable values", () => {
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("var(--x)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor(null)).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black, 1 for white, monotonic in between", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1);
    const mid = relativeLuminance({ r: 128, g: 128, b: 128 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("themeForBackground", () => {
  it("classifies real site backgrounds", () => {
    expect(themeForBackground("rgb(255, 255, 255)")).toBe("light"); // ChatGPT light
    expect(themeForBackground("rgb(33, 33, 33)")).toBe("dark"); // ChatGPT dark
    expect(themeForBackground("rgb(27, 28, 29)")).toBe("dark"); // Gemini dark
    expect(themeForBackground("#faf9f5")).toBe("light"); // Claude light
    expect(themeForBackground("rgb(38, 38, 36)")).toBe("dark"); // Claude dark
  });

  it("returns null for transparent/unknown so the caller can sample elsewhere", () => {
    expect(themeForBackground("rgba(0, 0, 0, 0)")).toBeNull();
    expect(themeForBackground("transparent")).toBeNull();
  });
});
