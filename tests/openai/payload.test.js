import { describe, it, expect } from "vitest";
import payload from "../../src/openai/payload.js";

const { buildBody, buildTestRequest, buildListRequest, parseModels, ENDPOINT, LIST_ENDPOINT } =
  payload;

describe("openai payload", () => {
  it("targets the chat completions endpoint", () => {
    expect(ENDPOINT).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("builds a streaming single-user-message body", () => {
    const body = JSON.parse(buildBody("gpt-4o-mini", "why 8kb?"));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: "user", content: "why 8kb?" }]);
  });

  it("preserves unicode/newlines and tolerates an empty prompt", () => {
    const prompt = 'Why "8 KB"?\nLine 2 — café ☕';
    expect(JSON.parse(buildBody("m", prompt)).messages[0].content).toBe(prompt);
    expect(JSON.parse(buildBody("m")).messages[0].content).toBe("");
  });

  it("builds a 1-token non-streaming test request", () => {
    const req = buildTestRequest("gpt-4o-mini", "sk-test");
    expect(req.url).toBe(ENDPOINT);
    expect(req.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(req.body);
    expect(body.model).toBe("gpt-4o-mini");
    // max_completion_tokens, not max_tokens: reasoning models reject the latter.
    expect(body.max_completion_tokens).toBe(1);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("stream");
  });

  it("builds an authorized model-list GET request", () => {
    const req = buildListRequest("sk-test");
    expect(req.url).toBe(LIST_ENDPOINT);
    expect(req.headers.Authorization).toBe("Bearer sk-test");
    expect(req.body).toBeUndefined();
  });

  it("parseModels keeps chat models, drops non-chat, sorts newest first", () => {
    const json = {
      data: [
        { id: "gpt-4o-mini", created: 100 },
        { id: "gpt-4o", created: 300 },
        { id: "whisper-1", created: 900 },
        { id: "text-embedding-3-small", created: 900 },
        { id: "gpt-4o-audio-preview", created: 900 },
        { id: "gpt-4o-realtime-preview", created: 900 },
        { id: "o3-mini", created: 200 },
        { id: "dall-e-3", created: 900 },
        { id: "gpt-3.5-turbo-instruct", created: 900 },
      ],
    };
    expect(parseModels(json)).toEqual([
      { id: "gpt-4o", created: 300 },
      { id: "o3-mini", created: 200 },
      { id: "gpt-4o-mini", created: 100 },
    ]);
  });

  it("parseModels drops Responses-API-only ids but keeps chat-capable search-preview", () => {
    const json = {
      data: [
        { id: "o1-pro", created: 900 },
        { id: "o3-pro", created: 900 },
        { id: "gpt-5-pro", created: 900 },
        { id: "o3-deep-research", created: 900 },
        { id: "o4-mini-deep-research", created: 900 },
        { id: "gpt-4o-search-preview", created: 250 },
        { id: "gpt-4o-mini-search-preview", created: 240 },
        { id: "gpt-4o", created: 300 },
      ],
    };
    expect(parseModels(json).map((m) => m.id)).toEqual([
      "gpt-4o",
      "gpt-4o-search-preview",
      "gpt-4o-mini-search-preview",
    ]);
  });

  it("parseModels tolerates malformed input", () => {
    expect(parseModels(null)).toEqual([]);
    expect(parseModels({})).toEqual([]);
    expect(parseModels({ data: [{ nope: 1 }, null] })).toEqual([]);
  });
});
