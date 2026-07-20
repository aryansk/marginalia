import { describe, it, expect } from "vitest";
import parser from "../../src/anthropic/parser.js";

const { parseLatest } = parser;

describe("anthropic parseLatest", () => {
  it("returns null before any text fragment", () => {
    expect(parseLatest("")).toBeNull();
    expect(parseLatest("event: message_start\ndata: {}\n")).toBeNull();
  });

  it("concatenates content_block_delta text deltas", () => {
    const raw = [
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}',
      'data: {"type":"message_stop"}',
    ].join("\n");
    expect(parseLatest(raw)).toBe("Hi there");
  });

  it("concatenates legacy completion deltas", () => {
    const raw = [
      'data: {"type":"completion","completion":"Hel"}',
      'data: {"type":"completion","completion":"lo"}',
      "data: [DONE]",
    ].join("\n");
    expect(parseLatest(raw)).toBe("Hello");
  });

  it("skips malformed lines, comments and [DONE] without throwing", () => {
    const raw = [
      "data: {oops}",
      ": keep-alive",
      "",
      "data: [DONE]",
      'data: {"completion":"ok"}',
    ].join("\n");
    expect(parseLatest(raw)).toBe("ok");
  });

  it("textless events (message_start, ping, non-text deltas) contribute nothing", () => {
    const raw = [
      'data: {"type":"message_start","message":{"role":"assistant"}}',
      'data: {"type":"ping"}',
      'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{"}}',
      'data: {"type":"content_block_delta","delta":{"text":"real"}}',
    ].join("\n");
    expect(parseLatest(raw)).toBe("real");
  });
});

describe("anthropic makeStream", () => {
  const TRANSCRIPT =
    "event: message_start\n" +
    'data: {"type":"message_start","message":{"role":"assistant"}}\n' +
    "\n" +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo — ünïcodé"}}\n' +
    'data: {"type":"completion","completion":" (legacy tail)"}\n' +
    'data: {"type":"message_stop"}\n' +
    "data: [DONE]\n";

  it("returns null until the first text delta, then the answer so far", () => {
    const s = parser.makeStream();
    expect(s.push("event: message_start\n")).toBeNull();
    expect(s.push('data: {"type":"ping"}\n')).toBeNull();
    expect(s.push('data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n')).toBe("Hi");
    expect(s.push('data: {"type":"content_block_delta","delta":{"text":"!"}}\n')).toBe("Hi!");
    expect(s.end()).toBe("Hi!");
  });

  it("a data line split across pushes is held until its newline arrives", () => {
    const s = parser.makeStream();
    expect(s.push('data: {"type":"content_block_del')).toBeNull();
    expect(s.push('ta","delta":{"text":"whole"}}\n')).toBe("whole");
  });

  it("a trailing line without a newline is flushed by end()", () => {
    const s = parser.makeStream();
    s.push('data: {"completion":"tail"}'); // no \n
    expect(s.end()).toBe("tail");
  });

  it("matches the parseLatest oracle over every chunking of a mixed transcript", () => {
    // Equivalence ratchet, as tests/shared/sse-stream.test.js holds for the
    // sibling parsers: streamed output must match whole-buffer parseLatest at
    // every complete-line boundary and at end().
    for (const size of [1, 3, 7, 1000]) {
      const s = parser.makeStream();
      let fed = "";
      for (let i = 0; i < TRANSCRIPT.length; i += size) {
        const chunk = TRANSCRIPT.slice(i, i + size);
        const streamed = s.push(chunk);
        fed += chunk;
        if (fed.endsWith("\n")) expect(streamed).toBe(parseLatest(fed));
      }
      expect(s.end()).toBe(parseLatest(TRANSCRIPT));
      expect(s.end()).toBe("Hello — ünïcodé (legacy tail)");
    }
  });
});
