// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// navigation.js has no polling fallback anymore: history hooks fire onChange,
// and checkNow() (called by the reanchorer each mutation frame) catches SPA
// navigations the hooks miss. All paths dedupe on location.href.

describe("navigation.watch", () => {
  it("fires onChange once per URL change across hooks and checkNow", () => {
    const GA = loadGA(["src/content/navigation.js"]);
    let calls = 0;
    const nav = GA.navigation.watch(() => calls++);

    history.pushState({}, "", "/chat/abc");
    expect(calls).toBe(1);

    nav.checkNow(); // same URL — must not double-fire
    expect(calls).toBe(1);

    history.replaceState({}, "", "/chat/def");
    expect(calls).toBe(2);
  });

  it("checkNow alone detects an unhooked URL change", () => {
    const GA = loadGA(["src/content/navigation.js"]);
    let calls = 0;
    const nav = GA.navigation.watch(() => calls++);
    // Simulate a URL change that produced no popstate/locationchange event by
    // silencing the hook's event first.
    const orig = window.dispatchEvent;
    window.dispatchEvent = () => true;
    history.pushState({}, "", "/chat/hidden");
    window.dispatchEvent = orig;
    expect(calls).toBe(0);
    nav.checkNow();
    expect(calls).toBe(1);
    nav.checkNow();
    expect(calls).toBe(1);
  });
});
