import { describe, it, expect } from "vitest";
import session from "../../src/core/session.js";

const { getSessionId } = session;

describe("getSessionId", () => {
  it("extracts the id from /app/<id>", () => {
    expect(getSessionId("/app/4256384b373874")).toBe("4256384b373874");
  });

  it("ignores query string and hash", () => {
    expect(getSessionId("/app/abc123?foo=1#section")).toBe("abc123");
  });

  it("works with a multi-account prefix (/u/0/app/<id>)", () => {
    expect(getSessionId("/u/0/app/xyz789")).toBe("xyz789");
  });

  it("percent-decodes the id", () => {
    expect(getSessionId("/app/a%20b")).toBe("a b");
  });

  it("returns null for /app with no id", () => {
    expect(getSessionId("/app")).toBeNull();
    expect(getSessionId("/app/")).toBeNull();
  });

  it("returns null for unrelated paths and empty input", () => {
    expect(getSessionId("/")).toBeNull();
    expect(getSessionId("/settings")).toBeNull();
    expect(getSessionId("")).toBeNull();
    expect(getSessionId(null)).toBeNull();
    expect(getSessionId(undefined)).toBeNull();
  });
});
