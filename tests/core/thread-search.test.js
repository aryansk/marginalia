import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const GA = loadGA(["src/core/thread-search.js"]);
const { matches } = GA.core.threadSearch;

const thread = {
  selector: { exact: "The Higgs boson decays" },
  messages: [
    { role: "user", text: "Why does it decay so fast?" },
    { role: "model", text: "Because its coupling is Large." },
  ],
};

describe("GA.core.threadSearch.matches", () => {
  it("matches case-insensitively on the highlight snippet (selector.exact)", () => {
    expect(matches(thread, "higgs")).toBe(true);
    expect(matches(thread, "HIGGS BOSON")).toBe(true);
  });

  it("matches text in a user message", () => {
    expect(matches(thread, "decay so fast")).toBe(true);
  });

  it("matches text in a model reply", () => {
    expect(matches(thread, "coupling")).toBe(true);
    expect(matches(thread, "large")).toBe(true); // case-insensitive
  });

  it("returns false for a non-substring query", () => {
    expect(matches(thread, "quantum chromodynamics")).toBe(false);
  });

  it("empty or whitespace-only query matches everything", () => {
    expect(matches(thread, "")).toBe(true);
    expect(matches(thread, "   ")).toBe(true);
    expect(matches(thread, null)).toBe(true);
    expect(matches(thread, undefined)).toBe(true);
  });

  it("matches attached labels", () => {
    const labeled = { ...thread, labels: ["project.ux.nav", "todo"] };
    expect(matches(labeled, "project.ux")).toBe(true);
    expect(matches(labeled, "TODO")).toBe(true);
    expect(matches(labeled, "nav")).toBe(true);
    // label-less thread unchanged
    expect(matches(thread, "todo")).toBe(false);
  });

  it("is null-safe: threads with no messages / no selector / no text do not throw", () => {
    expect(matches({ selector: { exact: "hi" } }, "hi")).toBe(true);
    expect(matches({ selector: { exact: "hi" } }, "nope")).toBe(false);
    expect(matches({ messages: [{ role: "user", text: "hello" }] }, "hello")).toBe(true);
    expect(matches({ messages: [{ role: "user" }] }, "x")).toBe(false);
    expect(matches({}, "x")).toBe(false);
    expect(matches(null, "x")).toBe(false);
    // a present query never throws on a missing thread; empty query still true
    expect(matches(null, "")).toBe(true);
  });
});
