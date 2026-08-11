import { describe, it, expect } from "vitest";
import payload from "../../src/googleai/payload.js";

const { buildUrl, buildBody, buildRequest, buildTestRequest, buildListRequest, parseModels } =
  payload;

describe("googleai payload", () => {
  it("builds the SSE streamGenerateContent URL without the key in the query", () => {
    const u = new URL(buildUrl("gemini-2.5-flash"));
    expect(u.pathname).toBe("/v1beta/models/gemini-2.5-flash:streamGenerateContent");
    expect(u.searchParams.get("alt")).toBe("sse");
    expect(u.searchParams.get("key")).toBeNull(); // key must NOT ride in the URL
    expect(u.origin).toBe("https://generativelanguage.googleapis.com");
  });

  it("sends the API key in the x-goog-api-key header, not the URL", () => {
    const r = buildRequest("gemini-2.5-flash", "hi", "AIza-secret");
    expect(r.headers["x-goog-api-key"]).toBe("AIza-secret");
    expect(r.url).not.toContain("AIza-secret");
    expect(r.url).not.toContain("key=");
    expect(r.headers["Content-Type"]).toBe("application/json");
  });

  it("wraps the prompt as a user content part", () => {
    const body = JSON.parse(buildBody("hi — café ☕"));
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "hi — café ☕" }] }]);
  });

  it("buildRequest carries the prompt body", () => {
    const r = buildRequest("m", "why 8kb?", "k");
    expect(JSON.parse(r.body).contents[0].parts[0].text).toBe("why 8kb?");
  });

  it("builds a 1-token non-streaming test request, key in header only", () => {
    const req = buildTestRequest("gemini-2.5-flash", "AIza-secret");
    const u = new URL(req.url);
    expect(u.pathname).toBe("/v1beta/models/gemini-2.5-flash:generateContent");
    expect(u.search).toBe(""); // no alt=sse, no key in query
    expect(req.headers["x-goog-api-key"]).toBe("AIza-secret");
    const body = JSON.parse(req.body);
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "ping" }] }]);
    expect(body.generationConfig.maxOutputTokens).toBe(1);
  });

  it("builds a model-list GET request, key in header only", () => {
    const req = buildListRequest("AIza-secret");
    const u = new URL(req.url);
    expect(u.pathname).toBe("/v1beta/models");
    expect(u.searchParams.get("pageSize")).toBe("1000");
    expect(u.searchParams.get("key")).toBeNull();
    expect(req.headers["x-goog-api-key"]).toBe("AIza-secret");
    expect(req.body).toBeUndefined();
  });

  it("parseModels keeps generateContent models, strips prefix, sorts by gemini version", () => {
    const json = {
      models: [
        { name: "models/gemini-1.5-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
        { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/imagen-3.0", supportedGenerationMethods: ["predict"] },
        // Pass the generateContent filter but must NOT outrank real flagships:
        // gemma-3 is not "version 3", gemini-exp-1206 is not "version 1206".
        { name: "models/gemma-3-27b-it", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-exp-1206", supportedGenerationMethods: ["generateContent"] },
      ],
    };
    expect(parseModels(json).map((m) => m.id)).toEqual([
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemma-3-27b-it",
      "gemini-exp-1206",
    ]);
  });

  it("parseModels tolerates malformed input", () => {
    expect(parseModels(null)).toEqual([]);
    expect(parseModels({})).toEqual([]);
    expect(parseModels({ models: [{ name: 1 }, null, {}] })).toEqual([]);
  });
});
