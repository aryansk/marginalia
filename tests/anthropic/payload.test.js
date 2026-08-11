import { describe, it, expect } from "vitest";
import payload from "../../src/anthropic/payload.js";

const {
  buildBody,
  buildTestRequest,
  buildListRequest,
  parseModels,
  ENDPOINT,
  LIST_ENDPOINT,
  VERSION,
} = payload;

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

  it("builds a 1-token non-streaming test request with the full header set", () => {
    const req = buildTestRequest("claude-sonnet-4-6", "sk-ant-test");
    expect(req.url).toBe(ENDPOINT);
    expect(req.headers["x-api-key"]).toBe("sk-ant-test");
    expect(req.headers["anthropic-version"]).toBe(VERSION);
    expect(req.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(req.body);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(1);
    expect(body).not.toHaveProperty("stream");
  });

  it("builds a model-list GET request with the same headers", () => {
    const req = buildListRequest("sk-ant-test");
    const u = new URL(req.url);
    expect(u.origin + u.pathname).toBe(LIST_ENDPOINT);
    expect(u.searchParams.get("limit")).toBe("1000");
    expect(req.headers["x-api-key"]).toBe("sk-ant-test");
    expect(req.headers["anthropic-version"]).toBe(VERSION);
    expect(req.body).toBeUndefined();
  });

  it("parseModels sorts by created_at desc and tolerates malformed input", () => {
    const json = {
      data: [
        { id: "claude-3-5-haiku-20241022", created_at: "2024-10-22T00:00:00Z" },
        { id: "claude-sonnet-4-6", created_at: "2025-09-29T00:00:00Z" },
        { id: "claude-opus-4-1", created_at: "2025-08-05T00:00:00Z" },
        { nope: true },
      ],
    };
    expect(parseModels(json).map((m) => m.id)).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-1",
      "claude-3-5-haiku-20241022",
    ]);
    expect(parseModels(null)).toEqual([]);
    expect(parseModels({})).toEqual([]);
  });
});
