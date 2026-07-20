import { describe, it, expect } from "vitest";
import payload from "../../src/anthropic/payload.js";

const { buildBody, ENDPOINT, VERSION } = payload;

describe("anthropic payload", () => {
  it("targets the messages endpoint with a pinned api version", () => {
    expect(ENDPOINT).toBe("https://api.anthropic.com/v1/messages");
    expect(VERSION).toBe("2023-06-01");
  });

  it("builds a streaming message body with the fixed max_tokens cap", () => {
    const body = JSON.parse(buildBody("claude-sonnet-4-6", "why 8kb?"));
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toEqual([{ role: "user", content: "why 8kb?" }]);
  });

  it("preserves unicode in the message content", () => {
    const body = JSON.parse(buildBody("m", "café ☕"));
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[0].content).toBe("café ☕");
  });
});
