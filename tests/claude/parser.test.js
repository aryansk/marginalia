import { describe, it, expect } from "vitest";
import parser from "../../src/claude/parser.js";

const { parseLatest } = parser;

describe("claude parseLatest", () => {
  it("returns null before any text fragment", () => {
    expect(parseLatest("")).toBeNull();
    expect(parseLatest("event: ping\ndata: {}\n")).toBeNull();
  });

  it("concatenates legacy completion deltas", () => {
    const raw = [
      'data: {"type":"completion","completion":"Hel"}',
      'data: {"type":"completion","completion":"lo"}',
      "data: [DONE]",
    ].join("\n");
    expect(parseLatest(raw)).toBe("Hello");
  });

  it("concatenates content_block_delta text deltas", () => {
    const raw = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}',
    ].join("\n");
    expect(parseLatest(raw)).toBe("Hi there");
  });

  it("skips malformed lines without throwing", () => {
    const raw = ['data: {oops}', 'data: {"completion":"ok"}'].join("\n");
    expect(parseLatest(raw)).toBe("ok");
  });
});
