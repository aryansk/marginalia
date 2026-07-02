import { describe, it, expect } from "vitest";
import payload from "../../src/googleai/payload.js";

const { buildUrl, buildBody, buildRequest } = payload;

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
});
