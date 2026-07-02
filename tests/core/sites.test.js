import { describe, it, expect } from "vitest";
import sites from "../../src/core/sites.js";

const { providerForHost, sessionIdFromPath, responseSelectors } = sites;

describe("providerForHost", () => {
  it("maps each site's host(s) to a provider id", () => {
    expect(providerForHost("gemini.google.com")).toBe("gemini");
    expect(providerForHost("chatgpt.com")).toBe("chatgpt");
    expect(providerForHost("chat.openai.com")).toBe("chatgpt");
    expect(providerForHost("claude.ai")).toBe("claude");
  });

  it("matches subdomains and is case-insensitive", () => {
    expect(providerForHost("www.claude.ai")).toBe("claude");
    expect(providerForHost("Gemini.Google.Com")).toBe("gemini");
  });

  it("returns null off-site and for empty input", () => {
    expect(providerForHost("example.com")).toBeNull();
    expect(providerForHost("notgemini.google.com.evil.com")).toBeNull();
    expect(providerForHost("")).toBeNull();
    expect(providerForHost(null)).toBeNull();
  });
});

describe("sessionIdFromPath", () => {
  it("extracts the Gemini id from /app/<id> (incl. /u/0/app)", () => {
    expect(sessionIdFromPath("gemini", "/app/4256384b373874")).toBe("4256384b373874");
    expect(sessionIdFromPath("gemini", "/u/0/app/xyz789")).toBe("xyz789");
  });

  it("extracts the ChatGPT id from /c/<id>", () => {
    expect(sessionIdFromPath("chatgpt", "/c/abc-123")).toBe("abc-123");
  });

  it("extracts the Claude id from /chat/<id>", () => {
    expect(sessionIdFromPath("claude", "/chat/uuid-9")).toBe("uuid-9");
  });

  it("extracts a Gemini Gem chat from /gem/<gemId>/<chatId>, but not the Gem lobby", () => {
    expect(sessionIdFromPath("gemini", "/gem/coding-partner/77cd11a2")).toBe("coding-partner/77cd11a2");
    expect(sessionIdFromPath("gemini", "/u/0/gem/coding-partner/77cd11a2")).toBe("coding-partner/77cd11a2");
    expect(sessionIdFromPath("gemini", "/gem/coding-partner")).toBeNull(); // lobby = new chat
    expect(sessionIdFromPath("gemini", "/gem/coding-partner/77cd11a2?x=1#y")).toBe(
      "coding-partner/77cd11a2"
    );
  });

  it("extracts project-scoped chats on Claude and ChatGPT", () => {
    expect(sessionIdFromPath("claude", "/project/p-1/chat/uuid-9")).toBe("uuid-9");
    expect(sessionIdFromPath("claude", "/project/p-1")).toBeNull(); // project lobby
    expect(sessionIdFromPath("chatgpt", "/g/g-custom/c/abc-123")).toBe("abc-123");
  });

  it("ignores query/hash and percent-decodes", () => {
    expect(sessionIdFromPath("gemini", "/app/abc?foo=1#x")).toBe("abc");
    expect(sessionIdFromPath("chatgpt", "/c/a%20b")).toBe("a b");
  });

  it("returns null when no chat is open or provider is unknown", () => {
    expect(sessionIdFromPath("gemini", "/app")).toBeNull();
    expect(sessionIdFromPath("chatgpt", "/")).toBeNull();
    expect(sessionIdFromPath("claude", "/new")).toBeNull();
    expect(sessionIdFromPath("nope", "/chat/x")).toBeNull();
    expect(sessionIdFromPath("gemini", null)).toBeNull();
  });
});

describe("responseSelectors", () => {
  it("returns a non-empty selector list per provider", () => {
    expect(responseSelectors("gemini").length).toBeGreaterThan(0);
    expect(responseSelectors("chatgpt")).toContain('[data-message-author-role="assistant"]');
    expect(responseSelectors("claude")).toContain(".font-claude-message");
  });

  it("returns a copy (callers can't mutate the registry)", () => {
    const a = responseSelectors("gemini");
    a.push("x");
    expect(responseSelectors("gemini")).not.toContain("x");
  });

  it("returns [] for an unknown provider", () => {
    expect(responseSelectors("nope")).toEqual([]);
  });
});
