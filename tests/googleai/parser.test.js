import { describe, it, expect } from "vitest";
import parser from "../../src/googleai/parser.js";

const { parseLatest } = parser;

describe("googleai parseLatest", () => {
  it("returns null before any candidate text", () => {
    expect(parseLatest("")).toBeNull();
  });

  it("concatenates candidates[0].content.parts text across events", () => {
    const raw = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hel"}]}}]}',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"lo"}]}}]}',
    ].join("\n");
    expect(parseLatest(raw)).toBe("Hello");
  });

  it("joins multiple parts within one event", () => {
    const raw = 'data: {"candidates":[{"content":{"parts":[{"text":"a"},{"text":"b"}]}}]}';
    expect(parseLatest(raw)).toBe("ab");
  });

  it("skips malformed lines without throwing", () => {
    const raw = [
      "data: {oops",
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
    ].join("\n");
    expect(parseLatest(raw)).toBe("ok");
  });
});
