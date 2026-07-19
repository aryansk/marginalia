import { describe, it, expect } from "vitest";
import parser from "../../src/openai/parser.js";

const { parseLatest } = parser;

describe("openai parseLatest", () => {
  it("returns null before any content delta", () => {
    expect(parseLatest("")).toBeNull();
    expect(parseLatest(": keep-alive\n\n")).toBeNull();
  });

  it("concatenates delta.content across events", () => {
    const raw = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      "data: [DONE]",
    ].join("\n");
    expect(parseLatest(raw)).toBe("Hello");
  });

  it("skips malformed lines without throwing", () => {
    const raw = ["data: {bad}", 'data: {"choices":[{"delta":{"content":"ok"}}]}'].join("\n");
    expect(parseLatest(raw)).toBe("ok");
  });
});
