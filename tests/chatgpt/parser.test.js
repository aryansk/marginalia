import { describe, it, expect } from "vitest";
import parser from "../../src/chatgpt/parser.js";

const { parseLatest } = parser;

describe("chatgpt parseLatest", () => {
  it("returns null before any data event", () => {
    expect(parseLatest("")).toBeNull();
    expect(parseLatest("event: ping\n\n")).toBeNull();
  });

  it("reads growing snapshots and keeps the final full text", () => {
    const raw = [
      'data: {"message":{"content":{"parts":["Hel"]}}}',
      'data: {"message":{"content":{"parts":["Hello"]}}}',
      "data: [DONE]",
    ].join("\n");
    expect(parseLatest(raw)).toBe("Hello");
  });

  it("reconstructs the delta-append format (initial snapshot + appends)", () => {
    const raw = [
      'data: {"v":{"message":{"content":{"content_type":"text","parts":[""]}}},"c":0}',
      'data: {"o":"append","p":"/message/content/parts/0","v":"Hel"}',
      'data: {"o":"append","v":"lo"}',
      "data: [DONE]",
    ].join("\n");
    expect(parseLatest(raw)).toBe("Hello");
  });

  it("ignores appends targeting non-text paths (e.g. metadata)", () => {
    const raw = [
      'data: {"message":{"content":{"parts":["Hi"]}}}',
      'data: {"o":"append","p":"/message/metadata/x","v":"NOPE"}',
    ].join("\n");
    expect(parseLatest(raw)).toBe("Hi");
  });

  it("skips malformed data lines without throwing", () => {
    const raw = ['data: {not json}', 'data: {"message":{"content":{"parts":["ok"]}}}'].join("\n");
    expect(parseLatest(raw)).toBe("ok");
  });
});
