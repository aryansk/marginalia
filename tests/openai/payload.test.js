import { describe, it, expect } from "vitest";
import payload from "../../src/openai/payload.js";

const { buildBody, ENDPOINT } = payload;

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
});
