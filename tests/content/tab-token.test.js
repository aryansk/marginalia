import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// GA.tabToken (util.js) namespaces the pre-id draft bucket per tab. When
// sessionStorage is unavailable (private/partitioned browsing) the fallback
// must be STABLE across page loads — a fresh random token per load would
// resolve every reload to a new draft bucket and orphan the previous load's
// drafts (T-004).

const FILES = ["src/shared/settings-schema.js", "src/core/sites.js", "src/content/util.js"];
const location = { hostname: "gemini.google.com", pathname: "/app" };

function loadWith(sessionStorage) {
  return loadGA(FILES, { location, sessionStorage });
}

function throwingStorage() {
  return {
    getItem() {
      throw new Error("sessionStorage blocked");
    },
    setItem() {
      throw new Error("sessionStorage blocked");
    },
  };
}

function fakeStorage() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

describe("GA.tabToken", () => {
  it("is identical across two loads when sessionStorage throws (stable draft key)", () => {
    const first = loadWith(throwingStorage()).tabToken;
    const second = loadWith(throwingStorage()).tabToken;
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("persists one token per tab via sessionStorage, stable across reloads", () => {
    const tabStorage = fakeStorage();
    const first = loadWith(tabStorage).tabToken;
    const second = loadWith(tabStorage).tabToken; // simulated reload, same tab
    expect(second).toBe(first);
  });

  it("stays distinct across tabs when sessionStorage works (no cross-tab theft)", () => {
    const tab1 = loadWith(fakeStorage()).tabToken;
    const tab2 = loadWith(fakeStorage()).tabToken;
    expect(tab1).not.toBe(tab2);
  });
});

